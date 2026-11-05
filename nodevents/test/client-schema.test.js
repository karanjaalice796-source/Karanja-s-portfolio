const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
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
  assert.equal(db.prepare('SELECT client_show_budget FROM events WHERE id = ?').get(eventId).client_show_budget, 1);
  const requestColumns = db.prepare('PRAGMA table_info(event_requests)').all().map((column) => column.name);
  assert.ok(requestColumns.includes('quote_amount'));
  assert.ok(requestColumns.includes('quote_details'));
  assert.ok(requestColumns.includes('quote_sent_at'));
  const vendorProfileColumns = db.prepare('PRAGMA table_info(vendor_profiles)').all().map((column) => column.name);
  const portalMessageColumns = db.prepare('PRAGMA table_info(client_portal_messages)').all().map((column) => column.name);
  assert.ok(vendorProfileColumns.includes('gallery_json'));
  assert.ok(portalMessageColumns.includes('progress_url'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM platform_ratings').get().count, 0);
  db.prepare(`
    INSERT INTO client_link_approvals (event_id, approval_type, approved_by, decision, fingerprint)
    VALUES (?, 'timeline', 'Client', 'approved', 'timeline-v1'),
      (?, 'timeline', 'Client', 'changes', 'timeline-v2')
  `).run(eventId, eventId);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM client_link_approvals WHERE event_id = ?').get(eventId).count, 2);
  db.prepare(`
    INSERT INTO event_requests (user_id, client_id, title, status, event_id)
    VALUES (?, ?, 'Wedding request', 'approved', ?)
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
    INSERT INTO client_portal_messages
      (user_id, client_id, event_id, sender_role, message, progress_url, delivery_status)
    VALUES (?, ?, ?, 'planner', 'Welcome to the portal.', 'https://nodevents.test/client/example', 'sent')
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

test('migrates existing client request statuses and preserves linked event history', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodevents-client-migration-'));
  const legacyDb = new DatabaseSync(path.join(directory, 'data.db'));
  legacyDb.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      organization TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL
    );
    CREATE TABLE client_link_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      approval_type TEXT NOT NULL,
      vendor_id INTEGER,
      approved_by TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_client_link_approval_target
      ON client_link_approvals(event_id, approval_type, COALESCE(vendor_id, 0));
    CREATE TABLE event_requests (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'other',
      desired_date TEXT NOT NULL DEFAULT '',
      venue TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      estimated_budget REAL NOT NULL DEFAULT 0 CHECK (estimated_budget >= 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'declined')),
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Planner', 'planner@example.test', 'hash');
    INSERT INTO clients (id, user_id, name) VALUES (1, 1, 'Client');
    INSERT INTO events (id, user_id, title, event_date) VALUES (1, 1, 'Wedding', '2027-06-01');
    INSERT INTO client_link_approvals (event_id, approval_type, approved_by)
      VALUES (1, 'timeline', 'Legacy Client');
    INSERT INTO event_requests (id, user_id, client_id, title, status, event_id)
      VALUES (1, 1, 1, 'Approved history', 'converted', 1);
    INSERT INTO event_requests (id, user_id, client_id, title, status)
      VALUES (2, 1, 1, 'Rejected history', 'declined');
  `);
  legacyDb.close();
  fs.copyFileSync(path.join(__dirname, '..', 'db.js'), path.join(directory, 'db.js'));
  const db = require(path.join(directory, 'db.js'));
  context.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  assert.deepEqual(
    db.prepare('SELECT status, decision_reason, event_id FROM event_requests ORDER BY id').all()
      .map((row) => ({ ...row })),
    [
      { status: 'approved', decision_reason: '', event_id: 1 },
      { status: 'rejected', decision_reason: '', event_id: null },
    ],
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('SELECT client_show_budget FROM events WHERE id = 1').get().client_show_budget, 1);
  const approvalColumns = db.prepare('PRAGMA table_info(client_link_approvals)').all().map((column) => column.name);
  assert.ok(approvalColumns.includes('decision'));
  assert.ok(approvalColumns.includes('note'));
  assert.ok(approvalColumns.includes('fingerprint'));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_client_link_approval_target'").get().count,
    0,
  );
  assert.doesNotThrow(() => db.prepare(`
    INSERT INTO client_link_approvals (event_id, approval_type, approved_by)
    VALUES (1, 'timeline', 'Second approval')
  `).run());
  assert.doesNotThrow(() => db.prepare(`
    INSERT INTO event_requests (user_id, client_id, title, status)
    VALUES (1, 1, 'Changes requested', 'changes_requested')
  `).run());
});
