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
const db = require('./db');
const { sendMail, configured: mailConfigured } = require('./mailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = Number(process.env.PORT) || 3100;
const reminderHours = Number(process.env.REMINDER_HOURS || 48);
const maxReminders = Number(process.env.MAX_REMINDERS || 3);
const reminderCheckMinutes = Number(process.env.REMINDER_CHECK_MINUTES || 60);
if (![reminderHours, maxReminders, reminderCheckMinutes].every(Number.isFinite)
  || reminderHours <= 0 || !Number.isInteger(maxReminders) || maxReminders < 1
  || reminderCheckMinutes <= 0) {
  throw new Error('Reminder settings must be positive numbers and MAX_REMINDERS must be a positive integer.');
}
const oauthConfigurations = new Map();
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
  response.locals.user = request.session.user || null;
  response.locals.vendorView = request.path.startsWith('/vendor');
  response.locals.notice = request.session.notice || null;
  delete request.session.notice;
  next();
});

function setNotice(request, message) {
  request.session.notice = message;
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
    SELECT users.id, users.name, users.email
    FROM oauth_accounts JOIN users ON users.id = oauth_accounts.user_id
    WHERE oauth_accounts.provider = ? AND oauth_accounts.provider_subject = ?
  `).get(provider, claims.sub);

  if (!user) {
    const name = displayName(provider, claims, request.query);
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    db.exec('BEGIN');
    try {
      const concurrentlyLinkedUser = db.prepare(`
        SELECT users.id, users.name, users.email
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

  request.session.regenerate((error) => {
    if (error) return next(error);
    request.session.user = { id: user.id, name: user.name, email: user.email };
    response.redirect('/dashboard');
  });
}

function requireAuth(request, response, next) {
  if (!request.session.user) return response.redirect('/auth');
  next();
}

function eventForOwner(eventId, userId) {
  return db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(eventId, userId);
}

function vendorByToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`
    SELECT vendors.*, events.title AS event_title, events.event_date, events.venue
    FROM vendors JOIN events ON events.id = vendors.event_id
    WHERE vendors.token = ?
  `).get(token);
}

function recordChange(eventId, message) {
  db.prepare('INSERT INTO changes (event_id, message) VALUES (?, ?)').run(eventId, message);
}

function emitEventUpdate(eventId, message) {
  io.to(`event:${eventId}`).emit('update', { message });
  db.prepare('SELECT token FROM vendors WHERE event_id = ?').all(eventId)
    .forEach(({ token }) => io.to(`vendor:${token}`).emit('update', { message }));
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const demoEmailNote = mailConfigured ? '' : ' (demo mode: printed in the server console)';

function vendorPageUrl(token) {
  const origin = process.env.APP_BASE_URL || `http://localhost:${port}`;
  return new URL(`/vendor/${token}`, origin).href;
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
    if (vendorByToken(token)) socket.join(`vendor:${token}`);
  });
});

app.get('/', (request, response) => response.redirect(request.session.user ? '/dashboard' : '/auth'));

app.get('/learn', (_request, response) => {
  response.render('learning');
});

app.get('/oauth-setup', (_request, response) => {
  response.sendFile(path.join(__dirname, 'OAUTH-SETUP.md'));
});

