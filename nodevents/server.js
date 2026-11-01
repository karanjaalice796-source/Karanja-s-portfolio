const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const { Server } = require('socket.io');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const db = require('./db');
const { sendMail, configured: mailConfigured } = require('./mailer');
const { templates, isEventType, eventTypeLabel, createTemplateEntries } = require('./templates');

const vendorServiceCategories = [
  'Catering',
  'Venue',
  'Photography',
  'Videography',
  'Decoration',
  'Florist',
  'Music and DJ',
  'MC and Host',
  'Event planning',
  'Rentals and equipment',
  'Transport',
  'Cake and desserts',
  'Hair and makeup',
  'Security',
  'Cleaning',
  'Other',
];

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = Number(process.env.PORT) || 3100;
const reminderHours = Number(process.env.REMINDER_HOURS || 48);
const maxReminders = Number(process.env.MAX_REMINDERS || 3);
const reminderCheckMinutes = Number(process.env.REMINDER_CHECK_MINUTES || 60);
const linkGraceDays = Number(process.env.LINK_GRACE_DAYS || 30);
if (![reminderHours, maxReminders, reminderCheckMinutes].every(Number.isFinite)
  || reminderHours <= 0 || !Number.isInteger(maxReminders) || maxReminders < 1
  || reminderCheckMinutes <= 0 || !Number.isInteger(linkGraceDays) || linkGraceDays < 0) {
  throw new Error('Reminder settings must be positive numbers, MAX_REMINDERS must be a positive integer, and LINK_GRACE_DAYS must be a non-negative integer.');
}
const oauthConfigurations = new Map();
const passwordResetAttempts = new Map();
const uploadDirectory = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedInvoiceTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const invoiceUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadDirectory),
    filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedInvoiceTypes.has(file.mimetype)) return callback(new Error('Upload a PDF, JPG, or PNG invoice.'));
    return callback(null, true);
  },
});

const sessionMiddleware = session({
  name: 'nodevents.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 },
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.eventTypeLabel = eventTypeLabel;
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use((request, response, next) => {
  if (request.method === 'POST' && request.get('origin')) {
    try {
      if (new URL(request.get('origin')).host !== request.get('host')) return response.sendStatus(403);
    } catch {
      return response.sendStatus(403);
    }
  }
  response.locals.user = null;
  response.locals.isAdmin = false;
  response.locals.vendorUser = request.session.vendorUser || null;
  response.locals.vendorView = request.path.startsWith('/vendor');
  response.locals.notice = request.session.notice || null;
  delete request.session.notice;
  const sessionUserId = request.session.user?.id;
  if (!sessionUserId) return next();
  const account = db.prepare('SELECT id, name, email, is_admin, is_suspended FROM users WHERE id = ?')
    .get(sessionUserId);
  if (!account || account.is_suspended) {
    return request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie('nodevents.sid');
      next();
    });
  }
  request.currentUser = account;
  response.locals.user = { id: account.id, name: account.name, email: account.email };
  response.locals.isAdmin = Boolean(account.is_admin);
  next();
});

function setNotice(request, message) {
  request.session.notice = message;
}

function renderVendorRegistration(response, vendor = null, error = null, status = 200) {
  return response.status(status).render('vendor-auth', {
    title: 'Create vendor account',
    mode: 'register',
    error,
    vendor,
  });
}

async function registerVendorAccount(request, response, next, vendor) {
  if (request.session.vendorUser) return response.redirect(vendorPageUrl(vendor.token));
  const email = String(request.body.email || vendor.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  if (!vendor.email || email !== vendor.email.trim().toLowerCase()
    || password.length < 8 || password.length > 128) {
    return renderVendorRegistration(
      response,
      vendor,
      !vendor.email
        ? 'This invitation has no email address. Contact your planner to set one up.'
        : 'Use the email address on your invitation and a password between 8 and 128 characters.',
      400,
    );
  }
  if (db.prepare('SELECT id FROM vendor_accounts WHERE email = ?').get(email)) {
    return renderVendorRegistration(
      response,
      vendor,
      'A vendor account already uses this email. Sign in, then open this invitation to add it to your account.',
      409,
    );
  }
  const passwordHash = await bcrypt.hash(password, 12);
  db.exec('BEGIN');
  try {
    const result = db.prepare('INSERT INTO vendor_accounts (name, email, password_hash) VALUES (?, ?, ?)')
      .run(vendor.name, email, passwordHash);
    db.prepare('UPDATE vendors SET account_id = ? WHERE id = ? AND account_id IS NULL')
      .run(Number(result.lastInsertRowid), vendor.id);
    db.exec('COMMIT');
    request.session.regenerate((error) => {
      if (error) return next(error);
      request.session.vendorUser = {
        id: Number(result.lastInsertRowid),
        name: vendor.name,
        email,
      };
      response.redirect('/vendor/dashboard');
    });
  } catch (error) {
    db.exec('ROLLBACK');
    if (error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return renderVendorRegistration(
        response,
        vendor,
        'A vendor account already uses this email. Sign in, then open this invitation to add it to your account.',
        409,
      );
    }
    return next(error);
  }
}

function oauthProviders() {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apple: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID
      && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
  };
}

function renderAuth(response, error = null, status = 200, authMode = 'login') {
  return response.status(status).render('auth', {
    error,
    authMode,
    loggedOut: false,
    oauthProviders: oauthProviders(),
  });
}

function oauthCallbackUrl(provider) {
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || (base.pathname !== '/' && base.pathname !== '')) {
    throw new Error('APP_BASE_URL must be an origin without credentials, a path, a query, or a fragment.');
  }
  if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use HTTPS in production.');
  }
  return new URL(`/auth/${provider}/callback`, base).href;
}

async function oauthClient(provider) {
  if (oauthConfigurations.has(provider)) return oauthConfigurations.get(provider);

  const pending = (async () => {
    const oidc = await import('openid-client');
    if (provider === 'google') {
      return oidc.discovery(
        new URL('https://accounts.google.com'),
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
      );
    }

    const privateKeyPem = process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const privateKeyBytes = Buffer.from(
      privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ''),
      'base64',
    );
    const privateKey = await crypto.webcrypto.subtle.importKey(
      'pkcs8',
      privateKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    return oidc.discovery(
      new URL('https://appleid.apple.com'),
      process.env.APPLE_CLIENT_ID,
      undefined,
      oidc.PrivateKeyJwt(
        { key: privateKey, kid: process.env.APPLE_KEY_ID },
        {
          modifyAssertion: (_header, payload) => {
            payload.iss = process.env.APPLE_TEAM_ID;
            payload.sub = process.env.APPLE_CLIENT_ID;
            payload.aud = 'https://appleid.apple.com';
          },
        },
      ),
    );
  })();
  oauthConfigurations.set(provider, pending);
  try {
    return await pending;
  } catch (error) {
    oauthConfigurations.delete(provider);
    throw error;
  }
}

function displayName(provider, claims, query) {
  let name = claims.name || claims.given_name;
  if (provider === 'apple' && typeof query.user === 'string') {
    try {
      const appleUser = JSON.parse(query.user);
      const parts = [appleUser.name?.firstName, appleUser.name?.lastName]
        .filter((part) => typeof part === 'string' && part.trim())
        .map((part) => part.trim());
      if (parts.length) name = parts.join(' ');
    } catch {
      // Apple only includes this optional profile data during the first authorization.
    }
  }
  if (typeof name !== 'string' || !name.trim()) name = claims.email.split('@')[0];
  return name.trim().slice(0, 80);
}

async function completeOauthSignIn(request, response, next, provider, claims) {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (typeof claims.sub !== 'string' || !claims.sub || !verified
    || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return renderAuth(response, 'The provider did not return a verified email address. Please try another sign-in method.', 401);
  }

  let user = db.prepare(`
    SELECT users.id, users.name, users.email, users.is_suspended
    FROM oauth_accounts JOIN users ON users.id = oauth_accounts.user_id
    WHERE oauth_accounts.provider = ? AND oauth_accounts.provider_subject = ?
  `).get(provider, claims.sub);

  if (!user) {
    const name = displayName(provider, claims, request.query);
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    db.exec('BEGIN');
    try {
      const concurrentlyLinkedUser = db.prepare(`
        SELECT users.id, users.name, users.email, users.is_suspended
        FROM oauth_accounts JOIN users ON users.id = oauth_accounts.user_id
        WHERE oauth_accounts.provider = ? AND oauth_accounts.provider_subject = ?
      `).get(provider, claims.sub);
      if (concurrentlyLinkedUser) {
        user = concurrentlyLinkedUser;
      } else if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
        db.exec('ROLLBACK');
        return renderAuth(response, 'An account already uses this email. Sign in with your existing method; social accounts are not linked automatically.', 409);
      } else {
        const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
          .run(name, email, passwordHash);
        const userId = Number(result.lastInsertRowid);
        db.prepare('INSERT INTO oauth_accounts (provider, provider_subject, user_id) VALUES (?, ?, ?)')
          .run(provider, claims.sub, userId);
        user = { id: userId, name, email };
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  if (user.is_suspended) {
    return renderAuth(response, 'This account is suspended. Contact the site administrator for help.', 403);
  }

  request.session.regenerate((error) => {
    if (error) return next(error);
    request.session.user = { id: user.id, name: user.name, email: user.email };
    response.redirect('/dashboard');
  });
}

function requireAuth(request, response, next) {
  if (!request.currentUser) return response.redirect('/auth');
  next();
}

function requireAdmin(request, response, next) {
  if (!request.currentUser) return response.redirect('/auth');
  if (!request.currentUser.is_admin) return response.sendStatus(403);
  next();
}

function requireVendorAuth(request, response, next) {
  if (!request.session.vendorUser) return response.redirect('/vendor/login');
  next();
}

function eventForOwner(eventId, userId) {
  return db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(eventId, userId);
}

function vendorByToken(token, vendorAccountId = null) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`
    SELECT vendors.*, events.title AS event_title, events.event_date, events.venue,
      events.venue_notes
    FROM vendors JOIN events ON events.id = vendors.event_id
    WHERE vendors.token = ?
      AND (
        date(events.event_date, '+' || ? || ' days') >= date('now')
        OR (? IS NOT NULL AND vendors.account_id = ?)
      )
  `).get(token, linkGraceDays, vendorAccountId, vendorAccountId);
}

function recordChange(eventId, message) {
  db.prepare('INSERT INTO changes (event_id, message) VALUES (?, ?)').run(eventId, message);
}

