const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
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

test('client portal invitations, role guards, requests, messages, and payments stay scoped', { timeout: 120_000 }, async (context) => {
  const project = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodevents-client-portal-'));
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
      SESSION_SECRET: 'client-portal-integration-test-session-secret',
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
  context.after(async () => {
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

  const addClient = await request(baseUrl, planner, '/clients', {
    method: 'POST',
    form: {
      name: 'Portal Client',
      email: 'client@example.test',
      phone: '0712345678',
      notes: 'Private planner notes not shared with the client.',
    },
  });
  assert.equal(addClient.status, 302);
  assert.equal(addClient.headers.get('location'), '/clients/1');

  const invite = await request(baseUrl, planner, '/clients/1/invite', { method: 'POST' });
  assert.equal(invite.status, 302);
  const profile = await request(baseUrl, planner, '/clients/1');
  const profileHtml = await profile.text();
  const token = profileHtml.match(/\/client\/invite\/([a-f0-9]{64})/);
  assert.ok(token, 'demo mode should provide the one-time invitation link to the planner');

  const invitation = await request(baseUrl, createCookieJar(), `/client/invite/${token[1]}`);
  const invitationHtml = await invitation.text();
  assert.equal(invitation.status, 200, serverErrors);
  assert.match(invitationHtml, /Create your Nodevents account/);
  const client = createCookieJar();
  const claim = await request(baseUrl, client, `/client/invite/${token[1]}`, {
    method: 'POST',
    form: { password: 'client-test-password', confirm_password: 'client-test-password' },
  });
  assert.equal(claim.status, 302);
  assert.equal(claim.headers.get('location'), '/client/dashboard');

  const claimedInvite = await request(baseUrl, createCookieJar(), `/client/invite/${token[1]}`);
  assert.equal(claimedInvite.status, 410, 'a successful invitation can only be claimed once');
  const dashboard = await request(baseUrl, client, '/client/dashboard');
  const dashboardHtml = await dashboard.text();
  assert.equal(dashboard.status, 200, serverErrors);
  assert.match(dashboardHtml, /Private client portal/);
  assert.match(dashboardHtml, /Planner One/);
  assert.doesNotMatch(dashboardHtml, /Private planner notes not shared with the client/);
  assert.equal((await request(baseUrl, client, '/dashboard')).status, 403);
  assert.equal((await request(baseUrl, client, '/clients/1')).status, 403);
  const clientLogin = createCookieJar();
  const sharedLogin = await request(baseUrl, clientLogin, '/auth/login', {
    method: 'POST',
    form: {
      audience: 'client',
      email: 'client@example.test',
      password: 'client-test-password',
    },
  });
  assert.equal(sharedLogin.status, 302);
  assert.equal(sharedLogin.headers.get('location'), '/client/dashboard');

  const submitRequest = await request(baseUrl, client, '/client/requests', {
    method: 'POST',
    form: {
      client_id: '1',
      title: 'Portal Wedding',
      event_type: 'wedding',
      desired_date: '2027-06-01',
      venue: 'Nairobi',
      estimated_budget: '120000',
      details: 'Client-submitted request.',
    },
  });
  assert.equal(submitRequest.status, 302);
  assert.equal((await request(baseUrl, client, '/client/messages', {
    method: 'POST',
    form: { client_id: '999', message: 'Should not be accepted.' },
  })).status, 404);
  const plannerProfile = await request(baseUrl, planner, '/clients/1');
  assert.match(await plannerProfile.text(), /Portal Wedding/);

  const createEvent = await request(baseUrl, planner, '/clients/1/requests/1/convert', {
    method: 'POST',
    form: { event_date: '2027-06-01' },
  });
  assert.equal(createEvent.status, 302);
  const recordPayment = await request(baseUrl, planner, '/clients/1/payments', {
    method: 'POST',
    form: {
      event_id: '1',
      description: 'Planning deposit',
      amount: '1000',
      payment_method: 'M-Pesa',
      reference: 'CLIENT-REF-1',
      status: 'pending',
    },
  });
  assert.equal(recordPayment.status, 302);

  const sendMessage = await request(baseUrl, client, '/client/messages', {
    method: 'POST',
    form: { client_id: '1', event_id: '1', message: 'Could you share the latest schedule?' },
  });
  assert.equal(sendMessage.status, 302);
  const reply = await request(baseUrl, planner, '/clients/1/conversation', {
    method: 'POST',
    form: { event_id: '1', message: 'The schedule is being prepared.' },
  });
  assert.equal(reply.status, 302);
  const updatedDashboard = await request(baseUrl, client, '/client/dashboard');
  const updatedHtml = await updatedDashboard.text();
  assert.match(updatedHtml, /Portal Wedding/);
  assert.match(updatedHtml, /Planning deposit/);
  assert.match(updatedHtml, /The schedule is being prepared/);

  const otherPlanner = createCookieJar();
  const otherAccount = await request(baseUrl, otherPlanner, '/auth/register', {
    method: 'POST',
    form: {
      name: 'Planner Two',
      email: 'planner2@example.test',
      password: 'planner-two-test-password',
    },
  });
  assert.equal(otherAccount.status, 302);
  assert.equal((await request(baseUrl, otherPlanner, '/clients/1')).status, 404);
  const secondClient = await request(baseUrl, otherPlanner, '/clients', {
    method: 'POST',
    form: {
      name: 'Portal Client',
      email: 'client@example.test',
      phone: '0712345678',
    },
  });
  assert.equal(secondClient.status, 302);
  assert.equal(secondClient.headers.get('location'), '/clients/2');
  const linkExistingClient = await request(baseUrl, otherPlanner, '/clients/2/invite', { method: 'POST' });
  assert.equal(linkExistingClient.status, 302);
  const sharedPortal = await request(baseUrl, client, '/client/dashboard');
  assert.match(await sharedPortal.text(), /Planner Two/);
});