app.get('/vendor', (_request, response) => {
  response.render('message', {
    title: 'Vendor access',
    message: 'Vendors do not need a planner account or password. Open the private vendor link sent by your event planner, or contact them if you need the link again.',
    vendorView: true,
  });
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

app.get('/dashboard', requireAuth, (request, response) => {
  const events = db.prepare(`
    SELECT events.*,
      COUNT(vendors.id) AS vendor_count,
      COALESCE(SUM(CASE WHEN vendors.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count
    FROM events LEFT JOIN vendors ON vendors.event_id = events.id
    WHERE events.user_id = ?
    GROUP BY events.id
    ORDER BY events.event_date, events.id DESC
  `).all(request.session.user.id);
  response.render('dashboard', { events });
});

app.post('/events', requireAuth, (request, response) => {
  const title = String(request.body.title || '').trim();
  const eventDate = String(request.body.event_date || '').trim();
  const venue = String(request.body.venue || '').trim();
  if (!title || title.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || venue.length > 160) {
    setNotice(request, 'Enter an event name, valid date, and venue under 160 characters.');
    return response.redirect('/dashboard');
  }
  const result = db.prepare('INSERT INTO events (user_id, title, event_date, venue) VALUES (?, ?, ?, ?)')
    .run(request.session.user.id, title, eventDate, venue);
  response.redirect(`/events/${result.lastInsertRowid}`);
});

app.get('/events/:id', requireAuth, (request, response) => {
  const eventId = Number(request.params.id);
  const event = Number.isSafeInteger(eventId) && eventForOwner(eventId, request.session.user.id);
  if (!event) return response.sendStatus(404);
  const vendors = db.prepare(`
    SELECT vendors.*,
      (SELECT COUNT(*) FROM invoices WHERE invoices.vendor_id = vendors.id) AS invoice_count
    FROM vendors WHERE event_id = ? ORDER BY name
  `).all(eventId);
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
  const changes = db.prepare('SELECT * FROM changes WHERE event_id = ? ORDER BY id DESC LIMIT 12').all(eventId);
  response.render('event', {
    event,
    vendors,
    tasks,
    invoices,
    changes,
    mailConfigured,
    reminderHours,
    maxReminders,
  });
});

app.post('/events/:id/vendors', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.session.user.id)) return response.sendStatus(404);
  const name = String(request.body.name || '').trim();
  const category = String(request.body.category || '').trim();
  const email = String(request.body.email || '').trim();
  if (!name || name.length > 100 || category.length > 80 || email.length > 160
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    setNotice(request, 'Enter a vendor name and a valid email address, if provided.');
    return response.redirect(`/events/${eventId}`);
  }
  const result = db.prepare('INSERT INTO vendors (event_id, name, category, email, token) VALUES (?, ?, ?, ?, ?)')
    .run(eventId, name, category, email, crypto.randomBytes(32).toString('hex'));
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

app.post('/events/:id/tasks', requireAuth, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!eventForOwner(eventId, request.session.user.id)) return response.sendStatus(404);
  const title = String(request.body.title || '').trim();
  const startTime = String(request.body.start_time || '').trim();
  const notes = String(request.body.notes || '').trim();
  const vendorId = request.body.vendor_id ? Number(request.body.vendor_id) : null;
  const vendor = vendorId ? db.prepare('SELECT id FROM vendors WHERE id = ? AND event_id = ?').get(vendorId, eventId) : null;
  if (!title || title.length > 160 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startTime)
    || notes.length > 1000 || (vendorId && !vendor)) {
    setNotice(request, 'Check the task title, date/time, notes, and vendor.');
    return response.redirect(`/events/${eventId}`);
  }
  db.prepare('INSERT INTO tasks (event_id, vendor_id, title, start_time, notes) VALUES (?, ?, ?, ?, ?)')
    .run(eventId, vendorId, title, startTime, notes);
  recordChange(eventId, `${title} was added to the timeline.`);
  emitEventUpdate(eventId, `A timeline task was added: ${title}.`);
  await emailEventChange(eventId, vendorId, `A timeline task was added: ${title} (${startTime.replace('T', ' ')}).`);
  response.redirect(`/events/${eventId}`);
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

app.get('/vendor/:token', (request, response) => {
  const vendor = vendorByToken(request.params.token);
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
  response.render('vendor', { vendor, tasks, invoices });
});

app.post('/vendor/:token/status', (request, response) => {
  const vendor = vendorByToken(request.params.token);
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
  const vendor = vendorByToken(request.params.token);
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
  } finally {
    reminderCheckRunning = false;
  }
}

setInterval(() => {
  sendAutomaticReminders().catch((error) => {
    console.error('Automatic vendor reminders failed:', error);
  });
}, reminderCheckMinutes * 60 * 1000).unref();

server.listen(port, () => {
  console.log(`Vendor Coordinator running at http://localhost:${port}`);
});