function emitEventUpdate(eventId, message) {
  const attendance = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed,
      COALESCE(SUM(CASE WHEN status = 'awaiting_payment' THEN 1 ELSE 0 END), 0) AS awaiting_payment,
      COALESCE(SUM(CASE WHEN status = 'confirmed' AND checked_in_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS checked_in
    FROM registrations WHERE event_id = ?
  `).get(eventId);
  io.to(`event:${eventId}`).emit('update', {
    message,
    attendance: {
      confirmed: Number(attendance.confirmed),
      awaitingPayment: Number(attendance.awaiting_payment),
      checkedIn: Number(attendance.checked_in),
    },
  });
  db.prepare('SELECT token FROM vendors WHERE event_id = ?').all(eventId)
    .forEach(({ token }) => io.to(`vendor:${token}`).emit('update', { message }));
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const demoEmailNote = mailConfigured ? '' : ' (demo mode: printed in the server console)';

function vendorPageUrl(token) {
  const origin = process.env.APP_BASE_URL || `http://localhost:${port}`;
  return new URL(`/vendor/${token}`, origin).href;
}

function clientPageUrl(token) {
  const origin = process.env.APP_BASE_URL || `http://localhost:${port}`;
  return new URL(`/client/${token}`, origin).href;
}

function guestRsvpUrl(token, request) {
  const origin = process.env.APP_BASE_URL || `${request.protocol}://${request.get('host')}`;
  return new URL(`/guest/rsvp/${token}`, origin).href;
}

function ticketPageUrl(token, request = null) {
  const origin = process.env.APP_BASE_URL || (request ? `${request.protocol}://${request.get('host')}` : `http://localhost:${port}`);
  return new URL(`/tickets/${token}`, origin).href;
}

function registrationQuestions(event) {
  try {
    const questions = JSON.parse(event.custom_questions || '[]');
    return Array.isArray(questions)
      ? questions.filter((question) => typeof question === 'string').slice(0, 5)
      : [];
  } catch (error) {
    console.error(`Invalid custom registration questions for event ${event.id}:`, error);
    return [];
  }
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseAmount(value) {
  const text = String(value ?? '0').trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

function parseQuantity(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,10}(?:\.\d{1,3})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

function formatQuantity(value) {
  return String(Number(Number(value).toFixed(3)));
}

function resetTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function resetLinkUrl(token, request) {
  const origin = process.env.APP_BASE_URL || `${request.protocol}://${request.get('host')}`;
  return new URL(`/auth/reset/${token}`, origin).href;
}

function resetRequestLimited(ip) {
  const now = Date.now();
  const entry = passwordResetAttempts.get(ip);
  if (!entry || now - entry.startedAt >= 15 * 60 * 1000) {
    passwordResetAttempts.set(ip, { count: 1, startedAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > 5;
}

async function emailVendor(vendor, event, subject, text, quiet = false) {
  if (!vendor.email || !emailPattern.test(vendor.email)) return false;
  const sent = await sendMail({
    to: vendor.email,
    subject: String(subject).replace(/[\r\n]+/g, ' '),
    text,
  });
  if (sent) {
    db.prepare("UPDATE vendors SET last_notified_at = datetime('now') WHERE id = ?").run(vendor.id);
  } else if (!quiet) {
    const message = `Could not email ${vendor.name}. Check the vendor address and SMTP settings.`;
    recordChange(event.id, message);
    io.to(`event:${event.id}`).emit('update', { message });
  }
  return sent;
}

function invitationMessage(vendor, event, reminder) {
  return [
    `Hello ${vendor.name},`,
    '',
    reminder
      ? `This is a reminder to reply about "${event.title}" on ${event.event_date}.`
      : `You have been added to "${event.title}" on ${event.event_date}${event.venue ? ` at ${event.venue}` : ''}.`,
    '',
    'Open your private page to confirm, see your schedule, and send invoices:',
    vendorPageUrl(vendor.token),
    '',
    'No account or password is needed. Please do not share this link.',
  ].join('\n');
}

async function sendVendorInvite(vendor, event, reminder, quiet = false) {
  const subject = reminder ? `Reminder: please reply about ${event.title}` : `You are invited: ${event.title}`;
  const sent = await emailVendor(vendor, event, subject, invitationMessage(vendor, event, reminder), quiet);
  if (sent) {
    const message = `${reminder ? 'Reminder' : 'Link'} emailed to ${vendor.name}${demoEmailNote}`;
    recordChange(event.id, message);
    io.to(`event:${event.id}`).emit('update', { message });
  }
  return sent;
}

async function sendGuestInvitation(guest, event, request) {
  const checkinQr = await QRCode.toBuffer(guest.checkin_token, { type: 'png', width: 320, margin: 2 });
  return sendMail({
    to: guest.email,
    subject: `Invitation: ${event.title}`,
    text: [
      `Hello ${guest.name},`,
      '',
      `You are invited to ${event.title} on ${event.event_date}${event.venue ? ` at ${event.venue}` : ''}.`,
      `This invitation is for ${guest.group_size} ${guest.group_size === 1 ? 'person' : 'people'}.`,
      '',
      'Please reply using your private RSVP link:',
      guestRsvpUrl(guest.rsvp_token, request),
      '',
      'Your check-in QR code is attached. Please show it to the event planner when you arrive.',
      'Do not forward your private invitation or QR code.',
    ].join('\n'),
    attachments: [{
      filename: 'event-check-in.png',
      content: checkinQr,
      contentType: 'image/png',
    }],
  });
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function emailEventChange(eventId, vendorId, message) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return;
  const vendors = vendorId
    ? db.prepare('SELECT * FROM vendors WHERE id = ? AND event_id = ?').all(vendorId, eventId)
    : db.prepare('SELECT * FROM vendors WHERE event_id = ?').all(eventId);
  const text = [
    'Hello,',
    '',
    `There is an update for "${event.title}" on ${event.event_date}:`,
    message,
    '',
    'Open your private event page for the latest details.',
  ].join('\n');
  for (const vendor of vendors) {
    const vendorText = [
      text,
      '',
      'Open your private event page:',
      vendorPageUrl(vendor.token),
    ].join('\n');
    await emailVendor(vendor, event, `Update: ${event.title}`, vendorText);
  }
}

io.on('connection', (socket) => {
  socket.on('join:event', (eventId) => {
    const userId = socket.request.session?.user?.id;
    if (userId && Number.isSafeInteger(eventId) && eventForOwner(eventId, userId)) {
      socket.join(`event:${eventId}`);
    }
  });
  socket.on('join:vendor', (token) => {
    if (vendorByToken(token, socket.request.session?.vendorUser?.id)) socket.join(`vendor:${token}`);
  });
});

app.get('/', (_request, response) => {
  response.render('home');
});

app.get('/browse-events', (_request, response) => {
  response.render('browse-events', { templates });
});

app.get('/vendors', (request, response) => {
  const search = String(request.query.q || '').trim().slice(0, 100);
  const category = String(request.query.category || '').trim().slice(0, 80);
  const conditions = ['vendor_profiles.is_published = 1'];
  const values = [];
  if (search) {
    conditions.push(`(
      vendor_profiles.business_name LIKE ? COLLATE NOCASE
      OR vendor_profiles.category LIKE ? COLLATE NOCASE
      OR vendor_profiles.service_categories LIKE ? COLLATE NOCASE
      OR vendor_profiles.services LIKE ? COLLATE NOCASE
      OR vendor_profiles.description LIKE ? COLLATE NOCASE
      OR vendor_profiles.location LIKE ? COLLATE NOCASE
    )`);
    const term = `%${search}%`;
    values.push(term, term, term, term, term, term);
  }
  if (category) {
    conditions.push(`(
      vendor_profiles.category = ? COLLATE NOCASE
      OR instr('|' || vendor_profiles.service_categories || '|', '|' || ? || '|') > 0
    )`);
    values.push(category, category);
  }
  const vendors = db.prepare(`
    SELECT vendor_profiles.id, vendor_profiles.business_name, vendor_profiles.category,
      vendor_profiles.service_categories, vendor_profiles.services,
      vendor_profiles.description, vendor_profiles.location
    FROM vendor_profiles
    WHERE ${conditions.join(' AND ')}
    ORDER BY vendor_profiles.business_name COLLATE NOCASE
    LIMIT 100
  `).all(...values);
  const savedCategories = db.prepare(`
    SELECT DISTINCT category FROM vendor_profiles
    WHERE is_published = 1 AND category <> ''
    ORDER BY category COLLATE NOCASE
  `).all().map((row) => row.category);
  const categories = [...new Set([...vendorServiceCategories, ...savedCategories])].sort((a, b) => a.localeCompare(b));
  const events = request.currentUser
    ? db.prepare('SELECT id, title, event_date FROM events WHERE user_id = ? ORDER BY event_date, id DESC')
      .all(request.currentUser.id)
    : [];
  response.render('vendor-directory', { vendors, categories, search, category, events });
});

app.get('/vendors/:profileId', (request, response) => {
  const profileId = Number(request.params.profileId);
  if (!Number.isSafeInteger(profileId) || profileId <= 0) return response.sendStatus(404);
  const vendor = db.prepare(`
    SELECT id, business_name, category, service_categories, services, description, location
    FROM vendor_profiles WHERE id = ? AND is_published = 1
  `).get(profileId);
  if (!vendor) return response.sendStatus(404);
  const events = request.currentUser
    ? db.prepare('SELECT id, title, event_date FROM events WHERE user_id = ? ORDER BY event_date, id DESC')
      .all(request.currentUser.id)
    : [];
  response.render('vendor-profile', { vendor, events });
});

app.get('/learn', (_request, response) => {
  response.render('learning');
});

app.get('/plans', (_request, response) => {
  response.render('plans', {
    supportEmail: process.env.SUPPORT_EMAIL || '',
  });
});

app.get('/auth/forgot', (_request, response) => {
  response.render('forgot', { sent: false });
});

app.post('/auth/forgot', async (request, response, next) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  for (const [ip, entry] of passwordResetAttempts) {
    if (Date.now() - entry.startedAt >= 15 * 60 * 1000) passwordResetAttempts.delete(ip);
  }
  const limited = resetRequestLimited(request.ip);
  if (!limited && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160) {
    try {
      const account = db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
      if (account) {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = resetTokenHash(token);
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL")
            .run(account.id);
          db.prepare(`
            INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
            VALUES (?, ?, datetime('now', '+1 hour'))
          `).run(account.id, tokenHash);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        await sendMail({
          to: account.email,
          subject: 'Reset your Nodevents password',
          text: [
            `Hello ${account.name},`,
            '',
            'Use this one-time link within one hour to reset your Nodevents password:',
            resetLinkUrl(token, request),
            '',
            'If you did not request this, you can ignore this message.',
          ].join('\n'),
        });
      }
    } catch (error) {
      return next(error);
    }
  }
  response.render('forgot', { sent: true });
});

app.get('/auth/reset/:token', (request, response) => {
  const token = String(request.params.token || '');
  const reset = /^[a-f0-9]{64}$/.test(token) && db.prepare(`
    SELECT id FROM password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(resetTokenHash(token));
  if (!reset) {
    return response.status(400).render('message', {
      title: 'Reset link unavailable',
      message: 'This password-reset link is invalid, expired, or has already been used. Request a new one to continue.',
      href: '/auth/forgot',
      linkText: 'Request another reset link',
      vendorView: false,
    });
  }
  response.render('reset', { token, error: null });
});

app.post('/auth/reset/:token', async (request, response, next) => {
  const token = String(request.params.token || '');
  const password = String(request.body.password || '');
  const confirm = String(request.body.confirm || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(400);
  if (password.length < 8 || password.length > 128 || password !== confirm) {
    return response.status(400).render('reset', {
      token,
      error: password.length < 8 || password.length > 128
        ? 'Use a password between 8 and 128 characters.'
        : 'The passwords do not match.',
    });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    db.exec('BEGIN IMMEDIATE');
    const reset = db.prepare(`
      SELECT user_id FROM password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
    `).get(resetTokenHash(token));
    if (!reset) {
      db.exec('ROLLBACK');
      return response.status(400).render('message', {
        title: 'Reset link unavailable',
        message: 'This password-reset link is invalid, expired, or has already been used. Request a new one to continue.',
        href: '/auth/forgot',
        linkText: 'Request another reset link',
        vendorView: false,
      });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, reset.user_id);
    db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL")
      .run(reset.user_id);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (rollbackError) { console.error('Password reset rollback failed:', rollbackError); }
    return next(error);
  }
  response.render('message', {
    title: 'Password updated',
    message: 'Your password has been reset. Sign in with your new password.',
    href: '/auth',
    linkText: 'Sign in',
    vendorView: false,
  });
});

function vendorResetLinkUrl(token, request) {
  const origin = process.env.APP_BASE_URL || `${request.protocol}://${request.get('host')}`;
  return new URL(`/vendor/reset/${token}`, origin).href;
}

app.get('/vendor/forgot', (_request, response) => {
  response.render('vendor-forgot', { sent: false });
});

app.post('/vendor/forgot', async (request, response, next) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  for (const [ip, entry] of passwordResetAttempts) {
    if (Date.now() - entry.startedAt >= 15 * 60 * 1000) passwordResetAttempts.delete(ip);
  }
  const limited = resetRequestLimited(request.ip);
  if (!limited && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160) {
    try {
      const account = db.prepare('SELECT id, name, email FROM vendor_accounts WHERE email = ?').get(email);
      if (account) {
        const token = crypto.randomBytes(32).toString('hex');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`UPDATE vendor_password_reset_tokens SET used_at = datetime('now')
            WHERE vendor_account_id = ? AND used_at IS NULL`).run(account.id);
          db.prepare(`INSERT INTO vendor_password_reset_tokens (vendor_account_id, token_hash, expires_at)
            VALUES (?, ?, datetime('now', '+1 hour'))`).run(account.id, resetTokenHash(token));
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        await sendMail({
          to: account.email,
          subject: 'Reset your Nodevents vendor password',
          text: [
            `Hello ${account.name},`,
            '',
            'Use this one-time link within one hour to reset your vendor password:',
            vendorResetLinkUrl(token, request),
            '',
            'If you did not request this, you can ignore this message.',
          ].join('\n'),
        });
      }
    } catch (error) {
      return next(error);
    }
  }
  response.render('vendor-forgot', { sent: true });
});

app.get('/vendor/reset/:token', (request, response) => {
  const token = String(request.params.token || '');
  const reset = /^[a-f0-9]{64}$/.test(token) && db.prepare(`
    SELECT id FROM vendor_password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(resetTokenHash(token));
  if (!reset) {
    return response.status(400).render('message', {
      title: 'Reset link unavailable',
      message: 'This password-reset link is invalid, expired, or has already been used. Request a new one to continue.',
      href: '/vendor/forgot',
      linkText: 'Request another reset link',
      vendorView: true,
    });
  }
  response.render('vendor-reset', { token, error: null });
});

app.post('/vendor/reset/:token', async (request, response, next) => {
  const token = String(request.params.token || '');
  const password = String(request.body.password || '');
  const confirm = String(request.body.confirm || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(400);
  if (password.length < 8 || password.length > 128 || password !== confirm) {
    return response.status(400).render('vendor-reset', {
      token,
      error: password.length < 8 || password.length > 128
        ? 'Use a password between 8 and 128 characters.'
        : 'The passwords do not match.',
    });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    db.exec('BEGIN IMMEDIATE');
    const reset = db.prepare(`SELECT vendor_account_id FROM vendor_password_reset_tokens
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`)
      .get(resetTokenHash(token));
    if (!reset) {
      db.exec('ROLLBACK');
      return response.status(400).render('message', {
        title: 'Reset link unavailable',
        message: 'This password-reset link is invalid, expired, or has already been used. Request a new one to continue.',
        href: '/vendor/forgot',
        linkText: 'Request another reset link',
        vendorView: true,
      });
    }
    db.prepare('UPDATE vendor_accounts SET password_hash = ? WHERE id = ?')
      .run(passwordHash, reset.vendor_account_id);
    db.prepare(`UPDATE vendor_password_reset_tokens SET used_at = datetime('now')
      WHERE vendor_account_id = ? AND used_at IS NULL`).run(reset.vendor_account_id);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (rollbackError) { console.error('Vendor password reset rollback failed:', rollbackError); }
    return next(error);
  }
  response.render('message', {
    title: 'Password updated',
    message: 'Your vendor password has been reset. Sign in with your new password.',
    href: '/vendor/login',
    linkText: 'Sign in',
    vendorView: true,
  });
});

app.get('/oauth-setup', (_request, response) => {
  response.sendFile(path.join(__dirname, 'OAUTH-SETUP.md'));
});

app.get('/vendor', (_request, response) => {
  response.redirect('/vendor/login');
});

app.get('/vendor/login', (request, response) => {
  if (request.session.vendorUser) return response.redirect('/vendor/dashboard');
  response.render('vendor-auth', {
    title: 'Vendor sign in',
    mode: 'login',
    error: null,
    vendor: null,
  });
});

app.post('/vendor/login', async (request, response, next) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  const account = db.prepare('SELECT * FROM vendor_accounts WHERE email = ?').get(email);
  if (!account || !(await bcrypt.compare(password, account.password_hash))) {
    return response.status(401).render('vendor-auth', {
      title: 'Vendor sign in',
      mode: 'login',
      error: 'Email or password is incorrect. To create an account, open the personal invite link from your planner.',
      vendor: null,
    });
  }
  request.session.regenerate((error) => {
    if (error) return next(error);
    request.session.vendorUser = { id: account.id, name: account.name, email: account.email };
    response.redirect('/vendor/dashboard');
  });
});

app.post('/vendor/logout', requireVendorAuth, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) return next(error);
    response.clearCookie('nodevents.sid');
    response.redirect('/vendor/login');
  });
});

app.get('/vendor/register', (request, response) => {
  if (request.session.vendorUser) return response.redirect('/vendor/dashboard');
  return renderVendorRegistration(response);
});

app.post('/vendor/register', (request, response, next) => {
  const invitationLink = String(request.body.invitation_link || '').trim();
  if (!invitationLink || invitationLink.length > 2048) {
    return renderVendorRegistration(response, null, 'Paste the personal invitation link from your planner.', 400);
  }
  let vendor;
  try {
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
    const parsedLink = new URL(invitationLink, baseUrl);
    const tokenMatch = parsedLink.pathname.match(/^\/vendor\/([a-f0-9]{64})\/?$/);
    if (parsedLink.search || parsedLink.hash || !tokenMatch) {
      return renderVendorRegistration(response, null, 'Enter the complete personal vendor invitation link.', 400);
    }
    vendor = vendorByToken(tokenMatch[1]);
  } catch {
    return renderVendorRegistration(response, null, 'Enter a valid personal vendor invitation link.', 400);
  }
  if (!vendor) {
    return renderVendorRegistration(response, null, 'That invitation link was not found. Check the link from your planner and try again.', 404);
  }
  return registerVendorAccount(request, response, next, vendor);
});

app.get('/vendor/dashboard', requireVendorAuth, (request, response) => {
  const vendors = db.prepare(`
    SELECT vendors.id, vendors.name, vendors.category, vendors.services, vendors.token, vendors.status,
      events.title AS event_title, events.event_date, events.venue
    FROM vendors JOIN events ON events.id = vendors.event_id
    WHERE vendors.account_id = ?
    ORDER BY events.event_date, events.title, vendors.id
  `).all(request.session.vendorUser.id);
  response.render('vendor-dashboard', { vendors });
});

app.get('/vendor/profile', requireVendorAuth, (request, response) => {
  const profile = db.prepare('SELECT * FROM vendor_profiles WHERE vendor_account_id = ?')
    .get(request.session.vendorUser.id) || null;
  let selectedServiceCategories = [];
  if (profile?.service_categories) {
    selectedServiceCategories = profile.service_categories.split('|').filter((item) => vendorServiceCategories.includes(item));
  } else if (profile?.category && vendorServiceCategories.includes(profile.category)) {
    selectedServiceCategories = [profile.category];
  }
  response.render('vendor-profile-edit', { profile, vendorServiceCategories, selectedServiceCategories });
});

app.post('/vendor/profile', requireVendorAuth, (request, response) => {
  const businessName = String(request.body.business_name || '').trim();
  const submittedCategories = Array.isArray(request.body.service_categories)
    ? request.body.service_categories
    : request.body.service_categories ? [request.body.service_categories] : [];
  const selectedServiceCategories = [...new Set(submittedCategories
    .map((item) => String(item).trim())
    .filter((item) => vendorServiceCategories.includes(item)))];
  const category = selectedServiceCategories[0] || '';
  const serviceCategories = selectedServiceCategories.join('|');
  const services = String(request.body.services || '').trim();
  const description = String(request.body.description || '').trim();
  const location = String(request.body.location || '').trim();
  const isPublished = request.body.is_published === 'on' ? 1 : 0;
  if (!businessName || businessName.length > 120 || !category
    || services.length > 1500 || description.length > 2000 || location.length > 160) {
    setNotice(request, 'Enter a business name, choose at least one service category, and keep services, description, and location within their character limits.');
    return response.redirect('/vendor/profile');
  }
  db.prepare(`
    INSERT INTO vendor_profiles
      (vendor_account_id, business_name, category, service_categories, services, description, location, is_published, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(vendor_account_id) DO UPDATE SET
      business_name = excluded.business_name,
      category = excluded.category,
      service_categories = excluded.service_categories,
      services = excluded.services,
      description = excluded.description,
      location = excluded.location,
      is_published = excluded.is_published,
      updated_at = datetime('now')
  `).run(request.session.vendorUser.id, businessName, category, serviceCategories, services, description, location, isPublished);
  setNotice(request, isPublished
    ? 'Vendor profile saved and published in Find Vendors.'
    : 'Vendor profile saved as a draft and hidden from Find Vendors.');
  response.redirect('/vendor/profile');
});

app.get('/vendor/:token/register', (request, response) => {
  const vendor = vendorByToken(request.params.token);
  if (!vendor) return response.sendStatus(404);
  if (request.session.vendorUser) return response.redirect(vendorPageUrl(vendor.token));
  return renderVendorRegistration(
    response,
    vendor,
    vendor.email
      ? null
      : 'This invitation has no email address, so an account cannot be created yet. Contact your planner or use your private link.',
  );
});

app.post('/vendor/:token/register', async (request, response, next) => {
  const vendor = vendorByToken(request.params.token);
  if (!vendor) return response.sendStatus(404);
  return registerVendorAccount(request, response, next, vendor);
});

app.post('/vendor/:token/claim', requireVendorAuth, (request, response) => {
  const vendor = vendorByToken(request.params.token, request.session.vendorUser.id);
  if (!vendor) return response.sendStatus(404);
  if (!vendor.email || vendor.email.trim().toLowerCase() !== request.session.vendorUser.email) {
    setNotice(request, 'This invitation email does not match your vendor account. Contact your planner if it needs updating.');
    return response.redirect(vendorPageUrl(vendor.token));
  }
  if (vendor.account_id && vendor.account_id !== request.session.vendorUser.id) {
    setNotice(request, 'This invitation is already connected to another vendor account.');
    return response.redirect(vendorPageUrl(vendor.token));
  }
  db.prepare('UPDATE vendors SET account_id = ? WHERE id = ?')
    .run(request.session.vendorUser.id, vendor.id);
  setNotice(request, 'This event has been added to your vendor account.');
  response.redirect('/vendor/dashboard');
});

app.get('/auth', (request, response) => {
  if (request.session.user) return response.redirect('/dashboard');
  return response.render('auth', {
    error: null,
    authMode: 'login',
    loggedOut: request.query.loggedOut === '1',
    oauthProviders: oauthProviders(),
  });
});

app.get('/auth/:provider', async (request, response, next) => {
  const { provider } = request.params;
  if (provider !== 'google' && provider !== 'apple') return response.sendStatus(404);
  if (!oauthProviders()[provider]) {
    return renderAuth(response, `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not configured yet. See OAUTH-SETUP.md to connect it.`, 503);
  }

  try {
    const oidc = await import('openid-client');
    const configuration = await oauthClient(provider);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    const callbackUrl = oauthCallbackUrl(provider);
    const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: provider === 'google' ? 'openid email profile' : 'openid email name',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(provider === 'google' ? { prompt: 'select_account' } : {}),
    });
    request.session.oauthTransactions = request.session.oauthTransactions || {};
    const transactions = request.session.oauthTransactions;
    while (Object.keys(transactions).length >= 5) {
      delete transactions[Object.keys(transactions)[0]];
    }
    transactions[state] = { provider, nonce, verifier };
    request.session.save((error) => {
      if (error) return next(error);
      response.redirect(authorizationUrl.href);
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/auth/:provider/callback', async (request, response, next) => {
  const { provider } = request.params;
  if (provider !== 'google' && provider !== 'apple') return response.sendStatus(404);

  const state = typeof request.query.state === 'string' ? request.query.state : '';
  const transactions = request.session.oauthTransactions;
  const transaction = state && transactions?.[state];
  if (!transaction || transaction.provider !== provider) {
    return renderAuth(response, 'The sign-in request could not be verified. Please try again.', 400);
  }
  delete transactions[state];
  if (request.query.error) {
    return renderAuth(response, 'Sign-in was cancelled or declined by the provider.', 401);
  }

  try {
    const oidc = await import('openid-client');
    const configuration = await oauthClient(provider);
    const currentUrl = new URL(request.originalUrl, oauthCallbackUrl(provider));
    const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      pkceCodeVerifier: transaction.verifier,
    });
    const claims = tokens.claims();
    if (!claims) return renderAuth(response, 'The provider did not return a valid identity. Please try again.', 401);
    return await completeOauthSignIn(request, response, next, provider, claims);
  } catch (error) {
    console.error(`OAuth sign-in failed for ${provider}:`, error);
    return renderAuth(response, 'Social sign-in could not be completed. Check the provider setup and try again.', 401);
  }
});

app.post('/auth/register', async (request, response, next) => {
  const name = String(request.body.name || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  if (!name || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || password.length < 8 || password.length > 128) {
    return renderAuth(response, 'Enter your name, a valid email, and a password between 8 and 128 characters.', 400, 'register');
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hash);
    request.session.regenerate((error) => {
      if (error) return next(error);
      request.session.user = { id: Number(result.lastInsertRowid), name, email };
      response.redirect('/dashboard');
    });
  } catch (error) {
    if (error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return renderAuth(response, 'An account already exists for that email.', 409, 'register');
    }
    return next(error);
  }
});

app.post('/auth/login', async (request, response, next) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  const account = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!account || !(await bcrypt.compare(password, account.password_hash))) {
    return renderAuth(response, 'Email or password is incorrect.', 401);
  }
  if (account.is_suspended) {
    return renderAuth(response, 'This account is suspended. Contact the site administrator for help.', 403);
  }
  request.session.regenerate((error) => {
    if (error) return next(error);
    request.session.user = { id: account.id, name: account.name, email: account.email };
    response.redirect('/dashboard');
  });
});

app.post('/auth/logout', requireAuth, (request, response, next) => {
  request.session.destroy((error) => {
    if (error) return next(error);
    response.clearCookie('nodevents.sid');
    response.redirect('/auth?loggedOut=1');
  });
});

app.get('/admin', requireAuth, requireAdmin, (request, response) => {
  const totals = {
    planners: db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 0 AND is_suspended = 0').get().count,
    suspended: db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 0 AND is_suspended = 1').get().count,
    events: db.prepare('SELECT COUNT(*) AS count FROM events').get().count,
    vendors: db.prepare('SELECT COUNT(*) AS count FROM vendors').get().count,
  };
  const planners = db.prepare(`
    SELECT users.id, users.name, users.email, users.is_suspended, users.created_at,
      COUNT(events.id) AS event_count
    FROM users LEFT JOIN events ON events.user_id = users.id
    WHERE users.is_admin = 0
    GROUP BY users.id
    ORDER BY users.created_at DESC, users.id DESC
  `).all();
  response.render('admin', { totals, planners });
});

app.post('/admin/users/:userId/suspend', requireAuth, requireAdmin, (request, response) => {
  const userId = Number(request.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return response.sendStatus(404);
  const target = db.prepare('SELECT id, name, is_admin FROM users WHERE id = ?').get(userId);
  if (!target) return response.sendStatus(404);
  if (target.is_admin || target.id === request.currentUser.id) return response.sendStatus(403);
  db.prepare('UPDATE users SET is_suspended = 1 WHERE id = ? AND is_admin = 0').run(userId);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.request.session?.user?.id === userId) socket.disconnect(true);
  }
  setNotice(request, `${target.name}'s planner account was suspended.`);
  response.redirect('/admin');
});

app.post('/admin/users/:userId/restore', requireAuth, requireAdmin, (request, response) => {
  const userId = Number(request.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) return response.sendStatus(404);
  const target = db.prepare('SELECT id, name, is_admin FROM users WHERE id = ?').get(userId);
  if (!target) return response.sendStatus(404);
  if (target.is_admin) return response.sendStatus(403);
  db.prepare('UPDATE users SET is_suspended = 0 WHERE id = ? AND is_admin = 0').run(userId);
  setNotice(request, `${target.name}'s planner account was restored.`);
  response.redirect('/admin');
});

app.get('/dashboard', requireAuth, (request, response) => {
  const events = db.prepare(`
    SELECT events.*,
      COUNT(vendors.id) AS vendor_count,
      COALESCE(SUM(CASE WHEN vendors.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
      COALESCE(SUM(CASE WHEN vendors.status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_count,
      COALESCE(SUM(CASE WHEN vendors.status <> 'pending' THEN 1 ELSE 0 END), 0) AS replied_count
    FROM events LEFT JOIN vendors ON vendors.event_id = events.id
    WHERE events.user_id = ?
    GROUP BY events.id
    ORDER BY events.event_date, events.id DESC
  `).all(request.session.user.id);
  const today = new Date();
  const todayOrdinal = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dashboardEvents = events.map((event) => {
    const [year, month, day] = event.event_date.split('-').map(Number);
    const daysUntil = Math.round((Date.UTC(year, month - 1, day) - todayOrdinal) / 86400000);
    return { ...event, daysUntil, isPast: daysUntil < 0 };
  });
  const requestedEventType = String(request.query.event_type || '');
  const selectedEventType = Object.prototype.hasOwnProperty.call(templates, requestedEventType)
    ? requestedEventType
    : 'other';
  response.render('dashboard', { events: dashboardEvents, templates, selectedEventType });
});

app.post('/events', requireAuth, (request, response) => {
  const title = String(request.body.title || '').trim();
  const eventDate = String(request.body.event_date || '').trim();
  const venue = String(request.body.venue || '').trim();
  const eventType = String(request.body.event_type || 'other').trim();
  if (!title || title.length > 120 || !isValidDate(eventDate) || venue.length > 160
    || String(request.body.venue_notes || '').trim().length > 1000
    || !isEventType(eventType)) {
    setNotice(request, 'Enter an event name, valid date, venue details, and a valid event type.');
    return response.redirect('/dashboard');
  }
  const venueNotes = String(request.body.venue_notes || '').trim();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(
      'INSERT INTO events (user_id, title, event_date, event_type, venue, venue_notes, registration_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(request.session.user.id, title, eventDate, eventType, venue, venueNotes, crypto.randomBytes(32).toString('hex'));
    const eventId = Number(result.lastInsertRowid);
    createTemplateEntries(db, eventId, eventDate, eventType);
    db.exec('COMMIT');
    response.redirect(`/events/${eventId}`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

function renderPlannerEvent(request, response, eventId, toolPage = 'overview') {
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.session.user.id);
  if (!event) return response.sendStatus(404);
  const vendors = db.prepare(`
    SELECT vendors.*,
      (SELECT COUNT(*) FROM invoices WHERE invoices.vendor_id = vendors.id) AS invoice_count,
      (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE invoices.vendor_id = vendors.id) AS invoiced_amount
    FROM vendors WHERE event_id = ? ORDER BY name
  `).all(eventId).map((vendor) => ({
    ...vendor,
    availabilityLabel: {
      pending: 'Awaiting availability',
      confirmed: 'Available · confirmed',
      declined: 'Unavailable · declined',
      changes_requested: 'Needs coordination',
    }[vendor.status],
    privateUrl: vendorPageUrl(vendor.token),
    linkExpiresOn: db.prepare("SELECT date(?, '+' || ? || ' days') AS expires_on")
      .get(event.event_date, linkGraceDays).expires_on,
  }));
  const guests = db.prepare('SELECT * FROM guests WHERE event_id = ? ORDER BY name, id').all(eventId);
  const guestTotals = guests.reduce((totals, guest) => {
    totals[guest.rsvp_status] += guest.group_size;
    totals.invited += guest.group_size;
    if (guest.checked_in_at) totals.checkedIn += guest.group_size;
    return totals;
  }, { attending: 0, declined: 0, awaiting: 0, invited: 0, checkedIn: 0 });
  const headcount = guests.length ? guestTotals.attending + guestTotals.awaiting : event.expected_guests;
  const cateringItems = db.prepare('SELECT * FROM catering_items WHERE event_id = ? ORDER BY id').all(eventId);
  const plannedPortions = Math.ceil(guestTotals.attending * (1 + event.catering_allowance_percent / 100));
  const cateringTotals = {
    portions: plannedPortions,
    estimatedCost: 0,
    items: cateringItems.map((item) => {
      const quantity = item.quantity_override === null
        ? item.amount_per_portion * plannedPortions
        : item.quantity_override;
      const estimatedCost = quantity * item.cost_per_unit;
      return { ...item, calculated_quantity: quantity, estimated_cost: estimatedCost };
    }),
  };
  cateringTotals.estimatedCost = cateringTotals.items.reduce((total, item) => total + item.estimated_cost, 0);
  const tasks = db.prepare(`
    SELECT tasks.*, vendors.name AS vendor_name
    FROM tasks LEFT JOIN vendors ON vendors.id = tasks.vendor_id
    WHERE tasks.event_id = ? ORDER BY tasks.start_time, tasks.id
  `).all(eventId);
  const invoices = db.prepare(`
    SELECT invoices.*, vendors.name AS vendor_name
    FROM invoices JOIN vendors ON vendors.id = invoices.vendor_id
    WHERE vendors.event_id = ? ORDER BY invoices.created_at DESC, invoices.id DESC
  `).all(eventId);
  const budgetTotals = {
    estimated: vendors.reduce((total, vendor) => total + vendor.estimated_cost + vendor.cost_per_guest * headcount, 0),
    invoiced: invoices.reduce((total, invoice) => total + invoice.amount, 0),
    paid: invoices.reduce((total, invoice) => total + (invoice.status === 'paid' ? invoice.amount : 0), 0),
    comparison: vendors.reduce((total, vendor) => total + Math.max(
      vendor.estimated_cost + vendor.cost_per_guest * headcount,
      vendor.invoiced_amount,
    ), 0),
  };
  const changes = db.prepare('SELECT * FROM changes WHERE event_id = ? ORDER BY id DESC LIMIT 12').all(eventId);
  response.render('event', {
    event,
    toolPage,
    activeTool: toolPage,
    vendors,
    guests,
    guestTotals,
    headcount,
    cateringItems: cateringTotals.items,
    cateringTotals,
    budgetTotals,
    tasks,
    invoices,
    changes,
    clientUrl: event.client_token ? clientPageUrl(event.client_token) : null,
    mapsUrl: event.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue)}` : null,
    mailConfigured,
    reminderHours,
    maxReminders,
    linkGraceDays,
  });
}

app.get('/events/:id', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  return renderPlannerEvent(request, response, eventId);
});

app.get('/events/:id/:toolPage', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (request.params.toolPage === 'reports.csv') return sendEventReport(request, response, eventId);
  const tools = { budget: 'budget', guests: 'guests', catering: 'catering' };
  const toolPage = tools[request.params.toolPage];
  if (toolPage) return renderPlannerEvent(request, response, eventId, toolPage);
  if (['logistics', 'tickets', 'event-day', 'reports'].includes(request.params.toolPage)) {
    return renderOperationsModule(request, response, eventId, request.params.toolPage);
  }
  return response.sendStatus(404);
});

app.get('/register/:token', (request, response) => {
  const token = String(request.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(404);
  const event = db.prepare(`
    SELECT id, title, event_date, event_type, venue, venue_notes, budget_currency,
      registration_token, custom_questions, registration_is_open
    FROM events WHERE registration_token = ?
  `).get(token);
  if (!event) return response.sendStatus(404);
  const ticketTypes = event.registration_is_open
    ? db.prepare(`
      SELECT ticket_types.*,
        ticket_types.capacity - COALESCE(SUM(CASE WHEN registrations.status IN ('confirmed', 'awaiting_payment') THEN 1 ELSE 0 END), 0) AS remaining
      FROM ticket_types LEFT JOIN registrations ON registrations.ticket_type_id = ticket_types.id
      WHERE ticket_types.event_id = ?
      GROUP BY ticket_types.id HAVING remaining > 0
      ORDER BY ticket_types.price, ticket_types.id
    `).all(event.id)
    : [];
  response.render('event-registration', {
    event,
    ticketTypes,
    customQuestions: registrationQuestions(event),
    error: event.registration_is_open ? null : 'Registration is currently closed.',
  });
});

app.post('/register/:token', async (request, response, next) => {
  const token = String(request.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(404);
  const event = db.prepare(`
    SELECT id, title, event_date, venue, budget_currency, registration_token, custom_questions, registration_is_open
    FROM events WHERE registration_token = ?
  `).get(token);
  if (!event) return response.sendStatus(404);
  const fullName = String(request.body.full_name || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const phone = String(request.body.phone || '').trim();
  const ticketTypeId = Number(request.body.ticket_type_id);
  const paymentMethod = String(request.body.payment_method || '');
  const paymentReference = String(request.body.payment_reference || '').trim();
  const paymentMethods = new Set(['', 'M-Pesa', 'Bank transfer', 'Cash', 'Other']);
  const questions = registrationQuestions(event);
  const customAnswers = {};
  questions.forEach((_question, index) => {
    customAnswers[String(index)] = String(request.body[`answer_${index}`] || '').trim().slice(0, 300);
  });
  if (!event.registration_is_open) {
    return response.status(410).render('message', {
      title: 'Registration closed',
      message: 'Registration for this event is closed.',
      href: '/',
      linkText: 'Home',
      vendorView: false,
    });
  }
  if (!fullName || fullName.length > 120 || !emailPattern.test(email) || email.length > 160
    || phone.length > 24 || !Number.isSafeInteger(ticketTypeId) || !paymentMethods.has(paymentMethod)
    || paymentReference.length > 100) {
    return response.status(400).render('message', {
      title: 'Registration not submitted',
      message: 'Check the name, email, phone, ticket type, and payment details and try again.',
      href: `/register/${token}`,
      linkText: 'Return to registration',
      vendorView: false,
    });
  }

  db.exec('BEGIN IMMEDIATE');
  let registration;
  try {
    const ticket = db.prepare('SELECT * FROM ticket_types WHERE id = ? AND event_id = ?')
      .get(ticketTypeId, event.id);
    if (!ticket) {
      db.exec('ROLLBACK');
      return response.status(400).render('message', {
        title: 'Ticket unavailable',
        message: 'That ticket type is no longer available.',
        href: `/register/${token}`,
        linkText: 'Choose another ticket',
        vendorView: false,
      });
    }
    if (Number(ticket.price) > 0 && !paymentMethod) {
      db.exec('ROLLBACK');
      return response.status(400).render('message', {
        title: 'Choose a payment method',
        message: 'Select the external payment method you plan to use. The organizer will verify payment before issuing a ticket.',
        href: `/register/${token}`,
        linkText: 'Return to registration',
        vendorView: false,
      });
    }
    const issued = db.prepare(`
      SELECT COUNT(*) AS count FROM registrations
      WHERE ticket_type_id = ? AND status IN ('confirmed', 'awaiting_payment')
    `).get(ticketTypeId).count;
    if (issued >= ticket.capacity) {
      db.exec('ROLLBACK');
      return response.status(409).render('message', {
        title: 'Ticket sold out',
        message: 'This ticket category has reached capacity. Return to registration to choose another category if one is available.',
        href: `/register/${token}`,
        linkText: 'Return to registration',
        vendorView: false,
      });
    }
    const qrToken = crypto.randomBytes(32).toString('hex');
    const status = Number(ticket.price) > 0 ? 'awaiting_payment' : 'confirmed';
    const result = db.prepare(`
      INSERT INTO registrations
        (event_id, ticket_type_id, full_name, email, phone, qr_token, status, payment_method, payment_reference, custom_answers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      ticketTypeId,
      fullName,
      email,
      phone,
      qrToken,
      status,
      Number(ticket.price) > 0 ? paymentMethod : '',
      Number(ticket.price) > 0 ? paymentReference : '',
      JSON.stringify(customAnswers),
    );
    registration = { id: Number(result.lastInsertRowid), qrToken, status, ticket };
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    return next(error);
  }

  const ticketUrl = ticketPageUrl(registration.qrToken, request);
  await sendMail({
    to: email,
    subject: registration.status === 'confirmed' ? `Your ticket: ${event.title}` : `Registration received: ${event.title}`,
    text: registration.status === 'confirmed'
      ? `Hello ${fullName},\n\nYour ${registration.ticket.name} ticket for "${event.title}" is confirmed. Open your digital ticket and QR code here:\n${ticketUrl}\n\nKeep this link private.`
      : `Hello ${fullName},\n\nYour registration for "${event.title}" is recorded, but payment verification is still pending. The organizer must verify your external payment before a ticket is issued. Do not send a PIN or password.`,
  });
  recordChange(event.id, `${registration.status === 'confirmed' ? 'A ticket was issued' : 'A ticket registration is awaiting payment'} for ${fullName}.`);
  emitEventUpdate(event.id, registration.status === 'confirmed' ? 'A new ticket registration was confirmed.' : 'A ticket registration is awaiting payment verification.');
  return response.redirect(ticketUrl);
});

app.get('/tickets/:token', (request, response) => {
  const token = String(request.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(404);
  const registration = db.prepare(`
    SELECT registrations.*, ticket_types.name AS ticket_name,
      events.id AS event_id, events.title AS event_title, events.event_date, events.venue
    FROM registrations
    JOIN ticket_types ON ticket_types.id = registrations.ticket_type_id
    JOIN events ON events.id = registrations.event_id
    WHERE registrations.qr_token = ?
  `).get(token);
  if (!registration) return response.sendStatus(404);
  response.render('ticket', {
    registration,
    event: {
      id: registration.event_id,
      title: registration.event_title,
      event_date: registration.event_date,
      venue: registration.venue,
    },
    today: new Date().toISOString().slice(0, 10),
  });
});

app.get('/tickets/:token/qr', async (request, response) => {
  const token = String(request.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(404);
  const registration = db.prepare('SELECT status FROM registrations WHERE qr_token = ?').get(token);
  if (!registration) return response.sendStatus(404);
  if (registration.status !== 'confirmed') return response.sendStatus(403);
  const png = await QRCode.toBuffer(token, { type: 'png', width: 360, margin: 2 });
  response.type('png').set('Cache-Control', 'private, no-store').send(png);
});

app.get('/tickets/:token/feedback', (request, response) => {
  const token = String(request.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(404);
  const registration = db.prepare(`
    SELECT registrations.id, registrations.qr_token, registrations.status,
      events.id AS event_id, events.title AS event_title, events.event_date
    FROM registrations JOIN events ON events.id = registrations.event_id
    WHERE registrations.qr_token = ?
  `).get(token);
  if (!registration || registration.status !== 'confirmed') return response.sendStatus(404);
  if (registration.event_date > new Date().toISOString().slice(0, 10)) return response.sendStatus(403);
  response.render('feedback', {
    event: { id: registration.event_id, title: registration.event_title },
    registration,
    saved: Boolean(db.prepare('SELECT id FROM event_feedback WHERE registration_id = ?').get(registration.id)),
  });
});

app.post('/tickets/:token/feedback', (request, response) => {
  const token = String(request.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(404);
  const registration = db.prepare(`
    SELECT registrations.id, registrations.qr_token,
      events.id AS event_id, events.title AS event_title, events.event_date
    FROM registrations JOIN events ON events.id = registrations.event_id
    WHERE registrations.qr_token = ? AND registrations.status = 'confirmed'
  `).get(token);
  if (!registration || registration.event_date > new Date().toISOString().slice(0, 10)) return response.sendStatus(404);
  const ratingText = String(request.body.rating || '');
  const rating = /^[1-5]$/.test(ratingText) ? Number(ratingText) : null;
  const comments = String(request.body.comments || '').trim();
  if (rating === null || comments.length > 1500) {
    return response.status(400).render('message', {
      title: 'Feedback not saved',
      message: 'Choose a rating from 1 to 5 and keep comments under 1,500 characters.',
      href: `/tickets/${token}/feedback`,
      linkText: 'Return to feedback',
      vendorView: false,
    });
  }
  db.prepare(`
    INSERT INTO event_feedback (event_id, registration_id, rating, comments)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(registration_id) DO UPDATE SET rating = excluded.rating, comments = excluded.comments
  `).run(registration.event_id, registration.id, rating, comments);
  recordChange(registration.event_id, 'An attendee submitted event feedback.');
  response.render('feedback', {
    event: { id: registration.event_id, title: registration.event_title },
    registration,
    saved: true,
  });
});

app.post('/events/:id/tickets/check-in', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const token = String(request.body.qr_token || '');
  if (!Number.isSafeInteger(eventId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  if (!/^[a-f0-9]{64}$/.test(token)) return response.status(400).json({ error: 'That ticket code is not valid.' });
  const registration = db.prepare(`
    SELECT id, full_name, status, checked_in_at FROM registrations
    WHERE event_id = ? AND qr_token = ?
  `).get(eventId, token);
  if (!registration) return response.status(404).json({ error: 'That ticket does not belong to this event.' });
  if (registration.status !== 'confirmed') return response.status(409).json({ error: 'This ticket is not confirmed for entry.' });
  if (registration.checked_in_at) return response.status(409).json({ error: `${registration.full_name} has already checked in.` });
  db.prepare("UPDATE registrations SET checked_in_at = datetime('now') WHERE id = ?").run(registration.id);
  const message = `${registration.full_name} checked in with a ticket.`;
  recordChange(eventId, message);
  emitEventUpdate(eventId, message);
  return response.json({ message });
});

function renderOperationsModule(request, response, eventId, module) {
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.currentUser.id);
  if (!event) return response.sendStatus(404);
  const vendors = db.prepare(`
    SELECT vendors.*,
      vendor_contracts.id AS contract_id,
      vendor_contracts.reference AS contract_reference,
      vendor_contracts.terms AS contract_terms,
      vendor_contracts.agreed_amount,
      vendor_contracts.deposit_amount,
      vendor_contracts.due_date AS contract_due_date,
      vendor_contracts.status AS contract_status
    FROM vendors LEFT JOIN vendor_contracts ON vendor_contracts.vendor_id = vendors.id
    WHERE vendors.event_id = ? ORDER BY vendors.name
  `).all(eventId);
  const staff = db.prepare('SELECT * FROM event_staff WHERE event_id = ? ORDER BY name').all(eventId);
  const zones = db.prepare('SELECT * FROM event_zones WHERE event_id = ? ORDER BY id').all(eventId);
  const tasks = db.prepare(`
    SELECT tasks.*, event_staff.name AS assignee_name
    FROM tasks LEFT JOIN event_staff ON event_staff.id = tasks.assigned_staff_id
    WHERE tasks.event_id = ? ORDER BY tasks.completed, tasks.start_time, tasks.id
  `).all(eventId);
  const expenses = db.prepare(`
    SELECT expenses.*, vendors.name AS vendor_name
    FROM expenses LEFT JOIN vendors ON vendors.id = expenses.vendor_id
    WHERE expenses.event_id = ? ORDER BY expenses.expense_date, expenses.id DESC
  `).all(eventId);
  const expenseTotals = db.prepare(`
    SELECT COALESCE(SUM(estimated_amount), 0) AS estimated,
      COALESCE(SUM(actual_amount), 0) AS actual
    FROM expenses WHERE event_id = ?
  `).get(eventId);
  const ticketTypes = db.prepare(`
    SELECT ticket_types.*,
      COALESCE(SUM(CASE WHEN registrations.status IN ('confirmed', 'awaiting_payment') THEN 1 ELSE 0 END), 0) AS issued,
      COUNT(registrations.id) AS registration_count
    FROM ticket_types LEFT JOIN registrations ON registrations.ticket_type_id = ticket_types.id
    WHERE ticket_types.event_id = ?
    GROUP BY ticket_types.id ORDER BY ticket_types.id
  `).all(eventId).map((ticket) => ({ ...ticket, issued: Number(ticket.issued) }));
  const customQuestions = registrationQuestions(event);
  const registrations = db.prepare(`
    SELECT registrations.*, ticket_types.name AS ticket_name, ticket_types.price
    FROM registrations JOIN ticket_types ON ticket_types.id = registrations.ticket_type_id
    WHERE registrations.event_id = ?
    ORDER BY registrations.created_at DESC, registrations.id DESC
  `).all(eventId).map((registration) => {
    try {
      const answers = JSON.parse(registration.custom_answers || '{}');
      return {
        ...registration,
        answers: customQuestions.map((question, index) => ({
          question,
          answer: typeof answers[String(index)] === 'string' ? answers[String(index)] : '',
        })).filter((item) => item.answer),
      };
    } catch (error) {
      console.error(`Invalid registration answers for registration ${registration.id}:`, error);
      return { ...registration, answers: [] };
    }
  });
  const attendance = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed,
      COALESCE(SUM(CASE WHEN status = 'awaiting_payment' THEN 1 ELSE 0 END), 0) AS pendingPayment,
      COALESCE(SUM(CASE WHEN status = 'confirmed' AND checked_in_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS ticketCheckedIn
    FROM registrations WHERE event_id = ?
  `).get(eventId);
  const guestCheckedIn = db.prepare(`
    SELECT COALESCE(SUM(group_size), 0) AS count FROM guests
    WHERE event_id = ? AND checked_in_at IS NOT NULL
  `).get(eventId).count;
  attendance.confirmed = Number(attendance.confirmed);
  attendance.pendingPayment = Number(attendance.pendingPayment);
  attendance.ticketCheckedIn = Number(attendance.ticketCheckedIn);
  attendance.guestCheckedIn = Number(guestCheckedIn);
  const incidents = db.prepare('SELECT * FROM event_incidents WHERE event_id = ? ORDER BY status, created_at DESC, id DESC').all(eventId);
  const announcements = db.prepare('SELECT * FROM event_announcements WHERE event_id = ? ORDER BY created_at DESC, id DESC LIMIT 10').all(eventId);
  const feedback = db.prepare(`
    SELECT event_feedback.*, registrations.full_name AS attendee_name
    FROM event_feedback JOIN registrations ON registrations.id = event_feedback.registration_id
    WHERE event_feedback.event_id = ? ORDER BY event_feedback.created_at DESC, event_feedback.id DESC
    LIMIT 100
  `).all(eventId);
  const feedbackSummary = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average
    FROM event_feedback WHERE event_id = ?
  `).get(eventId);
  const guestAttendance = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN rsvp_status = 'attending' THEN group_size ELSE 0 END), 0) AS confirmed
    FROM guests WHERE event_id = ?
  `).get(eventId).confirmed;
  const catering = {
    portions: Math.ceil(Number(guestAttendance) * (1 + event.catering_allowance_percent / 100)),
  };
  const report = {
    registered: attendance.confirmed,
    checkedIn: attendance.ticketCheckedIn,
    attendanceRate: attendance.confirmed ? Math.round((attendance.ticketCheckedIn / attendance.confirmed) * 100) : 0,
    noShowRate: attendance.confirmed ? Math.round(((attendance.confirmed - attendance.ticketCheckedIn) / attendance.confirmed) * 100) : 0,
    ticketRevenue: db.prepare(`
      SELECT COALESCE(SUM(ticket_types.price), 0) AS amount
      FROM registrations JOIN ticket_types ON ticket_types.id = registrations.ticket_type_id
      WHERE registrations.event_id = ? AND registrations.status = 'confirmed'
    `).get(eventId).amount,
    expensesActual: expenseTotals.actual,
    invoicesPaid: db.prepare(`
      SELECT COALESCE(SUM(invoices.amount), 0) AS amount
      FROM invoices JOIN vendors ON vendors.id = invoices.vendor_id
      WHERE vendors.event_id = ? AND invoices.status = 'paid'
    `).get(eventId).amount,
    feedbackCount: Number(feedbackSummary.count),
    averageRating: Number(feedbackSummary.average),
  };
  response.render('operations', {
    event,
    module,
    vendors,
    staff,
    zones,
    tasks,
    expenses,
    expenseTotals,
    ticketTypes,
    registrations,
    attendance,
    incidents,
    announcements,
    feedback,
    report,
    catering,
    customQuestions,
  });
}

app.post('/events/:id/logistics/zones', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const label = String(request.body.label || '').trim();
  const zoneType = String(request.body.zone_type || 'Other');
  const positionXText = String(request.body.position_x || '').trim();
  const positionYText = String(request.body.position_y || '').trim();
  const positionX = /^\d{1,3}(?:\.\d{1,2})?$/.test(positionXText) ? Number(positionXText) : NaN;
  const positionY = /^\d{1,3}(?:\.\d{1,2})?$/.test(positionYText) ? Number(positionYText) : NaN;
  const notes = String(request.body.notes || '').trim();
  const allowedTypes = new Set(['Stage', 'Entrance', 'Seating', 'Catering', 'Emergency exit', 'Registration', 'Other']);
  if (!label || label.length > 80 || !allowedTypes.has(zoneType)
    || !Number.isFinite(positionX) || positionX < 0 || positionX > 100
    || !Number.isFinite(positionY) || positionY < 0 || positionY > 100 || notes.length > 240) {
    setNotice(request, 'Enter a map label, valid area type, 0–100% map positions, and notes under 240 characters.');
    return response.redirect(`/events/${eventId}/logistics`);
  }
  db.prepare('INSERT INTO event_zones (event_id, label, zone_type, position_x, position_y, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(eventId, label, zoneType, positionX, positionY, notes);
  recordChange(eventId, `Venue map area added: ${label}.`);
  setNotice(request, 'Venue map area added.');
  response.redirect(`/events/${eventId}/logistics`);
});

app.post('/events/:id/logistics/zones/:zoneId/delete', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const zoneId = Number(request.params.zoneId);
  if (!Number.isSafeInteger(zoneId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const result = db.prepare('DELETE FROM event_zones WHERE id = ? AND event_id = ?').run(zoneId, eventId);
  if (!result.changes) return response.sendStatus(404);
  setNotice(request, 'Venue map area removed.');
  response.redirect(`/events/${eventId}/logistics`);
});

app.post('/events/:id/logistics/staff', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const name = String(request.body.name || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const role = String(request.body.role || '').trim();
  if (!name || name.length > 80 || email.length > 160 || (email && !emailPattern.test(email))
    || !role || role.length > 60) {
    setNotice(request, 'Enter a team member name, valid optional email, and role.');
    return response.redirect(`/events/${eventId}/logistics`);
  }
  db.prepare('INSERT INTO event_staff (event_id, name, email, role) VALUES (?, ?, ?, ?)')
    .run(eventId, name, email, role);
  recordChange(eventId, `${name} was added to the event team.`);
  setNotice(request, 'Team member added.');
  response.redirect(`/events/${eventId}/logistics`);
});

app.post('/events/:id/logistics/vendors/:vendorId/contract', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const vendorId = Number(request.params.vendorId);
  if (!Number.isSafeInteger(vendorId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const vendor = db.prepare('SELECT id, name FROM vendors WHERE id = ? AND event_id = ?').get(vendorId, eventId);
  if (!vendor) return response.sendStatus(404);
  const reference = String(request.body.reference || '').trim();
  const terms = String(request.body.terms || '').trim();
  const agreedAmount = parseAmount(request.body.agreed_amount);
  const depositAmount = parseAmount(request.body.deposit_amount);
  const dueDate = String(request.body.due_date || '').trim();
  const status = String(request.body.status || '');
  if (reference.length > 100 || terms.length > 3000 || agreedAmount === null || depositAmount === null
    || depositAmount > agreedAmount || (dueDate && !isValidDate(dueDate))
    || !['draft', 'sent', 'signed', 'complete', 'cancelled'].includes(status)) {
    setNotice(request, 'Check the contract reference, terms, amounts, due date, and status.');
    return response.redirect(`/events/${eventId}/logistics`);
  }
  db.prepare(`
    INSERT INTO vendor_contracts (event_id, vendor_id, reference, terms, agreed_amount, deposit_amount, due_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vendor_id) DO UPDATE SET
      reference = excluded.reference, terms = excluded.terms,
      agreed_amount = excluded.agreed_amount, deposit_amount = excluded.deposit_amount,
      due_date = excluded.due_date, status = excluded.status, reminder_sent_at = NULL
  `).run(eventId, vendorId, reference, terms, agreedAmount, depositAmount, dueDate, status);
  recordChange(eventId, `${vendor.name}'s contract record was updated (${status}).`);
  setNotice(request, 'Contract record saved.');
  response.redirect(`/events/${eventId}/logistics`);
});

app.post('/events/:id/logistics/expenses', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const category = String(request.body.category || '').trim();
  const description = String(request.body.description || '').trim();
  const estimatedAmount = parseAmount(request.body.estimated_amount);
  const actualAmount = parseAmount(request.body.actual_amount);
  const expenseDate = String(request.body.expense_date || '').trim();
  const vendorId = request.body.vendor_id ? Number(request.body.vendor_id) : null;
  const status = String(request.body.status || '');
  const notes = String(request.body.notes || '').trim();
  const vendor = vendorId && Number.isSafeInteger(vendorId)
    ? db.prepare('SELECT id FROM vendors WHERE id = ? AND event_id = ?').get(vendorId, eventId)
    : null;
  if (!category || category.length > 80 || !description || description.length > 160
    || estimatedAmount === null || actualAmount === null
    || (expenseDate && !isValidDate(expenseDate)) || (vendorId && !vendor)
    || !['planned', 'paid'].includes(status) || notes.length > 500) {
    setNotice(request, 'Check the expense description, category, amounts, date, vendor, and status.');
    return response.redirect(`/events/${eventId}/logistics`);
  }
  db.prepare(`
    INSERT INTO expenses (event_id, vendor_id, category, description, estimated_amount, actual_amount, expense_date, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, vendorId, category, description, estimatedAmount, actualAmount, expenseDate, status, notes);
  recordChange(eventId, `Expense recorded: ${description}.`);
  emitEventUpdate(eventId, `An event expense was recorded: ${description}.`);
  setNotice(request, 'Expense added.');
  response.redirect(`/events/${eventId}/logistics`);
});

app.post('/events/:id/logistics/expenses/:expenseId/delete', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const expenseId = Number(request.params.expenseId);
  if (!Number.isSafeInteger(expenseId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const result = db.prepare('DELETE FROM expenses WHERE id = ? AND event_id = ?').run(expenseId, eventId);
  if (!result.changes) return response.sendStatus(404);
  recordChange(eventId, 'An expense record was removed.');
  setNotice(request, 'Expense removed.');
  response.redirect(`/events/${eventId}/logistics`);
});

app.post('/events/:id/logistics/expenses/:expenseId/update', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const expenseId = Number(request.params.expenseId);
  if (!Number.isSafeInteger(expenseId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const description = String(request.body.description || '').trim();
  const estimatedAmount = parseAmount(request.body.estimated_amount);
  const actualAmount = parseAmount(request.body.actual_amount);
  const status = String(request.body.status || '');
  if (!description || description.length > 160 || estimatedAmount === null || actualAmount === null
    || !['planned', 'paid'].includes(status)) {
    setNotice(request, 'Enter a description, valid estimate and actual amount, and an expense status.');
    return response.redirect(`/events/${eventId}/logistics`);
  }
  const result = db.prepare(`
    UPDATE expenses SET description = ?, estimated_amount = ?, actual_amount = ?, status = ?
    WHERE id = ? AND event_id = ?
  `).run(description, estimatedAmount, actualAmount, status, expenseId, eventId);
  if (!result.changes) return response.sendStatus(404);
  recordChange(eventId, `Expense updated: ${description}.`);
  emitEventUpdate(eventId, 'An event expense was updated.');
  setNotice(request, 'Expense updated.');
  response.redirect(`/events/${eventId}/logistics`);
});

app.post('/events/:id/tickets/settings', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const rawQuestions = String(request.body.custom_questions || '').split(/\r?\n/);
  const questions = [...new Set(rawQuestions.map((question) => question.trim()).filter(Boolean))];
  if (questions.length > 5 || questions.some((question) => question.length > 120)) {
    setNotice(request, 'Use up to 5 registration questions, each no longer than 120 characters.');
    return response.redirect(`/events/${eventId}/tickets`);
  }
  const registrationIsOpen = request.body.registration_is_open === 'on' ? 1 : 0;
  const hasTicketTypes = db.prepare('SELECT COUNT(*) AS count FROM ticket_types WHERE event_id = ?').get(eventId).count > 0;
  if (registrationIsOpen && !hasTicketTypes) {
    setNotice(request, 'Add at least one ticket category before opening registration.');
    return response.redirect(`/events/${eventId}/tickets`);
  }
  db.prepare('UPDATE events SET custom_questions = ?, registration_is_open = ? WHERE id = ?')
    .run(JSON.stringify(questions), registrationIsOpen, eventId);
  recordChange(eventId, registrationIsOpen ? 'Public ticket registration was opened.' : 'Public ticket registration settings were updated.');
  setNotice(request, registrationIsOpen ? 'Registration form saved and opened.' : 'Registration settings saved; public registration is closed.');
  response.redirect(`/events/${eventId}/tickets`);
});

app.post('/events/:id/tickets/types', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const name = String(request.body.name || '').trim();
  const price = parseAmount(request.body.price);
  const capacityText = String(request.body.capacity || '');
  const capacity = /^\d{1,6}$/.test(capacityText) ? Number(capacityText) : null;
  if (!name || name.length > 60 || price === null || price > 9999999 || capacity === null || capacity < 1 || capacity > 100000) {
    setNotice(request, 'Enter a ticket name, non-negative price, and capacity between 1 and 100,000.');
    return response.redirect(`/events/${eventId}/tickets`);
  }
  try {
    db.prepare('INSERT INTO ticket_types (event_id, name, price, capacity) VALUES (?, ?, ?, ?)')
      .run(eventId, name, price, capacity);
  } catch (error) {
    if (error.errcode === 2067 || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      setNotice(request, 'A ticket category with that name already exists.');
      return response.redirect(`/events/${eventId}/tickets`);
    }
    throw error;
  }
  recordChange(eventId, `Ticket category added: ${name}.`);
  setNotice(request, 'Ticket category added.');
  response.redirect(`/events/${eventId}/tickets`);
});

app.post('/events/:id/tickets/types/:ticketTypeId/delete', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const ticketTypeId = Number(request.params.ticketTypeId);
  if (!Number.isSafeInteger(ticketTypeId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const registrations = db.prepare('SELECT COUNT(*) AS count FROM registrations WHERE ticket_type_id = ?')
    .get(ticketTypeId).count;
  if (registrations) {
    setNotice(request, 'Ticket categories with registrations cannot be removed.');
    return response.redirect(`/events/${eventId}/tickets`);
  }
  const result = db.prepare('DELETE FROM ticket_types WHERE id = ? AND event_id = ?').run(ticketTypeId, eventId);
  if (!result.changes) {
    setNotice(request, 'Ticket categories with registrations cannot be removed.');
    return response.redirect(`/events/${eventId}/tickets`);
  }
  setNotice(request, 'Ticket category removed.');
  response.redirect(`/events/${eventId}/tickets`);
});

app.post('/events/:id/tickets/:registrationId/verify-payment', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const registrationId = Number(request.params.registrationId);
  if (!Number.isSafeInteger(registrationId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const reference = String(request.body.payment_reference || '').trim();
  if (!reference || reference.length > 100) {
    setNotice(request, 'Enter the receipt or transaction reference you have independently verified.');
    return response.redirect(`/events/${eventId}/tickets`);
  }
  const registration = db.prepare(`
    SELECT registrations.*, ticket_types.name AS ticket_name, events.title AS event_title
    FROM registrations JOIN ticket_types ON ticket_types.id = registrations.ticket_type_id
    JOIN events ON events.id = registrations.event_id
    WHERE registrations.id = ? AND registrations.event_id = ?
  `).get(registrationId, eventId);
  if (!registration || registration.status !== 'awaiting_payment' || !registration.payment_method) return response.sendStatus(404);
  db.prepare("UPDATE registrations SET status = 'confirmed', payment_reference = ? WHERE id = ?")
    .run(reference, registrationId);
  recordChange(eventId, `Payment for ${registration.full_name}'s ${registration.ticket_name} ticket was manually verified by the organizer.`);
  emitEventUpdate(eventId, 'A ticket payment was verified and a ticket issued.');
  const sent = await sendMail({
    to: registration.email,
    subject: `Payment verified: ${registration.event_title}`,
    text: `Hello ${registration.full_name},\n\nYour payment was verified by the event organizer. Your ${registration.ticket_name} ticket is confirmed. Open your ticket and QR code here:\n${ticketPageUrl(registration.qr_token)}\n\nKeep this link private.`,
  });
  setNotice(request, sent
    ? `Payment verified and ticket issued to ${registration.full_name}${demoEmailNote}.`
    : `Payment was verified and the ticket is issued, but the confirmation email to ${registration.full_name} failed.`);
  response.redirect(`/events/${eventId}/tickets`);
});

app.post('/events/:id/tickets/:registrationId/cancel', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const registrationId = Number(request.params.registrationId);
  if (!Number.isSafeInteger(registrationId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const result = db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ? AND event_id = ? AND status <> 'cancelled'")
    .run(registrationId, eventId);
  if (!result.changes) return response.sendStatus(404);
  recordChange(eventId, 'A ticket registration was cancelled. Any external refund must be processed separately.');
  emitEventUpdate(eventId, 'A ticket registration was cancelled.');
  setNotice(request, 'Ticket registration cancelled. Process any applicable external refund separately.');
  response.redirect(`/events/${eventId}/tickets`);
});

app.post('/events/:id/logistics/tasks/:taskId/toggle', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const taskId = Number(request.params.taskId);
  if (!Number.isSafeInteger(taskId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const task = db.prepare('SELECT id, title, completed FROM tasks WHERE id = ? AND event_id = ?').get(taskId, eventId);
  if (!task) return response.sendStatus(404);
  const completed = task.completed ? 0 : 1;
  db.prepare('UPDATE tasks SET completed = ? WHERE id = ? AND event_id = ?').run(completed, taskId, eventId);
  recordChange(eventId, `Task "${task.title}" marked ${completed ? 'complete' : 'open'}.`);
  setNotice(request, completed ? 'Task completed.' : 'Task reopened.');
  response.redirect(`/events/${eventId}/logistics`);
});

app.post('/events/:id/event-day/vendors/:vendorId/arrival', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const vendorId = Number(request.params.vendorId);
  const status = String(request.body.arrival_status || '');
  if (!Number.isSafeInteger(vendorId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  if (!['not_arrived', 'arrived', 'setting_up', 'ready', 'delayed'].includes(status)) return response.sendStatus(400);
  const result = db.prepare('UPDATE vendors SET arrival_status = ? WHERE id = ? AND event_id = ?').run(status, vendorId, eventId);
  if (!result.changes) return response.sendStatus(404);
  recordChange(eventId, `Vendor setup status changed to ${status.replace('_', ' ')}.`);
  emitEventUpdate(eventId, 'A vendor arrival status was updated.');
  response.redirect(`/events/${eventId}/event-day`);
});

app.post('/events/:id/event-day/meals', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const countText = String(request.body.meals_served_count || '');
  const count = /^\d{1,6}$/.test(countText) ? Number(countText) : null;
  if (count === null || count > 100000) {
    setNotice(request, 'Enter a meal count between 0 and 100,000.');
    return response.redirect(`/events/${eventId}/event-day`);
  }
  db.prepare('UPDATE events SET meals_served_count = ? WHERE id = ?').run(count, eventId);
  recordChange(eventId, `Catering service count updated: ${count} meals served.`);
  emitEventUpdate(eventId, 'The catering meal count was updated.');
  response.redirect(`/events/${eventId}/event-day`);
});

app.post('/events/:id/event-day/incidents', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const reportedBy = String(request.body.reported_by || '').trim();
  const title = String(request.body.title || '').trim();
  const severity = String(request.body.severity || '');
  const details = String(request.body.details || '').trim();
  if (!reportedBy || reportedBy.length > 80 || !title || title.length > 120 || details.length > 1000
    || !['low', 'normal', 'high'].includes(severity)) {
    setNotice(request, 'Enter a reporter, issue, valid severity, and details under 1,000 characters.');
    return response.redirect(`/events/${eventId}/event-day`);
  }
  db.prepare('INSERT INTO event_incidents (event_id, reported_by, title, details, severity) VALUES (?, ?, ?, ?, ?)')
    .run(eventId, reportedBy, title, details, severity);
  recordChange(eventId, `Incident reported: ${title} (${severity}).`);
  emitEventUpdate(eventId, `An event incident was reported: ${title}.`);
  response.redirect(`/events/${eventId}/event-day`);
});

app.post('/events/:id/event-day/incidents/:incidentId/resolve', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const incidentId = Number(request.params.incidentId);
  if (!Number.isSafeInteger(incidentId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const result = db.prepare("UPDATE event_incidents SET status = 'resolved', resolved_at = datetime('now') WHERE id = ? AND event_id = ? AND status = 'open'")
    .run(incidentId, eventId);
  if (!result.changes) return response.sendStatus(404);
  recordChange(eventId, 'An event incident was marked resolved.');
  response.redirect(`/events/${eventId}/event-day`);
});

app.post('/events/:id/event-day/announcements', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const event = eventForOwner(eventId, request.currentUser.id);
  if (!event) return response.sendStatus(404);
  const subject = String(request.body.subject || '').trim();
  const message = String(request.body.message || '').trim();
  if (!subject || subject.length > 120 || !message || message.length > 2000) {
    setNotice(request, 'Enter an announcement subject and message within the character limits.');
    return response.redirect(`/events/${eventId}/event-day`);
  }
  const attendees = db.prepare(`
    SELECT email, full_name AS name FROM registrations
    WHERE event_id = ? AND status = 'confirmed'
    UNION
    SELECT email, name FROM guests
    WHERE event_id = ? AND rsvp_status = 'attending' AND email <> ''
  `).all(eventId, eventId);
  let sentCount = 0;
  for (const attendee of attendees) {
    const sent = await sendMail({
      to: attendee.email,
      subject: `${subject} · ${event.title}`,
      text: `Hello ${attendee.name},\n\n${message}\n\nEvent: ${event.title} · ${event.event_date}${event.venue ? ` · ${event.venue}` : ''}`,
    });
    if (sent) sentCount += 1;
  }
  db.prepare('INSERT INTO event_announcements (event_id, subject, message, sent_count) VALUES (?, ?, ?, ?)')
    .run(eventId, subject, message, sentCount);
  recordChange(eventId, `Event announcement sent to ${sentCount} attendees: ${subject}.`);
  setNotice(request, attendees.length
    ? `Announcement sent to ${sentCount} of ${attendees.length} attendees${demoEmailNote}.`
    : 'Announcement saved. There are no confirmed attendees with email addresses yet.');
  response.redirect(`/events/${eventId}/event-day`);
});

function sendEventReport(request, response, eventId) {
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.currentUser.id);
  if (!event) return response.sendStatus(404);
  const rows = [
    ['Metric', 'Value'],
    ['Event', event.title],
    ['Event date', event.event_date],
    ['Budget', event.budget_total],
    ['Expected guests', event.expected_guests],
    ['Confirmed tickets', db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'confirmed'").get(eventId).count],
    ['Checked-in tickets', db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'confirmed' AND checked_in_at IS NOT NULL").get(eventId).count],
    ['Awaiting payment', db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'awaiting_payment'").get(eventId).count],
    ['Ticket revenue (confirmed)', db.prepare(`
      SELECT COALESCE(SUM(ticket_types.price), 0) AS amount FROM registrations
      JOIN ticket_types ON ticket_types.id = registrations.ticket_type_id
      WHERE registrations.event_id = ? AND registrations.status = 'confirmed'
    `).get(eventId).amount],
    ['Actual expenses', db.prepare('SELECT COALESCE(SUM(actual_amount), 0) AS amount FROM expenses WHERE event_id = ?').get(eventId).amount],
    ['Paid vendor invoices', db.prepare(`
      SELECT COALESCE(SUM(invoices.amount), 0) AS amount FROM invoices
      JOIN vendors ON vendors.id = invoices.vendor_id WHERE vendors.event_id = ? AND invoices.status = 'paid'
    `).get(eventId).amount],
    ['Meals served', event.meals_served_count],
    ['Average feedback rating', db.prepare('SELECT COALESCE(AVG(rating), 0) AS rating FROM event_feedback WHERE event_id = ?').get(eventId).rating],
  ].map((row) => row.map(csvCell).join(','));
  response.type('text/csv').set('Content-Disposition', `attachment; filename="event-${eventId}-report.csv"`)
    .send(rows.join('\r\n'));
}


app.get('/events/:id/guests/:guestId/qr', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const guestId = Number(request.params.guestId);
  if (!Number.isSafeInteger(eventId) || !Number.isSafeInteger(guestId)
    || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const guest = db.prepare('SELECT checkin_token FROM guests WHERE id = ? AND event_id = ?').get(guestId, eventId);
  if (!guest) return response.sendStatus(404);
  const png = await QRCode.toBuffer(guest.checkin_token, { type: 'png', width: 320, margin: 2 });
  response.type('png').set('Cache-Control', 'private, no-store').send(png);
});

app.get('/guest/rsvp/:token', (request, response) => {
  const token = String(request.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(404);
  const guest = db.prepare(`
    SELECT guests.id, guests.name, guests.group_size, guests.rsvp_status, guests.checked_in_at,
      events.title AS event_title, events.event_date, events.venue
    FROM guests JOIN events ON events.id = guests.event_id
    WHERE guests.rsvp_token = ?
  `).get(token);
  if (!guest) return response.sendStatus(404);
  response.render('guest-rsvp', { guest, token, saved: false });
});

app.post('/guest/rsvp/:token', (request, response) => {
  const token = String(request.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(404);
  const guest = db.prepare('SELECT id, event_id, checked_in_at FROM guests WHERE rsvp_token = ?').get(token);
  if (!guest) return response.sendStatus(404);
  const status = String(request.body.rsvp_status || '');
  if (!['attending', 'declined'].includes(status) || (guest.checked_in_at && status !== 'attending')) {
    return response.status(400).render('message', {
      title: 'RSVP not saved',
      message: 'Choose attending or declined. Guests who have checked in remain marked as attending.',
      href: `/guest/rsvp/${token}`,
      linkText: 'Return to your invitation',
      vendorView: false,
    });
  }
  db.prepare('UPDATE guests SET rsvp_status = ? WHERE id = ?').run(status, guest.id);
  const updatedGuest = db.prepare(`
    SELECT guests.id, guests.name, guests.group_size, guests.rsvp_status, guests.checked_in_at,
      events.title AS event_title, events.event_date, events.venue
    FROM guests JOIN events ON events.id = guests.event_id WHERE guests.id = ?
  `).get(guest.id);
  recordChange(guest.event_id, `${updatedGuest.name} RSVP updated: ${updatedGuest.rsvp_status}.`);
  emitEventUpdate(guest.event_id, 'A guest RSVP was updated.');
  response.render('guest-rsvp', { guest: updatedGuest, token, saved: true });
});

app.post('/events/:id/venue', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.session.user.id);
  if (!event) return response.sendStatus(404);
  const venue = String(request.body.venue || '').trim();
  const venueNotes = String(request.body.venue_notes || '').trim();
  if (venue.length > 160 || venueNotes.length > 1000) {
    setNotice(request, 'Keep the venue under 160 characters and the arrival notes under 1,000 characters.');
    return response.redirect(`/events/${eventId}`);
  }
  if (venue === event.venue && venueNotes === event.venue_notes) {
    setNotice(request, 'Venue details are unchanged.');
    return response.redirect(`/events/${eventId}`);
  }
  db.prepare('UPDATE events SET venue = ?, venue_notes = ? WHERE id = ?')
    .run(venue, venueNotes, eventId);
  const message = 'Venue details or arrival notes were updated.';
  recordChange(eventId, message);
  emitEventUpdate(eventId, message);
  await emailEventChange(eventId, null, message);
  response.redirect(`/events/${eventId}`);
});

app.post('/events/:id/budget', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.currentUser.id);
  if (!event) return response.sendStatus(404);
  const budgetTotal = parseAmount(request.body.budget_total);
  const budgetCurrency = String(request.body.budget_currency || '').trim().toUpperCase();
  const expectedGuestsText = String(request.body.expected_guests || '').trim();
  const expectedGuests = /^\d{1,6}$/.test(expectedGuestsText) ? Number(expectedGuestsText) : null;
  if (budgetTotal === null || !/^[A-Z]{3}$/.test(budgetCurrency)
    || expectedGuests === null || expectedGuests > 100000) {
    setNotice(request, 'Enter a non-negative budget, a three-letter currency code, and up to 100,000 expected guests.');
    return response.redirect(`/events/${eventId}/budget`);
  }
  db.prepare('UPDATE events SET budget_total = ?, budget_currency = ?, expected_guests = ? WHERE id = ?')
    .run(budgetTotal, budgetCurrency, expectedGuests, eventId);
  recordChange(eventId, 'The event budget and expected guest count were updated.');
  setNotice(request, 'Budget and expected guest count saved.');
  response.redirect(`/events/${eventId}/budget`);
});

app.post('/events/:id/guests', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isSafeInteger(eventId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const name = String(request.body.name || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const groupSizeText = String(request.body.group_size || '1').trim();
  const groupSize = /^\d{1,4}$/.test(groupSizeText) ? Number(groupSizeText) : null;
  const status = String(request.body.rsvp_status || 'awaiting');
  if (!name || name.length > 120 || email.length > 160 || (email && !emailPattern.test(email))
    || groupSize === null || groupSize < 1 || groupSize > 1000
    || !['attending', 'declined', 'awaiting'].includes(status)) {
    setNotice(request, 'Enter a guest name, valid email if provided, group size between 1 and 1,000, and a valid RSVP status.');
    return response.redirect(`/events/${eventId}/guests`);
  }
  db.prepare(`
    INSERT INTO guests (event_id, name, email, group_size, rsvp_status, rsvp_token, checkin_token)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    name,
    email,
    groupSize,
    status,
    crypto.randomBytes(32).toString('hex'),
    crypto.randomBytes(32).toString('hex'),
  );
  recordChange(eventId, 'The guest list was updated.');
  setNotice(request, email ? 'Guest added. Send the invitation from the guest list.' : 'Guest added. Add an email address to send a private RSVP link.');
  response.redirect(`/events/${eventId}/guests`);
});

app.post('/events/:id/guests/:guestId/update', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const guestId = Number(request.params.guestId);
  if (!Number.isSafeInteger(eventId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const guest = Number.isSafeInteger(guestId)
    && db.prepare('SELECT id, email, checked_in_at FROM guests WHERE id = ? AND event_id = ?').get(guestId, eventId);
  if (!guest) return response.sendStatus(404);
  const name = String(request.body.name || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const groupSizeText = String(request.body.group_size || '').trim();
  const groupSize = /^\d{1,4}$/.test(groupSizeText) ? Number(groupSizeText) : null;
  const status = String(request.body.rsvp_status || '');
  if (!name || name.length > 120 || email.length > 160 || (email && !emailPattern.test(email))
    || groupSize === null || groupSize < 1 || groupSize > 1000
    || (guest.checked_in_at && status !== 'attending')
    || !['attending', 'declined', 'awaiting'].includes(status)) {
    setNotice(request, 'Enter a guest name, valid email if provided, group size between 1 and 1,000, and a valid RSVP status.');
    return response.redirect(`/events/${eventId}`);
  }
  const emailChanged = email !== guest.email;
  const tokenSql = emailChanged
    ? ', rsvp_token = ?, checkin_token = ?'
    : '';
  const values = [name, email, groupSize, status];
  if (emailChanged) values.push(crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'));
  values.push(guestId, eventId);
  db.prepare(`
    UPDATE guests SET name = ?, email = ?, group_size = ?, rsvp_status = ?${tokenSql}
    WHERE id = ? AND event_id = ?
  `).run(...values);
  recordChange(eventId, 'The guest list was updated.');
  setNotice(request, emailChanged ? 'Guest details saved. The old invitation and check-in QR are no longer valid.' : 'Guest RSVP saved.');
  response.redirect(`/events/${eventId}/guests`);
});

app.post('/events/:id/guests/:guestId/delete', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const guestId = Number(request.params.guestId);
  if (!Number.isSafeInteger(eventId) || !Number.isSafeInteger(guestId)
    || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const result = db.prepare('DELETE FROM guests WHERE id = ? AND event_id = ?').run(guestId, eventId);
  if (!result.changes) return response.sendStatus(404);
  recordChange(eventId, 'The guest list was updated.');
  setNotice(request, 'Guest removed.');
  response.redirect(`/events/${eventId}`);
});

app.post('/events/:id/guests/:guestId/invite', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const guestId = Number(request.params.guestId);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.currentUser.id);
  if (!event) return response.sendStatus(404);
  const guest = Number.isSafeInteger(guestId)
    && db.prepare('SELECT * FROM guests WHERE id = ? AND event_id = ?').get(guestId, eventId);
  if (!guest) return response.sendStatus(404);
  if (!guest.email || !emailPattern.test(guest.email)) {
    setNotice(request, `Add a valid email address for ${guest.name} before sending an invitation.`);
  } else {
    const sent = await sendGuestInvitation(guest, event, request);
    if (sent) {
      recordChange(eventId, `A guest invitation and check-in QR were emailed to ${guest.name}${demoEmailNote}.`);
      setNotice(request, `Invitation and check-in QR sent to ${guest.name}${demoEmailNote}.`);
    } else {
      setNotice(request, `Could not email ${guest.name}. Check SMTP settings and try again.`);
    }
  }
  response.redirect(`/events/${eventId}/guests`);
});

app.post('/events/:id/guests/check-in', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const token = String(request.body.checkin_token || '');
  if (!Number.isSafeInteger(eventId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  if (!/^[a-f0-9]{64}$/.test(token)) {
    if (request.accepts('json')) return response.status(400).json({ error: 'That check-in code is not valid.' });
    setNotice(request, 'Enter a valid guest check-in code.');
    return response.redirect(`/events/${eventId}/guests`);
  }
  const guest = db.prepare('SELECT id, name, checked_in_at FROM guests WHERE event_id = ? AND checkin_token = ?')
    .get(eventId, token);
  if (!guest) {
    if (request.accepts('json')) return response.status(404).json({ error: 'That code does not belong to a guest at this event.' });
    setNotice(request, 'That check-in code does not belong to a guest at this event.');
    return response.redirect(`/events/${eventId}/guests`);
  }
  if (guest.checked_in_at) {
    const message = `${guest.name} has already checked in.`;
    if (request.accepts('json')) return response.status(409).json({ error: message });
    setNotice(request, message);
    return response.redirect(`/events/${eventId}/guests`);
  }
  db.prepare("UPDATE guests SET rsvp_status = 'attending', checked_in_at = datetime('now') WHERE id = ?")
    .run(guest.id);
  const message = `${guest.name} checked in.`;
  recordChange(eventId, message);
  emitEventUpdate(eventId, message);
  if (request.accepts('json')) return response.json({ message });
  setNotice(request, message);
  response.redirect(`/events/${eventId}/guests`);
});

app.post('/events/:id/catering/allowance', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isSafeInteger(eventId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const allowanceText = String(request.body.allowance_percent || '').trim();
  const allowance = /^(?:\d{1,3})(?:\.\d{1,2})?$/.test(allowanceText) ? Number(allowanceText) : null;
  if (allowance === null || allowance < 0 || allowance > 200) {
    setNotice(request, 'Enter a catering allowance between 0 and 200 percent.');
    return response.redirect(`/events/${eventId}/catering`);
  }
  db.prepare('UPDATE events SET catering_allowance_percent = ? WHERE id = ?').run(allowance, eventId);
  recordChange(eventId, 'The catering extra allowance was updated.');
  setNotice(request, 'Catering allowance saved.');
  response.redirect(`/events/${eventId}/catering`);
});

app.post('/events/:id/catering/items', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isSafeInteger(eventId) || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const name = String(request.body.name || '').trim();
  const unit = String(request.body.unit || '').trim();
  const amountPerPortion = parseQuantity(request.body.amount_per_portion);
  const costPerUnit = parseAmount(request.body.cost_per_unit);
  if (!name || name.length > 100 || !unit || unit.length > 24
    || amountPerPortion === null || costPerUnit === null) {
    setNotice(request, 'Enter an item, unit (up to 24 characters), valid quantity per portion, and non-negative unit cost.');
    return response.redirect(`/events/${eventId}/catering`);
  }
  db.prepare(`
    INSERT INTO catering_items (event_id, name, amount_per_portion, unit, cost_per_unit)
    VALUES (?, ?, ?, ?, ?)
  `).run(eventId, name, amountPerPortion, unit, costPerUnit);
  recordChange(eventId, `Catering item added: ${name}.`);
  setNotice(request, 'Catering item added.');
  response.redirect(`/events/${eventId}/catering`);
});

app.post('/events/:id/catering/items/:itemId/update', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const itemId = Number(request.params.itemId);
  if (!Number.isSafeInteger(eventId) || !Number.isSafeInteger(itemId)
    || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const item = db.prepare('SELECT id FROM catering_items WHERE id = ? AND event_id = ?').get(itemId, eventId);
  if (!item) return response.sendStatus(404);
  const name = String(request.body.name || '').trim();
  const unit = String(request.body.unit || '').trim();
  const amountPerPortion = parseQuantity(request.body.amount_per_portion);
  const costPerUnit = parseAmount(request.body.cost_per_unit);
  const overrideText = String(request.body.quantity_override || '').trim();
  const quantityOverride = overrideText ? parseQuantity(overrideText) : null;
  if (!name || name.length > 100 || !unit || unit.length > 24
    || amountPerPortion === null || costPerUnit === null
    || (overrideText && quantityOverride === null)) {
    setNotice(request, 'Enter a valid item, unit, per-portion quantity, unit cost, and optional final quantity.');
    return response.redirect(`/events/${eventId}/catering`);
  }
  db.prepare(`
    UPDATE catering_items
    SET name = ?, amount_per_portion = ?, unit = ?, cost_per_unit = ?, quantity_override = ?
    WHERE id = ? AND event_id = ?
  `).run(name, amountPerPortion, unit, costPerUnit, quantityOverride, itemId, eventId);
  recordChange(eventId, `Catering item updated: ${name}.`);
  setNotice(request, quantityOverride === null ? 'Catering item saved; quantity follows the RSVP calculation.' : 'Final catering quantity saved.');
  response.redirect(`/events/${eventId}/catering`);
});

app.post('/events/:id/catering/items/:itemId/delete', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const itemId = Number(request.params.itemId);
  if (!Number.isSafeInteger(eventId) || !Number.isSafeInteger(itemId)
    || !eventForOwner(eventId, request.currentUser.id)) return response.sendStatus(404);
  const result = db.prepare('DELETE FROM catering_items WHERE id = ? AND event_id = ?').run(itemId, eventId);
  if (!result.changes) return response.sendStatus(404);
  recordChange(eventId, 'A catering item was removed.');
  setNotice(request, 'Catering item removed.');
  response.redirect(`/events/${eventId}/catering`);
});

app.get('/events/:id/catering/shopping-list.csv', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.currentUser.id);
  if (!event) return response.sendStatus(404);
  const guests = db.prepare("SELECT COALESCE(SUM(group_size), 0) AS count FROM guests WHERE event_id = ? AND rsvp_status = 'attending'")
    .get(eventId).count;
  const portions = Math.ceil(guests * (1 + event.catering_allowance_percent / 100));
  const items = db.prepare('SELECT * FROM catering_items WHERE event_id = ? ORDER BY id').all(eventId);
  const rows = [
    ['Event', event.title],
    ['Confirmed guests', guests],
    ['Extra allowance (%)', event.catering_allowance_percent],
    ['Planned portions', portions],
    [],
    ['Food item', 'Final quantity', 'Unit', 'Quantity per portion', 'Unit cost', 'Estimated cost'],
    ...items.map((item) => {
      const quantity = item.quantity_override === null
        ? item.amount_per_portion * portions
        : item.quantity_override;
      return [
        item.name,
        formatQuantity(quantity),
        item.unit,
        item.amount_per_portion,
        item.cost_per_unit.toFixed(2),
        (quantity * item.cost_per_unit).toFixed(2),
      ];
    }),
  ];
  response.type('text/csv; charset=utf-8');
  response.set('Content-Disposition', `attachment; filename="event-${eventId}-shopping-list.csv"`);
  response.send(`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`);
});

app.post('/events/:id/catering/share', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.currentUser.id);
  if (!event) return response.sendStatus(404);
  const vendorId = Number(request.body.vendor_id);
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0) return response.sendStatus(400);
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ? AND event_id = ?').get(vendorId, eventId);
  if (!vendor) return response.sendStatus(404);
  if (!vendor.email || !emailPattern.test(vendor.email)) {
    setNotice(request, 'Add a valid email address to the selected caterer before sharing the shopping list.');
    return response.redirect(`/events/${eventId}/catering`);
  }
  const confirmedGuests = db.prepare("SELECT COALESCE(SUM(group_size), 0) AS count FROM guests WHERE event_id = ? AND rsvp_status = 'attending'")
    .get(eventId).count;
  const portions = Math.ceil(confirmedGuests * (1 + event.catering_allowance_percent / 100));
  const items = db.prepare('SELECT * FROM catering_items WHERE event_id = ? ORDER BY id').all(eventId);
  const lines = items.map((item) => {
    const quantity = item.quantity_override === null
      ? item.amount_per_portion * portions
      : item.quantity_override;
    return `- ${item.name}: ${formatQuantity(quantity)} ${item.unit}${item.quantity_override === null ? '' : ' (planner-adjusted)'}`;
  });
  const sent = await sendMail({
    to: vendor.email,
    subject: `Catering requirements: ${event.title}`,
    text: [
      `Hello ${vendor.name},`,
      '',
      `Catering requirements for ${event.title} on ${event.event_date}:`,
      `Confirmed guests: ${confirmedGuests}`,
      `Extra allowance: ${event.catering_allowance_percent}%`,
      `Planned portions: ${portions}`,
      '',
      ...(lines.length ? lines : ['No food items have been added yet.']),
      '',
      'These are planner estimates; please confirm menu and serving quantities together.',
    ].join('\n'),
  });
  if (!sent) {
    setNotice(request, `Could not email ${vendor.name}. Check SMTP settings and try again.`);
  } else {
    recordChange(eventId, `Catering requirements shared with ${vendor.name}${demoEmailNote}.`);
    setNotice(request, `Catering requirements emailed to ${vendor.name}${demoEmailNote}.`);
  }
  response.redirect(`/events/${eventId}/catering`);
});

app.post('/events/:id/vendors', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.session.user.id)) return response.sendStatus(404);
  const name = String(request.body.name || '').trim();
  const category = String(request.body.category || '').trim();
  const services = String(request.body.services || '').trim();
  const email = String(request.body.email || '').trim();
  const estimatedCost = parseAmount(request.body.estimated_cost);
  const costPerGuest = parseAmount(request.body.cost_per_guest);
  if (!name || name.length > 100 || category.length > 80 || services.length > 1000 || email.length > 160
    || estimatedCost === null || costPerGuest === null
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    setNotice(request, 'Enter a vendor name, valid estimated costs, and a valid email address, if provided.');
    return response.redirect(`/events/${eventId}`);
  }
  const result = db.prepare(`
    INSERT INTO vendors (event_id, name, category, services, email, token, estimated_cost, cost_per_guest)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, name, category, services, email, crypto.randomBytes(32).toString('hex'), estimatedCost, costPerGuest);
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(Number(result.lastInsertRowid));
  const event = eventForOwner(eventId, request.session.user.id);
  recordChange(eventId, `${name} was added as a vendor.`);
  emitEventUpdate(eventId, `${name} was added to the event.`);
  if (email) {
    const sent = await sendVendorInvite(vendor, event, false);
    setNotice(request, sent
      ? `Vendor added. Invitation emailed to ${name}${demoEmailNote}.`
      : 'Vendor added, but the invitation email could not be sent. Check SMTP settings and resend from this page.');
  } else {
    setNotice(request, 'Vendor added. Add an email address if you want to send the private link.');
  }
  response.redirect(`/events/${eventId}`);
});

app.post('/vendors/:profileId/request', requireAuth, async (request, response) => {
  const eventId = Number(request.body.event_id);
  const profileId = Number(request.params.profileId);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.currentUser.id);
  if (!event || !Number.isSafeInteger(profileId) || profileId <= 0) return response.sendStatus(404);
  const profile = db.prepare(`
    SELECT vendor_profiles.vendor_account_id, vendor_profiles.business_name,
      vendor_profiles.category, vendor_profiles.services, vendor_accounts.email
    FROM vendor_profiles
    JOIN vendor_accounts ON vendor_accounts.id = vendor_profiles.vendor_account_id
    WHERE vendor_profiles.id = ? AND vendor_profiles.is_published = 1
  `).get(profileId);
  if (!profile) return response.sendStatus(404);
  const existing = db.prepare('SELECT id FROM vendors WHERE event_id = ? AND account_id = ?')
    .get(eventId, profile.vendor_account_id);
  if (existing) {
    setNotice(request, `${profile.business_name} is already linked to this event.`);
    return response.redirect(`/events/${eventId}#vendor-management`);
  }
  const result = db.prepare(`
    INSERT INTO vendors (event_id, name, category, services, email, token, account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    profile.business_name,
    profile.category,
    profile.services,
    profile.email,
    crypto.randomBytes(32).toString('hex'),
    profile.vendor_account_id,
  );
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(Number(result.lastInsertRowid));
  recordChange(eventId, `${profile.business_name} was invited from Find Vendors.`);
  emitEventUpdate(eventId, `${profile.business_name} was added to the event.`);
  const sent = await sendVendorInvite(vendor, event, false);
  setNotice(request, sent
    ? `${profile.business_name} was added and invited${demoEmailNote}.`
    : `${profile.business_name} was added, but the invitation email could not be sent. Check the email settings.`);
  response.redirect(`/events/${eventId}#vendor-management`);
});

app.post('/events/:id/vendors/:vendorId/update', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const vendorId = Number(request.params.vendorId);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.session.user.id);
  if (!event) return response.sendStatus(404);
  const vendor = Number.isSafeInteger(vendorId)
    && db.prepare('SELECT * FROM vendors WHERE id = ? AND event_id = ?').get(vendorId, eventId);
  if (!vendor) return response.sendStatus(404);
  const name = String(request.body.name || '').trim();
  const category = String(request.body.category || '').trim();
  const services = String(request.body.services || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const estimatedCost = parseAmount(request.body.estimated_cost);
  const costPerGuest = parseAmount(request.body.cost_per_guest);
  if (!name || name.length > 100 || category.length > 80 || services.length > 1000 || email.length > 160
    || estimatedCost === null || costPerGuest === null
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    setNotice(request, 'Enter a vendor name, valid estimated costs, and a valid email address, if provided.');
    return response.redirect(`/events/${eventId}`);
  }
  const emailChanged = email !== vendor.email.trim().toLowerCase();
  const token = emailChanged ? crypto.randomBytes(32).toString('hex') : vendor.token;
  db.prepare(`
    UPDATE vendors SET name = ?, category = ?, services = ?, email = ?, token = ?, estimated_cost = ?, cost_per_guest = ?,
      last_notified_at = CASE WHEN ? THEN NULL ELSE last_notified_at END,
      reminder_count = CASE WHEN ? THEN 0 ELSE reminder_count END
    WHERE id = ? AND event_id = ?
  `).run(name, category, services, email, token, estimatedCost, costPerGuest, Number(emailChanged), Number(emailChanged), vendorId, eventId);
  recordChange(eventId, `${name}'s vendor details were updated.`);
  emitEventUpdate(eventId, `${name}'s vendor details were updated.`);
  if (email && emailChanged) {
    const updatedVendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
    const sent = await sendVendorInvite(updatedVendor, event, false);
    setNotice(request, sent
      ? `Vendor details saved. A fresh private link was emailed to ${name}${demoEmailNote}.`
      : 'Vendor details saved, but the invitation email could not be sent. Resend it from this page.');
  } else {
    setNotice(request, 'Vendor details saved.');
  }
  response.redirect(`/events/${eventId}`);
});

app.post('/events/:id/vendors/:vendorId/regenerate', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const vendorId = Number(request.params.vendorId);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.session.user.id);
  if (!event) return response.sendStatus(404);
  const vendor = Number.isSafeInteger(vendorId)
    && db.prepare('SELECT * FROM vendors WHERE id = ? AND event_id = ?').get(vendorId, eventId);
  if (!vendor) return response.sendStatus(404);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    UPDATE vendors SET token = ?, last_notified_at = NULL, reminder_count = 0
    WHERE id = ? AND event_id = ?
  `).run(token, vendorId, eventId);
  const updatedVendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
  recordChange(eventId, `A fresh private link was created for ${vendor.name}.`);
  emitEventUpdate(eventId, `${vendor.name}'s private link was changed.`);
  if (updatedVendor.email) {
    const sent = await sendVendorInvite(updatedVendor, event, false);
    setNotice(request, sent
      ? `A new private link was emailed to ${vendor.name}${demoEmailNote}. The previous link no longer works.`
      : `The link was changed, but the email to ${vendor.name} could not be sent. Share the new link shown below.`);
  } else {
    setNotice(request, `A new private link was created for ${vendor.name}. Share the new link shown below.`);
  }
  response.redirect(`/events/${eventId}`);
});

app.post('/events/:id/client-link', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isSafeInteger(eventId) || !eventForOwner(eventId, request.session.user.id)) {
    return response.sendStatus(404);
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE events SET client_token = ? WHERE id = ?').run(token, eventId);
  recordChange(eventId, 'The read-only host link was created or replaced.');
  setNotice(request, 'The host link was created. Anyone with the link can view the shared event schedule and vendor responses.');
  response.redirect(`/events/${eventId}`);
});

app.post('/events/:id/client-link/revoke', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isSafeInteger(eventId) || !eventForOwner(eventId, request.session.user.id)) {
    return response.sendStatus(404);
  }
  db.prepare('UPDATE events SET client_token = NULL WHERE id = ?').run(eventId);
  recordChange(eventId, 'The read-only host link was turned off.');
  setNotice(request, 'The host link was turned off.');
  response.redirect(`/events/${eventId}`);
});

app.get('/events/:id/timeline.pdf', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.session.user.id);
  if (!event) return response.sendStatus(404);
  const tasks = db.prepare(`
    SELECT tasks.*, vendors.name AS vendor_name
    FROM tasks LEFT JOIN vendors ON vendors.id = tasks.vendor_id
    WHERE tasks.event_id = ? ORDER BY tasks.start_time, tasks.id
  `).all(eventId);
  const vendors = db.prepare('SELECT name, category, status FROM vendors WHERE event_id = ? ORDER BY name')
    .all(eventId);
  const filename = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'}-timeline.pdf`;
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const document = new PDFDocument({ margin: 54, info: { Title: `${event.title} timeline`, Author: 'Nodevents' } });
  document.pipe(response);
  document.fontSize(22).fillColor('#20251f').text(event.title);
  document.moveDown(0.35);
  document.fontSize(11).fillColor('#71776f')
    .text(`Event type: ${eventTypeLabel(event.event_type)}`);
  document.text(`Event date: ${new Date(`${event.event_date}T12:00:00`).toLocaleDateString()}`);
  document.text(`Venue: ${event.venue || 'To be confirmed'}`);
  if (event.venue_notes) document.text(`Arrival notes: ${event.venue_notes}`);
  document.moveDown();
  document.fontSize(16).fillColor('#20251f').text('Event timeline');
  document.moveDown(0.35);
  if (tasks.length) {
    tasks.forEach((task) => {
      document.fontSize(11).fillColor('#b64d2b')
        .text(new Date(task.start_time).toLocaleString());
      document.fontSize(12).fillColor('#20251f').text(task.title);
      if (task.vendor_name) document.fontSize(10).fillColor('#71776f').text(`Vendor: ${task.vendor_name}`);
      if (task.notes) document.fontSize(10).fillColor('#71776f').text(task.notes);
      document.moveDown(0.65);
    });
  } else {
    document.fontSize(11).fillColor('#71776f').text('No timeline tasks have been added.');
  }
  document.moveDown();
  document.fontSize(16).fillColor('#20251f').text('Vendor responses');
  document.moveDown(0.35);
  if (vendors.length) {
    vendors.forEach((vendor) => {
      document.fontSize(11).fillColor('#20251f')
        .text(`${vendor.name}${vendor.category ? ` · ${vendor.category}` : ''} — ${vendor.status.replace('_', ' ')}`);
    });
  } else {
    document.fontSize(11).fillColor('#71776f').text('No vendors have been added.');
  }
  document.end();
});

app.post('/events/:id/tasks', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.session.user.id)) return response.sendStatus(404);
  const title = String(request.body.title || '').trim();
  const startTime = String(request.body.start_time || '').trim();
  const notes = String(request.body.notes || '').trim();
  const vendorId = request.body.vendor_id ? Number(request.body.vendor_id) : null;
  const vendor = vendorId ? db.prepare('SELECT id FROM vendors WHERE id = ? AND event_id = ?').get(vendorId, eventId) : null;
  const staffId = request.body.assigned_staff_id ? Number(request.body.assigned_staff_id) : null;
  const assignee = staffId && Number.isSafeInteger(staffId)
    ? db.prepare('SELECT id FROM event_staff WHERE id = ? AND event_id = ?').get(staffId, eventId)
    : null;
  const priority = String(request.body.priority || 'normal');
  if (!title || title.length > 160 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startTime)
    || notes.length > 1000 || (vendorId && !vendor) || (staffId && !assignee)
    || !['low', 'normal', 'high'].includes(priority)) {
    setNotice(request, 'Check the task title, date/time, notes, and vendor.');
    return response.redirect(`/events/${eventId}`);
  }
  db.prepare('INSERT INTO tasks (event_id, vendor_id, title, start_time, notes, assigned_staff_id, priority) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(eventId, vendorId, title, startTime, notes, staffId, priority);
  recordChange(eventId, `${title} was added to the timeline.`);
  emitEventUpdate(eventId, `A timeline task was added: ${title}.`);
  await emailEventChange(eventId, vendorId, `A timeline task was added: ${title} (${startTime.replace('T', ' ')}).`);
  response.redirect(`/events/${eventId}/logistics`);
});

app.post('/events/:id/tasks/:taskId/time', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const taskId = Number(request.params.taskId);
  if (!eventForOwner(eventId, request.session.user.id)) return response.sendStatus(404);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND event_id = ?').get(taskId, eventId);
  const startTime = String(request.body.start_time || '').trim();
  if (!task || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startTime)) {
    setNotice(request, 'Could not update that task time.');
    return response.redirect(`/events/${eventId}`);
  }
  db.prepare('UPDATE tasks SET start_time = ? WHERE id = ?').run(startTime, taskId);
  const message = `${task.title} time moved from ${task.start_time.replace('T', ' ')} to ${startTime.replace('T', ' ')}.`;
  recordChange(eventId, message);
  emitEventUpdate(eventId, message);
  await emailEventChange(eventId, task.vendor_id, message);
  response.redirect(`/events/${eventId}`);
});

