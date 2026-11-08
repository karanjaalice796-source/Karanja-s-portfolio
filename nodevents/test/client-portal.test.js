const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const QRCode = require('qrcode');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const test = require('node:test');

async function availablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

function createCookieJar() {
  return { cookie: '' };
}

async function request(baseUrl, cookieJar, route, { method = 'GET', form, files } = {}) {
  const headers = {};
  const options = { method, headers, redirect: 'manual' };
  if (cookieJar.cookie) headers.Cookie = cookieJar.cookie;
  if (files) {
    const body = new FormData();
    Object.entries(form || {}).forEach(([name, value]) => {
      (Array.isArray(value) ? value : [value]).forEach((item) => body.append(name, String(item)));
    });
    files.forEach((file) => body.append(file.field, new Blob([file.data], { type: file.type }), file.name));
    options.body = body;
  } else if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams(form).toString();
  }
  const response = await fetch(new URL(route, baseUrl), options);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookieJar.cookie = cookies[0].split(';', 1)[0];
  return response;
}

test('client accounts stay role-scoped while private links support PINs, expiry, approvals, and comments', { timeout: 120_000 }, async (context) => {
  const project = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodevents-client-link-'));
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  for (const file of ['server.js', 'db.js', 'templates.js', 'mailer.js', 'mpesa.js']) {
    fs.copyFileSync(path.join(project, file), path.join(directory, file));
  }
  for (const folder of ['public', 'views']) {
    fs.cpSync(path.join(project, folder), path.join(directory, folder), { recursive: true });
  }

  const server = spawn(process.execPath, ['server.js'], {
    cwd: directory,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      APP_BASE_URL: baseUrl,
      SESSION_SECRET: 'client-link-integration-test-session-secret',
      GOOGLE_MAPS_ROUTES_API_KEY: '',
      NODE_PATH: path.join(project, 'node_modules'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  let serverErrors = '';
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk) => { serverOutput += chunk; });
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => { serverErrors += chunk; });
  let db;
  context.after(async () => {
    db?.close();
    server.kill();
    await new Promise((resolve) => {
      if (server.exitCode !== null || server.signalCode !== null) return resolve();
      server.once('close', resolve);
      setTimeout(resolve, 3000).unref();
    });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  let ready = false;
  const startupDeadline = Date.now() + 30_000;
  while (Date.now() < startupDeadline) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(ready, true, `Nodevents did not start within 30 seconds. ${serverOutput}\n${serverErrors}`);

  const guestLanding = await request(baseUrl, createCookieJar(), '/');
  const homeHtml = await guestLanding.text();
  assert.equal(guestLanding.status, 200);
  assert.match(homeHtml, /Make every event easier to bring together/);
  assert.match(homeHtml, /href="\/browse-events"/);
  assert.match(homeHtml, /href="\/vendors"/);
  assert.match(homeHtml, /href="\/auth">Planner sign in/);
  assert.match(homeHtml, /href="\/client\/auth\?mode=login">Client sign in/);
  assert.match(homeHtml, /href="\/vendor\/login">Vendor sign in/);
  assert.match(homeHtml, /href="\/learn">How Nodevents works/);
  assert.equal((await request(baseUrl, createCookieJar(), '/home')).status, 200);
  const learningPage = await request(baseUrl, createCookieJar(), '/learn');
  const learningHtml = await learningPage.text();
  assert.equal(learningPage.status, 200);
  assert.match(learningHtml, /href="\/auth\?mode=login"/);
  assert.match(learningHtml, /href="\/client\/auth\?mode=login"/);
  assert.match(learningHtml, /href="\/vendor\/login"/);

  const planner = createCookieJar();
  const plannerAuthPage = await request(baseUrl, createCookieJar(), '/auth');
  const plannerAuthHtml = await plannerAuthPage.text();
  assert.equal(plannerAuthPage.status, 200);
  assert.match(plannerAuthHtml, /Choose an account type/);
  assert.match(plannerAuthHtml, /href="\/client\/auth\?mode=login"/);
  assert.match(plannerAuthHtml, /href="\/vendor\/login"/);
  const clientAuthPage = await request(baseUrl, createCookieJar(), '/client/auth?mode=login');
  const clientAuthHtml = await clientAuthPage.text();
  assert.match(clientAuthHtml, /Welcome back/);
  assert.match(clientAuthHtml, /href="\/client\/auth\?mode=register"/);
  const vendorRegistrationPage = await request(baseUrl, createCookieJar(), '/vendor/login?mode=register');
  const vendorRegistrationHtml = await vendorRegistrationPage.text();
  assert.equal(vendorRegistrationPage.status, 200);
  assert.match(vendorRegistrationHtml, /Create vendor account/);
  assert.match(vendorRegistrationHtml, /Personal invitation link/);
  const registerPlanner = await request(baseUrl, planner, '/auth/register', {
    method: 'POST',
    form: {
      name: 'Planner One',
      email: 'planner@example.test',
      password: 'planner-test-password',
    },
  });
  assert.equal(registerPlanner.status, 302);
  assert.equal(registerPlanner.headers.get('location'), '/dashboard');
  const plannerHome = await request(baseUrl, planner, '/');
  assert.equal(plannerHome.status, 302);
  assert.equal(plannerHome.headers.get('location'), '/dashboard');
  const plannerDashboard = await request(baseUrl, planner, '/dashboard');
  const plannerDashboardHtml = await plannerDashboard.text();
  assert.equal(plannerDashboard.status, 200, serverErrors);
  assert.match(plannerDashboardHtml, /href="\/home">Home<\/a>/);
  assert.match(plannerDashboardHtml, /href="\/dashboard"[^>]*>Overview<\/a>/);
  const plannerHomePage = await request(baseUrl, planner, '/home');
  const plannerHomeHtml = await plannerHomePage.text();
  assert.equal(plannerHomePage.status, 200);
  assert.match(plannerHomeHtml, /Make every event easier to bring together/);
  assert.match(plannerHomeHtml, /href="\/dashboard">Open your dashboard/);
  assert.doesNotMatch(plannerHomeHtml, /Your events, all in one place/);
  for (const section of ['Overview and analytics', 'Client Event Requests', 'My Events', 'Client Management',
    'Vendor Management', 'Bookings', 'Budget and Expenses', 'Payments and Invoices', 'Tasks and Schedules',
    'Reports', 'Messages', 'Settings']) {
    assert.match(plannerDashboardHtml, new RegExp(section));
  }
  assert.doesNotMatch(plannerDashboardHtml, /Approve and create event/);
  assert.equal((await request(baseUrl, planner, '/client-event-requests')).status, 200);
  assert.equal((await request(baseUrl, planner, '/my-events')).status, 200);
  assert.equal((await request(baseUrl, planner, '/analytics')).status, 200);
  assert.equal((await request(baseUrl, planner, '/reports')).status, 200);
  assert.equal((await request(baseUrl, planner, '/planner/notifications')).status, 200);
  const plannerRating = await request(baseUrl, planner, '/platform-rating', {
    method: 'POST',
    form: { rating: '5', return_to: '/dashboard' },
  });
  assert.equal(plannerRating.headers.get('location'), '/dashboard#nodevents-rating');
  const ratedDashboard = await request(baseUrl, planner, '/dashboard');
  assert.match(await ratedDashboard.text(), /5\.0 \/ 5/);

  const createEvent = await request(baseUrl, planner, '/events', {
    method: 'POST',
    form: {
      title: 'Private Link Wedding',
      event_date: '2030-06-01',
      event_type: 'wedding',
      venue: 'Nairobi Convention Centre',
    },
  });
  assert.equal(createEvent.status, 302);
  assert.equal(createEvent.headers.get('location'), '/events/1');
  const myEventsPage = await request(baseUrl, planner, '/my-events');
  const myEventsHtml = await myEventsPage.text();
  assert.equal(myEventsPage.status, 200);
  assert.match(myEventsHtml, /My event summary/);
  assert.match(myEventsHtml, /Upcoming events/);
  assert.match(myEventsHtml, /Private Link Wedding/);
  assert.match(myEventsHtml, /Planning tasks/);
  assert.match(myEventsHtml, /Open event/);
  assert.equal((await request(baseUrl, planner, '/events/1/registration')).status, 200);
  assert.equal((await request(baseUrl, planner, '/events/1/tickets')).status, 200);
  const missingRoutesKey = await request(baseUrl, planner, '/events/1/logistics/route-distance', {
    method: 'POST',
    form: { origin: 'Nairobi', destination: 'Kiambu' },
  });
  assert.equal(missingRoutesKey.status, 503);
  assert.match(await missingRoutesKey.text(), /GOOGLE_MAPS_ROUTES_API_KEY/);

  db = new DatabaseSync(path.join(directory, 'data.db'));
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare('INSERT INTO ticket_types (event_id, name, price, capacity) VALUES (1, ?, 0, 10)')
    .run('Regular');
  db.prepare('UPDATE events SET registration_is_open = 1, ticket_color = ? WHERE id = 1').run('#a8431f');

  const vendorPassword = 'gallery-vendor-test-password';
  const vendorPasswordHash = await bcrypt.hash(vendorPassword, 10);
  db.prepare('INSERT INTO vendor_accounts (name, email, password_hash) VALUES (?, ?, ?)')
    .run('Gallery Vendor', 'gallery@example.test', vendorPasswordHash);
  const vendorAccount = createCookieJar();
  const vendorLogin = await request(baseUrl, vendorAccount, '/vendor/login', {
    method: 'POST',
    form: { email: 'gallery@example.test', password: vendorPassword },
  });
  assert.equal(vendorLogin.status, 302);
  assert.equal(vendorLogin.headers.get('location'), '/vendor/dashboard');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64');
  const saveVendorProfile = await request(baseUrl, vendorAccount, '/vendor/profile', {
    method: 'POST',
    form: {
      business_name: 'Gallery Vendor',
      service_categories: ['Catering'],
      services: 'Buffet service and setup',
      description: 'Fresh event catering',
      location: 'Nairobi',
      is_published: 'on',
    },
    files: [{ field: 'gallery', name: 'catering.png', type: 'image/png', data: png }],
  });
  assert.equal(saveVendorProfile.status, 302);
  const galleryFilename = JSON.parse(db.prepare('SELECT gallery_json FROM vendor_profiles WHERE vendor_account_id = 1').get().gallery_json)[0];
  const vendorProfileEditor = await request(baseUrl, vendorAccount, '/vendor/profile');
  assert.equal(vendorProfileEditor.status, 200);
  assert.match(await vendorProfileEditor.text(), /Service gallery/);
  const vendorDirectory = await request(baseUrl, createCookieJar(), '/vendors');
  assert.match(await vendorDirectory.text(), /Gallery Vendor/);
  const vendorPublicProfile = await request(baseUrl, createCookieJar(), '/vendors/1');
  assert.match(await vendorPublicProfile.text(), /Service gallery/);
  const vendorImage = await request(baseUrl, createCookieJar(), `/vendor-gallery/${galleryFilename}`);
  assert.equal(vendorImage.status, 200);
  assert.equal(vendorImage.headers.get('content-type'), 'image/png');
  const invalidGalleryUpload = await request(baseUrl, vendorAccount, '/vendor/profile', {
    method: 'POST',
    form: {
      business_name: 'Gallery Vendor',
      service_categories: ['Catering'],
      is_published: 'on',
    },
    files: [{ field: 'gallery', name: 'not-an-image.png', type: 'image/png', data: Buffer.from('not an image') }],
  });
  assert.equal(invalidGalleryUpload.status, 400);
  assert.equal(JSON.parse(db.prepare('SELECT gallery_json FROM vendor_profiles WHERE vendor_account_id = 1').get().gallery_json).length, 1);
  const selfRegisteredVendor = createCookieJar();
  const vendorSignup = await request(baseUrl, selfRegisteredVendor, '/vendor/register', {
    method: 'POST',
    form: {
      name: 'Independent Vendor',
      email: 'independent-vendor@example.test',
      password: 'vendor-test-password',
    },
  });
  assert.equal(vendorSignup.status, 302);
  assert.equal(vendorSignup.headers.get('location'), '/vendor/dashboard');
  const vendorHome = await request(baseUrl, selfRegisteredVendor, '/');
  assert.equal(vendorHome.status, 302);
  assert.equal(vendorHome.headers.get('location'), '/vendor/dashboard');
  const vendorDashboardPage = await request(baseUrl, selfRegisteredVendor, '/vendor/dashboard');
  assert.equal(vendorDashboardPage.status, 200);
  assert.match(await vendorDashboardPage.text(), /Set up your vendor profile/);
  const inviteToken = 'c'.repeat(64);
  const invitedVendor = Number(db.prepare(`
    INSERT INTO vendors (event_id, name, category, services, email, token)
    VALUES (1, 'Invited Vendor', 'Photography', 'Event photography', 'invited-vendor@example.test', ?)
  `).run(inviteToken).lastInsertRowid);
  const invitationPage = await request(baseUrl, createCookieJar(), `/vendor/${inviteToken}/register`);
  assert.equal(invitationPage.status, 200);
  assert.match(await invitationPage.text(), /This account will connect to the vendor invitation/);
  const invitationAccount = createCookieJar();
  const connectInvitation = await request(baseUrl, invitationAccount, `/vendor/${inviteToken}/register`, {
    method: 'POST',
    form: {
      email: 'invited-vendor@example.test',
      password: 'invited-vendor-password',
    },
  });
  assert.equal(connectInvitation.status, 302);
  assert.equal(connectInvitation.headers.get('location'), '/vendor/dashboard');
  assert.ok(db.prepare('SELECT account_id FROM vendors WHERE id = ?').get(invitedVendor).account_id);
  db.prepare('UPDATE events SET budget_total = 5000, expected_guests = 5, budget_currency = ? WHERE id = 1')
    .run('KES');
  const vendorId = Number(db.prepare(`
    INSERT INTO vendors (event_id, name, category, services, email, token, status, note, estimated_cost, cost_per_guest)
    VALUES (1, 'Private Caterer', 'Catering', 'Private service notes must not be shared', 'private@example.test',
      ?, 'confirmed', 'Confidential vendor note', 1000, 20)
  `).run('a'.repeat(64)).lastInsertRowid);
  db.prepare(`
    INSERT INTO guests (event_id, name, email, group_size, rsvp_status)
    VALUES (1, 'Guest One', 'guest@example.test', 2, 'attending'),
      (1, 'Guest Two', '', 1, 'awaiting'),
      (1, 'Guest Three', '', 1, 'declined')
  `).run();
  db.prepare(`
    INSERT INTO tasks (event_id, vendor_id, title, start_time, notes)
    VALUES (1, ?, 'Ceremony begins', '2030-06-01T10:00', 'Private task notes must not be shared')
  `).run(vendorId);
  db.prepare(`
    INSERT INTO invoices (vendor_id, amount, filename, original_name, status)
    VALUES (?, 450, 'private.pdf', 'private-invoice.pdf', 'paid'),
      (?, 1600, 'pending.pdf', 'pending-invoice.pdf', 'sent')
  `).run(vendorId, vendorId);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const expiresAtLocal = new Date(expiresAt.getTime() - expiresAt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const createLink = await request(baseUrl, planner, '/events/1/client-link', {
    method: 'POST',
    form: { pin: '4826', expires_at: expiresAtLocal, show_budget: 'on' },
  });
  assert.equal(createLink.status, 302);
  const plannerEvent = await request(baseUrl, planner, '/events/1');
  const plannerEventHtml = await plannerEvent.text();
  const linkMatch = plannerEventHtml.match(/value="(http:\/\/127\.0\.0\.1:\d+\/client\/[a-f0-9]{64})"/);
  assert.ok(linkMatch, 'planner event should show its private client link');
  const clientUrl = new URL(linkMatch[1]);
  const token = clientUrl.pathname.split('/').pop();

  const noAccountPage = await request(baseUrl, createCookieJar(), '/client/access');
  assert.equal(noAccountPage.status, 200);
  assert.match(await noAccountPage.text(), /No account is needed/);
  assert.equal((await request(baseUrl, createCookieJar(), '/auth')).status, 200);
  const clientInput = await request(baseUrl, createCookieJar(), '/client/access', {
    method: 'POST',
    form: { event_link: clientUrl.href },
  });
  assert.equal(clientInput.status, 302);
  assert.equal(clientInput.headers.get('location'), `/client/${token}`);
  assert.equal((await request(baseUrl, createCookieJar(), '/auth?audience=client')).headers.get('location'), '/client/auth?mode=register');
  assert.equal((await request(baseUrl, createCookieJar(), '/client/register')).headers.get('location'), '/client/auth?mode=register');
  assert.equal((await request(baseUrl, createCookieJar(), '/client/dashboard')).headers.get('location'), '/client/auth');
  assert.equal((await request(baseUrl, createCookieJar(), `/client/invite/${'b'.repeat(64)}`)).headers.get('location'), '/client/auth?mode=login');
  assert.equal((await request(baseUrl, createCookieJar(), '/auth/login', {
    method: 'POST',
    form: { audience: 'client', email: 'client@example.test', password: 'irrelevant' },
  })).headers.get('location'), '/client/auth?mode=login');

  const accountClient = createCookieJar();
  const registrationPage = await request(baseUrl, accountClient, '/client/auth?mode=register');
  assert.equal(registrationPage.status, 200);
  assert.match(await registrationPage.text(), /Create your client account/);
  const registerClient = await request(baseUrl, accountClient, '/client/register', {
    method: 'POST',
    form: {
      name: 'Client One',
      email: 'client@example.test',
      phone: '+254700000001',
      password: 'client-test-password',
    },
  });
  assert.equal(registerClient.status, 302);
  assert.equal(registerClient.headers.get('location'), '/client/dashboard');
  const clientHome = await request(baseUrl, accountClient, '/');
  assert.equal(clientHome.status, 302);
  assert.equal(clientHome.headers.get('location'), '/client/dashboard');
  const accountUserId = db.prepare("SELECT id FROM users WHERE email = 'client@example.test'").get().id;
  const brandingImage = await QRCode.toBuffer('Nodevents event logo');
  const saveTicketBranding = await request(baseUrl, planner, '/events/1/tickets/branding', {
    method: 'POST',
    form: { ticket_color: '#a8431f' },
    files: [{ field: 'ticket_logo', name: 'event-logo.png', type: 'image/png', data: brandingImage }],
  });
  assert.equal(saveTicketBranding.status, 302);
  const registrationToken = db.prepare('SELECT registration_token FROM events WHERE id = 1').get().registration_token;
  const ticketRegistration = await request(baseUrl, accountClient, `/register/${registrationToken}`, {
    method: 'POST',
    form: {
      full_name: 'Client One',
      email: 'client@example.test',
      phone: '+254700000001',
      ticket_type_id: '1',
    },
  });
  assert.equal(ticketRegistration.status, 302);
  const ticketPath = ticketRegistration.headers.get('location');
  const ticketToken = ticketPath.split('/').pop();
  assert.equal(db.prepare('SELECT account_user_id FROM registrations WHERE qr_token = ?').get(ticketToken).account_user_id, accountUserId);
  const ticketPage = await request(baseUrl, createCookieJar(), ticketPath);
  assert.equal(ticketPage.status, 200);
  const ticketHtml = await ticketPage.text();
  assert.match(ticketHtml, /Download ticket PDF/);
  assert.match(ticketHtml, /Event overview/);
  assert.match(ticketHtml, /Scan to enter/);
  assert.match(ticketHtml, /NODEVENTS/);
  db.prepare("UPDATE events SET event_type = 'corporate' WHERE id = 1").run();
  const corporateTicket = await request(baseUrl, createCookieJar(), ticketPath);
  assert.match(await corporateTicket.text(), /Corporate access/);
  db.prepare("UPDATE events SET event_type = 'entertainment' WHERE id = 1").run();
  const festivalTicket = await request(baseUrl, createCookieJar(), ticketPath);
  assert.match(await festivalTicket.text(), /Festival pass/);
  db.prepare("UPDATE events SET event_type = 'wedding' WHERE id = 1").run();
  assert.equal((await request(baseUrl, planner, '/events/1/tickets/logo')).status, 200);
  assert.equal((await request(baseUrl, createCookieJar(), `${ticketPath}/logo`)).status, 200);
  const ticketPdf = await request(baseUrl, createCookieJar(), `${ticketPath}/download`);
  assert.equal(ticketPdf.status, 200);
  assert.equal(Buffer.from(await ticketPdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const clientTicketHistory = await request(baseUrl, accountClient, '/client/dashboard');
  assert.match(await clientTicketHistory.text(), /Private Link Wedding/);
  const firstScan = await request(baseUrl, planner, '/events/1/tickets/check-in', {
    method: 'POST',
    form: { qr_token: ticketToken },
  });
  assert.equal(firstScan.status, 200);
  assert.equal((await firstScan.json()).status, 'valid');
  const repeatScan = await request(baseUrl, planner, '/events/1/tickets/check-in', {
    method: 'POST',
    form: { qr_token: ticketToken },
  });
  assert.equal(repeatScan.status, 409);
  assert.equal((await repeatScan.json()).status, 'already_used');
  db.prepare("UPDATE registrations SET status = 'cancelled' WHERE qr_token = ?").run(ticketToken);
  const cancelledScan = await request(baseUrl, planner, '/events/1/tickets/check-in', {
    method: 'POST',
    form: { qr_token: ticketToken },
  });
  assert.equal((await cancelledScan.json()).status, 'cancelled');
  const clientDashboard = await request(baseUrl, accountClient, '/client/dashboard');
  assert.equal(clientDashboard.status, 200, serverErrors);
  const clientDashboardHtml = await clientDashboard.text();
  assert.match(clientDashboardHtml, /Client dashboard navigation/);
  assert.match(clientDashboardHtml, /Request an Event/);
  const clientRating = await request(baseUrl, accountClient, '/platform-rating', {
    method: 'POST',
    form: { rating: '4', return_to: '/client/dashboard' },
  });
  assert.equal(clientRating.headers.get('location'), '/client/dashboard#nodevents-rating');
  assert.match(await (await request(baseUrl, accountClient, '/client/dashboard')).text(), /4\.5 \/ 5/);
  assert.doesNotMatch(clientDashboardHtml, /href="\/dashboard"/);
  assert.equal((await request(baseUrl, accountClient, '/dashboard')).headers.get('location'), '/client/dashboard');
  assert.equal((await request(baseUrl, accountClient, '/clients')).headers.get('location'), '/client/dashboard');
  assert.equal((await request(baseUrl, planner, '/client/dashboard')).status, 403);

  const submitRequest = await request(baseUrl, accountClient, '/client/requests', {
    method: 'POST',
    form: {
      planner_id: '1',
      title: 'Client Account Wedding Request',
      event_type: 'wedding',
      desired_date: '2031-06-01',
      desired_time: '14:30',
      venue: 'Nairobi',
      expected_guests: '80',
      estimated_budget: '250000',
      services_required: 'Catering',
      service_requirements: 'Vegetarian menu options',
      specific_requirements: 'Outdoor ceremony and reception plan',
    },
  });
  assert.equal(submitRequest.status, 302);
  const savedRequest = db.prepare(`
    SELECT event_requests.*, clients.account_user_id
    FROM event_requests JOIN clients ON clients.id = event_requests.client_id
    WHERE event_requests.title = 'Client Account Wedding Request'
  `).get();
  assert.equal(savedRequest.account_user_id, 2);
  assert.deepEqual(JSON.parse(savedRequest.service_answers), {
    requirements: 'Vegetarian menu options',
    categoryRequirements: 'Outdoor ceremony and reception plan',
  });
  const requestNotification = db.prepare(`
    SELECT id, target_url, read_at FROM planner_notifications
    WHERE planner_user_id = 1 AND notification_type = 'event_request_received'
  `).get();
  assert.ok(requestNotification);
  assert.equal(requestNotification.target_url, `/client-event-requests#request-${savedRequest.id}`);
  assert.equal((await request(baseUrl, planner, '/planner/notifications')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM planner_notifications WHERE planner_user_id = 1 AND read_at IS NULL').get().count, 1);
  const openRequestNotification = await request(baseUrl, planner, `/planner/notifications/${requestNotification.id}/open`, { method: 'POST' });
  assert.equal(openRequestNotification.status, 302);
  assert.equal(openRequestNotification.headers.get('location'), `/client-event-requests#request-${savedRequest.id}`);
  assert.ok(db.prepare('SELECT read_at FROM planner_notifications WHERE id = ?').get(requestNotification.id).read_at);
  assert.equal((await request(baseUrl, accountClient, '/planner/notifications')).headers.get('location'), '/client/dashboard');

  const sendQuote = await request(baseUrl, planner, `/client-requests/${savedRequest.id}/quote`, {
    method: 'POST',
    form: { quote_amount: '275000', quote_details: 'Includes venue, catering and coordination.' },
  });
  assert.equal(sendQuote.status, 302);
  assert.equal(sendQuote.headers.get('location'), '/dashboard#client-event-requests');
  const quotedClientDashboard = await request(baseUrl, accountClient, '/client/dashboard');
  assert.match(await quotedClientDashboard.text(), /KES 275,000\.00/);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM client_notifications
    WHERE client_user_id = ? AND notification_type = 'quotation_received'
  `).get(2).count, 1);

  const approveRequest = await request(baseUrl, planner, `/client-requests/${savedRequest.id}/decision`, {
    method: 'POST',
    form: { decision: 'approve', event_date: '2031-06-01' },
  });
  assert.equal(approveRequest.status, 302);
  const approvedRequest = db.prepare('SELECT status, event_id FROM event_requests WHERE id = ?').get(savedRequest.id);
  assert.equal(approvedRequest.status, 'approved');
  assert.ok(approvedRequest.event_id);
  const createApprovedLink = await request(baseUrl, planner, `/events/${approvedRequest.event_id}/client-link`, {
    method: 'POST',
    form: { show_budget: 'on' },
  });
  assert.equal(createApprovedLink.status, 302);
  const sendProgressLink = await request(baseUrl, planner, `/events/${approvedRequest.event_id}/client-link/send`, {
    method: 'POST',
  });
  assert.equal(sendProgressLink.status, 302);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM client_portal_messages
    WHERE client_id = ? AND progress_url <> ''
  `).get(savedRequest.client_id).count, 1);
  const approvedClientDashboard = await request(baseUrl, accountClient, '/client/dashboard');
  const approvedClientHtml = await approvedClientDashboard.text();
  assert.match(approvedClientHtml, /Client Account Wedding Request/);
  assert.match(approvedClientHtml, /Open event progress/);
  assert.match(approvedClientHtml, new RegExp(`href="http://127\\.0\\.0\\.1:${port}/client/[a-f0-9]{64}"`));

  const client = createCookieJar();
  const lockedLink = await request(baseUrl, client, `/client/${token}`);
  assert.equal(lockedLink.status, 401);
  assert.match(await lockedLink.text(), /Enter your event PIN/);
  const wrongPin = await request(baseUrl, client, `/client/${token}/access`, {
    method: 'POST',
    form: { pin: '0000' },
  });
  assert.equal(wrongPin.status, 401);
  const unlock = await request(baseUrl, client, `/client/${token}/access`, {
    method: 'POST',
    form: { pin: '4826' },
  });
  assert.equal(unlock.status, 302);
  assert.equal(unlock.headers.get('location'), `/client/${token}`);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const invalidAttempt = await request(baseUrl, client, `/client/${token}/access`, {
      method: 'POST',
      form: { pin: '0000' },
    });
    assert.equal(invalidAttempt.status, 401);
  }
  const throttledPin = await request(baseUrl, client, `/client/${token}/access`, {
    method: 'POST',
    form: { pin: '4826' },
  });
  assert.equal(throttledPin.status, 429);

  const dashboard = await request(baseUrl, client, `/client/${token}`);
  const html = await dashboard.text();
  assert.equal(dashboard.status, 200, serverErrors);
  assert.match(html, /Budget summary/);
  assert.match(html, /KES 5,000\.00/);
  assert.match(html, /KES 1,060\.00/);
  assert.match(html, /KES 450\.00/);
  assert.match(html, /KES 2,950\.00/);
  assert.match(html, /Headcount and RSVP progress/);
  assert.match(html, /Ceremony begins/);
  assert.match(html, /Private Caterer/);
  assert.doesNotMatch(html, /Private service notes must not be shared/);
  assert.doesNotMatch(html, /Confidential vendor note/);
  assert.doesNotMatch(html, /private-invoice\.pdf/);
  assert.doesNotMatch(html, /Private task notes must not be shared/);
  assert.match(html, /This link expires/);

  const timelineApproval = await request(baseUrl, client, `/client/${token}/approvals`, {
    method: 'POST',
    form: { approved_by: 'Client Reviewer', approval_type: 'timeline', decision: 'approved' },
  });
  assert.equal(timelineApproval.status, 302);
  const vendorApproval = await request(baseUrl, client, `/client/${token}/approvals`, {
    method: 'POST',
    form: { approved_by: 'Client Reviewer', approval_type: 'vendor', vendor_id: String(vendorId), decision: 'approved' },
  });
  assert.equal(vendorApproval.status, 302);
  db.prepare("UPDATE tasks SET title = 'Updated ceremony time' WHERE event_id = 1").run();
  const updatedTimeline = await request(baseUrl, client, `/client/${token}`);
  const updatedTimelineHtml = await updatedTimeline.text();
  assert.match(updatedTimelineHtml, /Plan changed since approval/);
  assert.match(updatedTimelineHtml, /Updated ceremony time/);
  const changesRequest = await request(baseUrl, client, `/client/${token}/approvals`, {
    method: 'POST',
    form: {
      approved_by: 'Client Reviewer',
      approval_type: 'timeline',
      decision: 'changes',
      note: 'Please move the ceremony to noon.',
    },
  });
  assert.equal(changesRequest.status, 302);
  const invalidChangesRequest = await request(baseUrl, client, `/client/${token}/approvals`, {
    method: 'POST',
    form: {
      approved_by: 'Client Reviewer',
      approval_type: 'timeline',
      decision: 'changes',
      note: ' ',
    },
  });
  assert.equal(invalidChangesRequest.status, 400);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM client_link_approvals
    WHERE event_id = 1 AND approval_type = 'timeline'
  `).get().count, 2);

  db.prepare('UPDATE events SET client_show_budget = 0 WHERE id = 1').run();
  const privateBudgetPage = await request(baseUrl, client, `/client/${token}`);
  assert.doesNotMatch(await privateBudgetPage.text(), /Budget summary/);
  db.prepare('UPDATE events SET client_show_budget = 1 WHERE id = 1').run();

  const clientComment = await request(baseUrl, client, `/client/${token}/comments`, {
    method: 'POST',
    form: { sender_name: 'Client Reviewer', message: 'Could you confirm the arrival time?' },
  });
  assert.equal(clientComment.status, 302);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM planner_notifications
    WHERE planner_user_id = 1 AND notification_type = 'client_approval'
  `).get().count, 2);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM planner_notifications
    WHERE planner_user_id = 1 AND notification_type = 'client_changes_requested'
  `).get().count, 1);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM planner_notifications
    WHERE planner_user_id = 1 AND notification_type = 'client_comment'
  `).get().count, 1);
  const markPlannerNotificationsRead = await request(baseUrl, planner, '/planner/notifications/read', { method: 'POST' });
  assert.equal(markPlannerNotificationsRead.status, 302);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM planner_notifications WHERE planner_user_id = 1 AND read_at IS NULL').get().count, 0);
  const updatedPlannerEvent = await request(baseUrl, planner, '/events/1');
  const updatedPlannerHtml = await updatedPlannerEvent.text();
  assert.match(updatedPlannerHtml, /Client approvals/);
  assert.match(updatedPlannerHtml, /Client Reviewer/);
  assert.match(updatedPlannerHtml, /Please move the ceremony to noon/);
  assert.match(updatedPlannerHtml, /Could you confirm the arrival time/);

  const plannerReply = await request(baseUrl, planner, '/events/1/client-comments', {
    method: 'POST',
    form: { message: 'The venue opens at 9:30 AM.' },
  });
  assert.equal(plannerReply.status, 302);
  const updatedClientLink = await request(baseUrl, client, `/client/${token}`);
  assert.match(await updatedClientLink.text(), /The venue opens at 9:30 AM/);

  const expiredLink = await request(baseUrl, planner, '/events/1/client-link', {
    method: 'POST',
    form: { expires_at: '2020-01-01T00:00' },
  });
  assert.equal(expiredLink.status, 302);
  const stillActive = await request(baseUrl, client, `/client/${token}`);
  assert.equal(stillActive.status, 200);

  db.prepare("UPDATE events SET client_token_expires_at = datetime('now', '-1 minute') WHERE id = 1").run();
  const expiredPortalResponse = await request(baseUrl, client, `/client/${token}`);
  assert.equal(expiredPortalResponse.status, 404);
  assert.match(await expiredPortalResponse.text(), /invalid, revoked, or expired/);

  await request(baseUrl, planner, '/events/1/client-link/revoke', { method: 'POST' });
  assert.equal((await request(baseUrl, client, `/client/${token}`)).status, 404);
});
