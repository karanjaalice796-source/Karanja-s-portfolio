const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('client records retain their history when a linked event is removed', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodevents-client-schema-'));
  fs.copyFileSync(path.join(__dirname, '..', 'db.js'), path.join(directory, 'db.js'));
  const db = require(path.join(directory, 'db.js'));
  context.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const userId = Number(db.prepare(`
    INSERT INTO users (name, email, password_hash) VALUES ('Planner', 'planner@example.test', 'hash')
  `).run().lastInsertRowid);
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(userId).role, 'planner');
  const secondPlannerId = Number(db.prepare(`
    INSERT INTO users (name, email, password_hash) VALUES ('Second Planner', 'planner2@example.test', 'hash')
  `).run().lastInsertRowid);
  const clientUserId = Number(db.prepare(`
    INSERT INTO users (name, email, password_hash, role) VALUES ('Client', 'client@example.test', 'hash', 'client')
  `).run().lastInsertRowid);
  assert.throws(() => db.prepare(`
    INSERT INTO users (name, email, password_hash, role) VALUES ('Invalid', 'invalid@example.test', 'hash', 'attendee')
  `).run(), /CHECK constraint failed/);
  const clientId = Number(db.prepare(`
    INSERT INTO clients (user_id, name, email, account_user_id) VALUES (?, 'Client', 'client@example.test', ?)
  `).run(userId, clientUserId).lastInsertRowid);
  db.prepare(`
    INSERT INTO clients (user_id, name, email, account_user_id) VALUES (?, 'Second planner client', 'client@example.test', ?)
  `).run(secondPlannerId, clientUserId);
  db.prepare(`
    INSERT INTO clients (user_id, name, email) VALUES (?, 'Unlinked client', 'unlinked@example.test')
  `).run(userId);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM clients WHERE account_user_id = ?').get(clientUserId).count,
    2,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM clients WHERE account_user_id = ?').get(userId).count,
    0,
  );
  const eventId = Number(db.prepare(`
    INSERT INTO events (user_id, client_id, title, event_date) VALUES (?, ?, 'Wedding', '2027-06-01')
  `).run(userId, clientId).lastInsertRowid);
  db.prepare(`
    INSERT INTO event_requests (user_id, client_id, title, status, event_id)
    VALUES (?, ?, 'Wedding request', 'converted', ?)
  `).run(userId, clientId, eventId);
  db.prepare(`
    INSERT INTO client_messages (user_id, client_id, event_id, subject, message, status)
    VALUES (?, ?, ?, 'Update', 'Planning is underway.', 'sent')
  `).run(userId, clientId, eventId);
  db.prepare(`
    INSERT INTO client_payments (user_id, client_id, event_id, description, amount, payment_method, reference, status)
    VALUES (?, ?, ?, 'Deposit', 100, 'Cash', 'RCPT-1', 'paid')
  `).run(userId, clientId, eventId);
  db.prepare(`
    INSERT INTO client_portal_messages (user_id, client_id, event_id, sender_role, message, delivery_status)
    VALUES (?, ?, ?, 'planner', 'Welcome to the portal.', 'sent')
  `).run(userId, clientId, eventId);

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM clients WHERE user_id = ?').get(userId).count, 2);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM clients
    JOIN events ON events.client_id = clients.id AND events.user_id = clients.user_id
    WHERE clients.account_user_id = ?
  `).get(clientUserId).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM event_requests WHERE client_id = ?').get(clientId).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM client_messages WHERE client_id = ?').get(clientId).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM client_payments WHERE client_id = ?').get(clientId).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM client_portal_messages WHERE client_id = ?').get(clientId).count, 1);

  db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
  assert.equal(db.prepare('SELECT event_id FROM event_requests WHERE client_id = ?').get(clientId).event_id, null);
  assert.equal(db.prepare('SELECT event_id FROM client_messages WHERE client_id = ?').get(clientId).event_id, null);
  assert.equal(db.prepare('SELECT event_id FROM client_payments WHERE client_id = ?').get(clientId).event_id, null);
  assert.equal(db.prepare('SELECT event_id FROM client_portal_messages WHERE client_id = ?').get(clientId).event_id, null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