app.post('/events/:id/invoices/:invoiceId/status', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const invoiceId = Number(request.params.invoiceId);
  if (!eventForOwner(eventId, request.session.user.id)) return response.sendStatus(404);
  const status = String(request.body.status || '');
  if (!['approved', 'paid'].includes(status)) return response.sendStatus(400);
  const invoice = db.prepare(`
    SELECT invoices.id, vendors.token, vendors.name
    FROM invoices JOIN vendors ON vendors.id = invoices.vendor_id
    WHERE invoices.id = ? AND vendors.event_id = ?
  `).get(invoiceId, eventId);
  if (!invoice) return response.sendStatus(404);
  db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
  const message = `Invoice from ${invoice.name} marked ${status}.`;
  recordChange(eventId, message);
  io.to(`event:${eventId}`).emit('update', { message });
  io.to(`vendor:${invoice.token}`).emit('update', { message: `Your invoice was marked ${status}.` });
  const vendor = db.prepare('SELECT * FROM vendors WHERE token = ?').get(invoice.token);
  const event = eventForOwner(eventId, request.session.user.id);
  await emailVendor(vendor, event, `Invoice ${status}: ${event.title}`, `Your invoice for "${event.title}" was marked ${status}.`);
  response.redirect(`/events/${eventId}`);
});

