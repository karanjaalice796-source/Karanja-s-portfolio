const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
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

async function request(baseUrl, cookieJar, route, { method = 'GET', form } = {}) {
  const headers = {};
  const options = { method, headers, redirect: 'manual' };
  if (cookieJar.cookie) headers.Cookie = cookieJar.cookie;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams(form).toString();
  }
  const response = await fetch(new URL(route, baseUrl), options);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) cookieJar.cookie = cookies[0].split(';', 1)[0];
  return response;
}

test('client accounts and private event links keep their separate workflows and access boundaries', { timeout: 120_000 }, async (context) => {
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
  const startupDeadline = Date.now() + 60_000;
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
  assert.equal(ready, true, `Nodevents did not start within 60 seconds. ${serverOutput}\n${serverErrors}`);

  const planner = createCookieJar();
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

  db = new DatabaseSync(path.join(directory, 'data.db'));
  db.exec('PRAGMA foreign_keys = ON');
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
  assert.equal((await request(baseUrl, createCookieJar(), `/client/invite/${'b'.repeat(64)}`)).headers.get('location'), '/client/auth?loggedOut=1');
  assert.equal((await request(baseUrl, createCookieJar(), '/auth/login', {
    method: 'POST',
    form: { audience: 'client', email: 'client@example.test', password: 'irrelevant' },
  })).headers.get('location'), '/client/auth');

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
  const clientDashboard = await request(baseUrl, accountClient, '/client/dashboard');
  assert.equal(clientDashboard.status, 200, serverErrors);
  const clientDashboardHtml = await clientDashboard.text();
  assert.match(clientDashboardHtml, /Client dashboard navigation/);
  assert.match(clientDashboardHtml, /Request an Event/);
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
  assert.equal(submitRequest.headers.get('location'), '/client/dashboard#requests');
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
  const updatedPlannerDashboard = await request(baseUrl, planner, '/dashboard');
  assert.equal(updatedPlannerDashboard.status, 200, serverErrors);
  assert.match(await updatedPlannerDashboard.text(), /Client Account Wedding Request/);

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