app.post('/events/:id/vendors/:vendorId/email', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  const vendorId = Number(request.params.vendorId);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.session.user.id);
  if (!event) return response.sendStatus(404);
  const vendor = Number.isSafeInteger(vendorId)
    && db.prepare('SELECT * FROM vendors WHERE id = ? AND event_id = ?').get(vendorId, eventId);
  if (!vendor) return response.sendStatus(404);
  if (!vendor.email) {
    setNotice(request, `${vendor.name} has no email address. Add one before sending the private link.`);
  } else {
    const reminder = vendor.status === 'pending' && Boolean(vendor.last_notified_at);
    const sent = await sendVendorInvite(vendor, event, reminder);
    setNotice(request, sent
      ? `${reminder ? 'Reminder' : 'Private link'} sent to ${vendor.name}${demoEmailNote}.`
      : `Could not email ${vendor.name}. Check SMTP settings and try again.`);
  }
  response.redirect(`/events/${eventId}`);
});

app.get('/client/:token', (request, response) => {
  const token = String(request.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return response.sendStatus(404);
  const event = db.prepare(`
    SELECT id, title, event_date, event_type, venue, venue_notes
    FROM events WHERE client_token = ?
  `).get(token);
  if (!event) return response.status(404).render('message', {
    title: 'Host link unavailable',
    message: 'This read-only event link is no longer active. Please contact your planner for an updated link.',
    href: '/auth',
    linkText: 'Planner sign in',
    vendorView: false,
  });
  const vendors = db.prepare(`
    SELECT name, category, status FROM vendors
    WHERE event_id = ? ORDER BY name
  `).all(event.id);
  const tasks = db.prepare(`
    SELECT tasks.title, tasks.start_time, tasks.notes, vendors.name AS vendor_name
    FROM tasks LEFT JOIN vendors ON vendors.id = tasks.vendor_id
    WHERE tasks.event_id = ? ORDER BY tasks.start_time, tasks.id
  `).all(event.id);
  response.render('client', {
    event,
    vendors,
    tasks,
    mapsUrl: event.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue)}` : null,
  });
});

app.get('/vendor/:token', (request, response) => {
  const vendor = vendorByToken(request.params.token, request.session.vendorUser?.id);
  if (!vendor) return response.status(404).render('message', {
    title: 'Link not found',
    message: 'This private vendor link is invalid or no longer active. Please contact your event planner for an updated link.',
    vendorView: true,
  });
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE event_id = ? AND (vendor_id = ? OR vendor_id IS NULL)
    ORDER BY start_time, id
  `).all(vendor.event_id, vendor.id);
  const invoices = db.prepare('SELECT * FROM invoices WHERE vendor_id = ? ORDER BY created_at DESC, id DESC').all(vendor.id);
  response.render('vendor', {
    vendor,
    tasks,
    invoices,
    mapsUrl: vendor.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(vendor.venue)}` : null,
  });
});

app.post('/vendor/:token/status', (request, response) => {
  const vendor = vendorByToken(request.params.token, request.session.vendorUser?.id);
  if (!vendor) return response.sendStatus(404);
  const status = String(request.body.status || '');
  const note = String(request.body.note || '').trim();
  if (!['confirmed', 'declined', 'changes_requested'].includes(status) || note.length > 500) {
    return response.status(400).render('message', {
      title: 'Response not saved',
      message: 'Choose a valid response and keep any note under 500 characters.',
      href: `/vendor/${vendor.token}`,
      linkText: 'Return to vendor page',
      vendorView: true,
    });
  }
  db.prepare('UPDATE vendors SET status = ?, note = ? WHERE id = ?').run(status, note, vendor.id);
  const readable = status.replace('_', ' ');
  const message = `${vendor.name} ${readable}${note ? `: ${note}` : '.'}`;
  recordChange(vendor.event_id, message);
  emitEventUpdate(vendor.event_id, `${vendor.name} responded: ${readable}.`);
  setNotice(request, 'Your response was sent to the planner.');
  response.redirect(`/vendor/${vendor.token}`);
});

app.post('/vendor/:token/invoices', invoiceUpload.single('invoice'), (request, response) => {
  const vendor = vendorByToken(request.params.token, request.session.vendorUser?.id);
  if (!vendor) {
    if (request.file) fs.unlinkSync(request.file.path);
    return response.sendStatus(404);
  }
  const amount = Number(request.body.amount);
  if (!request.file || !Number.isFinite(amount) || amount < 0 || amount > 100000000) {
    if (request.file) fs.unlinkSync(request.file.path);
    setNotice(request, 'Select an invoice file and enter a valid amount.');
    return response.redirect(`/vendor/${vendor.token}`);
  }
  const originalName = path.basename(request.file.originalname).slice(0, 180);
  db.prepare('INSERT INTO invoices (vendor_id, amount, filename, original_name) VALUES (?, ?, ?, ?)')
    .run(vendor.id, amount, request.file.filename, originalName);
  recordChange(vendor.event_id, `${vendor.name} sent an invoice for ${amount.toFixed(2)}.`);
  emitEventUpdate(vendor.event_id, `${vendor.name} sent an invoice.`);
  setNotice(request, 'Invoice sent to the planner.');
  response.redirect(`/vendor/${vendor.token}`);
});

app.get('/invoices/:id/download', requireAuth, (request, response) => {
  const invoice = db.prepare(`
    SELECT invoices.filename, invoices.original_name, events.user_id
    FROM invoices JOIN vendors ON vendors.id = invoices.vendor_id
    JOIN events ON events.id = vendors.event_id
    WHERE invoices.id = ?
  `).get(Number(request.params.id));
  if (!invoice || invoice.user_id !== request.session.user.id) return response.sendStatus(404);
  return response.download(path.join(uploadDirectory, invoice.filename), invoice.original_name);
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Invoice files must be 8 MB or smaller.'
      : 'Only one invoice file can be uploaded at a time.';
    return response.status(400).render('message', { title: 'Upload could not be completed', message, href: 'back', linkText: 'Return' });
  }
  if (error.message === 'Upload a PDF, JPG, or PNG invoice.') {
    return response.status(400).render('message', { title: 'Unsupported file', message: error.message, href: 'back', linkText: 'Return' });
  }
  console.error(error);
  return response.status(500).render('message', {
    title: 'Something went wrong',
    message: 'The request could not be completed. Please try again.',
    href: '/',
    linkText: 'Home',
  });
});

let reminderCheckRunning = false;
async function sendAutomaticReminders() {
  if (reminderCheckRunning) return;
  reminderCheckRunning = true;
  try {
    const dueVendors = db.prepare(`
      SELECT vendors.*, events.title AS event_title, events.event_date, events.venue
      FROM vendors JOIN events ON events.id = vendors.event_id
      WHERE vendors.status = 'pending'
        AND vendors.email <> ''
        AND vendors.reminder_count < ?
        AND events.event_date >= date('now')
        AND vendors.last_notified_at IS NOT NULL
        AND vendors.last_notified_at <= datetime('now', ?)
    `).all(maxReminders, `-${reminderHours} hours`);

    for (const vendor of dueVendors) {
      const event = {
        id: vendor.event_id,
        title: vendor.event_title,
        event_date: vendor.event_date,
        venue: vendor.venue,
      };
      const sent = await sendVendorInvite(vendor, event, true, true);
      if (sent) {
        db.prepare('UPDATE vendors SET reminder_count = reminder_count + 1 WHERE id = ?').run(vendor.id);
      }
    }
    const dueContracts = db.prepare(`
      SELECT vendor_contracts.id, vendor_contracts.due_date, vendor_contracts.reference,
        vendors.name AS vendor_name, vendors.email AS vendor_email,
        events.id AS event_id, events.title AS event_title, events.event_date,
        users.email AS planner_email
      FROM vendor_contracts
      JOIN vendors ON vendors.id = vendor_contracts.vendor_id
      JOIN events ON events.id = vendor_contracts.event_id
      JOIN users ON users.id = events.user_id
      WHERE vendor_contracts.due_date <> ''
        AND vendor_contracts.due_date <= date('now', '+3 days')
        AND vendor_contracts.status NOT IN ('complete', 'cancelled')
        AND (vendor_contracts.reminder_sent_at IS NULL
          OR vendor_contracts.reminder_sent_at <= datetime('now', '-24 hours'))
    `).all();
    for (const contract of dueContracts) {
      const recipients = [...new Set([contract.planner_email, contract.vendor_email].filter(Boolean))];
      let allSent = recipients.length > 0;
      for (const recipient of recipients) {
        const sent = await sendMail({
          to: recipient,
          subject: `Contract deadline: ${contract.event_title}`,
          text: [
            `A vendor contract deadline is due ${contract.due_date <= new Date().toISOString().slice(0, 10) ? 'now or overdue' : 'within 3 days'}.`,
            '',
            `Event: ${contract.event_title} on ${contract.event_date}`,
            `Vendor: ${contract.vendor_name}`,
            `Deadline: ${contract.due_date}`,
            contract.reference ? `Reference: ${contract.reference}` : '',
          ].filter(Boolean).join('\n'),
        });
        allSent = allSent && sent;
      }
      if (allSent) {
        db.prepare("UPDATE vendor_contracts SET reminder_sent_at = datetime('now') WHERE id = ?").run(contract.id);
        recordChange(contract.event_id, `Contract deadline reminder sent for ${contract.vendor_name}.`);
      }
    }
  } finally {
    reminderCheckRunning = false;
  }
}

setTimeout(() => {
  sendAutomaticReminders().catch((error) => {
    console.error('Automatic event reminders failed:', error);
  });
}, 30_000).unref();

setInterval(() => {
  sendAutomaticReminders().catch((error) => {
    console.error('Automatic event reminders failed:', error);
  });
}, reminderCheckMinutes * 60 * 1000).unref();

server.listen(port, () => {
  console.log(`Vendor Coordinator running at http://localhost:${port}`);
});
