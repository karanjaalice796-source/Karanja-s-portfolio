const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'data.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS web_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_web_sessions_expiry ON web_sessions(expires_at);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'planner' CHECK (role IN ('planner', 'client')),
    phone TEXT NOT NULL DEFAULT '',
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    is_suspended INTEGER NOT NULL DEFAULT 0 CHECK (is_suspended IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS oauth_accounts (
    provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
    provider_subject TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (provider, provider_subject)
  );
  CREATE TABLE IF NOT EXISTS vendor_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS vendor_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_account_id INTEGER NOT NULL UNIQUE REFERENCES vendor_accounts(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    category TEXT NOT NULL,
    service_categories TEXT NOT NULL DEFAULT '',
    services TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    gallery_json TEXT NOT NULL DEFAULT '[]',
    is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS vendor_password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_account_id INTEGER NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    organization TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    account_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    invite_token_hash TEXT,
    invite_expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS event_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'other',
    desired_date TEXT NOT NULL DEFAULT '',
    venue TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    estimated_budget REAL NOT NULL DEFAULT 0 CHECK (estimated_budget >= 0),
    desired_time TEXT NOT NULL DEFAULT '',
    expected_guests INTEGER NOT NULL DEFAULT 0 CHECK (expected_guests >= 0),
    services_required TEXT NOT NULL DEFAULT '',
    service_answers TEXT NOT NULL DEFAULT '{}',
    decision_reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS client_request_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES event_requests(id) ON DELETE CASCADE,
    stored_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS client_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    planner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    request_id INTEGER REFERENCES event_requests(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    message TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS planner_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    planner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id INTEGER REFERENCES event_requests(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    message TEXT NOT NULL,
    target_url TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS client_vendor_booking_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    planner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    vendor_profile_id INTEGER NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    message TEXT NOT NULL DEFAULT '',
    decision_reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS client_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS client_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS client_portal_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('planner', 'client')),
    message TEXT NOT NULL,
    progress_url TEXT NOT NULL DEFAULT '',
    delivery_status TEXT NOT NULL CHECK (delivery_status IN ('received', 'sent', 'failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS platform_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT 'other',
    venue TEXT NOT NULL DEFAULT '',
    venue_notes TEXT NOT NULL DEFAULT '',
    budget_total REAL NOT NULL DEFAULT 0 CHECK (budget_total >= 0),
    budget_currency TEXT NOT NULL DEFAULT 'KES',
    expected_guests INTEGER NOT NULL DEFAULT 0 CHECK (expected_guests >= 0),
    catering_allowance_percent REAL NOT NULL DEFAULT 10 CHECK (catering_allowance_percent BETWEEN 0 AND 200),
    client_token TEXT,
    registration_token TEXT,
    custom_questions TEXT NOT NULL DEFAULT '[]',
    registration_is_open INTEGER NOT NULL DEFAULT 0 CHECK (registration_is_open IN (0, 1)),
    meals_served_count INTEGER NOT NULL DEFAULT 0 CHECK (meals_served_count >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    services TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'confirmed', 'declined', 'changes_requested')),
    note TEXT NOT NULL DEFAULT '',
    last_notified_at TEXT,
    reminder_count INTEGER NOT NULL DEFAULT 0,
    estimated_cost REAL NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
    cost_per_guest REAL NOT NULL DEFAULT 0 CHECK (cost_per_guest >= 0)
  );
  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  group_size INTEGER NOT NULL DEFAULT 1 CHECK (group_size BETWEEN 1 AND 1000),
  rsvp_status TEXT NOT NULL DEFAULT 'awaiting'
    CHECK (rsvp_status IN ('attending', 'declined', 'awaiting')),
  rsvp_token TEXT,
  checkin_token TEXT,
  checked_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS catering_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_per_portion REAL NOT NULL CHECK (amount_per_portion >= 0),
  unit TEXT NOT NULL,
  cost_per_unit REAL NOT NULL DEFAULT 0 CHECK (cost_per_unit >= 0),
  quantity_override REAL CHECK (quantity_override IS NULL OR quantity_override >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS event_staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'Staff',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS event_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    zone_type TEXT NOT NULL DEFAULT 'Other',
    position_x REAL NOT NULL DEFAULT 50 CHECK (position_x BETWEEN 0 AND 100),
    position_y REAL NOT NULL DEFAULT 50 CHECK (position_y BETWEEN 0 AND 100),
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    assigned_staff_id INTEGER REFERENCES event_staff(id) ON DELETE SET NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high'))
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    amount REAL NOT NULL CHECK (amount >= 0),
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent'
      CHECK (status IN ('sent', 'approved', 'paid')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS vendor_contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    vendor_id INTEGER NOT NULL UNIQUE REFERENCES vendors(id) ON DELETE CASCADE,
    reference TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    agreed_amount REAL NOT NULL DEFAULT 0 CHECK (agreed_amount >= 0),
    deposit_amount REAL NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
    due_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'sent', 'signed', 'complete', 'cancelled')),
    reminder_sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    estimated_amount REAL NOT NULL DEFAULT 0 CHECK (estimated_amount >= 0),
    actual_amount REAL NOT NULL DEFAULT 0 CHECK (actual_amount >= 0),
    expense_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'paid')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ticket_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (event_id, name)
  );
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    ticket_type_id INTEGER NOT NULL REFERENCES ticket_types(id) ON DELETE RESTRICT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    qr_token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'confirmed'
      CHECK (status IN ('awaiting_payment', 'confirmed', 'cancelled')),
    payment_method TEXT NOT NULL DEFAULT '',
    payment_reference TEXT NOT NULL DEFAULT '',
    custom_answers TEXT NOT NULL DEFAULT '{}',
    checked_in_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS payment_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id INTEGER NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('mpesa')),
    merchant_request_id TEXT,
    checkout_request_id TEXT UNIQUE,
    phone TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    result_code TEXT,
    result_description TEXT NOT NULL DEFAULT '',
    receipt_number TEXT,
    callback_amount INTEGER,
    verified_at TEXT,
    callback_received_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status, updated_at);
  CREATE TABLE IF NOT EXISTS event_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    reported_by TEXT NOT NULL,
    title TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS event_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS event_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    registration_id INTEGER NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comments TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS client_link_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    approval_type TEXT NOT NULL CHECK (approval_type IN ('timeline', 'vendor')),
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    approved_by TEXT NOT NULL,
    decision TEXT NOT NULL DEFAULT 'approved',
    note TEXT NOT NULL DEFAULT '',
    fingerprint TEXT NOT NULL DEFAULT '',
    approved_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_client_link_approval_history
    ON client_link_approvals(event_id, approval_type, vendor_id, id);
  CREATE TABLE IF NOT EXISTS client_link_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('client', 'planner')),
    sender_name TEXT NOT NULL,
    message TEXT NOT NULL,
    email_status TEXT NOT NULL DEFAULT 'sent' CHECK (email_status IN ('sent', 'failed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
  CREATE INDEX IF NOT EXISTS idx_clients_user ON clients(user_id, name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_user_email
    ON clients(user_id, lower(email)) WHERE email <> '';
  CREATE INDEX IF NOT EXISTS idx_event_requests_client ON event_requests(client_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_client_messages_client ON client_messages(client_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_client_payments_client ON client_payments(client_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_client_portal_messages_client ON client_portal_messages(client_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_guests_event ON guests(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_catering_items_event ON catering_items(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_vendors_event ON vendors(event_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_event_time ON tasks(event_id, start_time);
  CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_id);
  CREATE INDEX IF NOT EXISTS idx_changes_event ON changes(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_client_link_comments_event ON client_link_comments(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_event_staff_event ON event_staff(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_event_zones_event ON event_zones(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_expenses_event ON expenses(event_id, expense_date, id);
  CREATE INDEX IF NOT EXISTS idx_ticket_types_event ON ticket_types(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id, status, id);
  CREATE INDEX IF NOT EXISTS idx_incidents_event ON event_incidents(event_id, status, id);
  CREATE INDEX IF NOT EXISTS idx_feedback_event ON event_feedback(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_vendor_password_reset_account ON vendor_password_reset_tokens(vendor_account_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_vendor_profiles_directory ON vendor_profiles(is_published, category, business_name);
`);

const eventRequestColumns = db.prepare('PRAGMA table_info(event_requests)').all();
const eventRequestSchema = db.prepare(`
  SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'event_requests'
`).get().sql;
if (!eventRequestColumns.some((column) => column.name === 'decision_reason')
  || !eventRequestSchema.includes("'approved'")) {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE event_requests_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'other',
      desired_date TEXT NOT NULL DEFAULT '',
      venue TEXT NOT NULL DEFAULT '',
      details TEXT NOT NULL DEFAULT '',
      estimated_budget REAL NOT NULL DEFAULT 0 CHECK (estimated_budget >= 0),
      decision_reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO event_requests_new
      (id, user_id, client_id, title, event_type, desired_date, venue, details, estimated_budget,
        status, event_id, created_at, updated_at)
    SELECT id, user_id, client_id, title, event_type, desired_date, venue, details, estimated_budget,
      CASE status WHEN 'converted' THEN 'approved' WHEN 'declined' THEN 'rejected' ELSE status END,
      event_id, created_at, updated_at
    FROM event_requests;
    DROP TABLE event_requests;
    ALTER TABLE event_requests_new RENAME TO event_requests;
    COMMIT;
  `);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_event_requests_client ON event_requests(client_id, status, created_at)');
for (const [column, statement] of [
  ['desired_time', "ALTER TABLE event_requests ADD COLUMN desired_time TEXT NOT NULL DEFAULT ''"],
  ['expected_guests', 'ALTER TABLE event_requests ADD COLUMN expected_guests INTEGER NOT NULL DEFAULT 0 CHECK (expected_guests >= 0)'],
  ['services_required', "ALTER TABLE event_requests ADD COLUMN services_required TEXT NOT NULL DEFAULT ''"],
  ['service_answers', "ALTER TABLE event_requests ADD COLUMN service_answers TEXT NOT NULL DEFAULT '{}'"],
  ['quote_amount', 'ALTER TABLE event_requests ADD COLUMN quote_amount REAL CHECK (quote_amount IS NULL OR quote_amount > 0)'],
  ['quote_details', "ALTER TABLE event_requests ADD COLUMN quote_details TEXT NOT NULL DEFAULT ''"],
  ['quote_sent_at', 'ALTER TABLE event_requests ADD COLUMN quote_sent_at TEXT'],
]) {
  const columns = db.prepare('PRAGMA table_info(event_requests)').all();
  if (!columns.some((item) => item.name === column)) db.exec(statement);
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_client_notifications_user ON client_notifications(client_user_id, read_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_planner_notifications_user ON planner_notifications(planner_user_id, read_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_client_booking_requests_planner ON client_vendor_booking_requests(planner_user_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_client_booking_requests_client ON client_vendor_booking_requests(client_user_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_client_request_attachments_request ON client_request_attachments(request_id, id);
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some((column) => column.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'planner' CHECK (role IN ('planner', 'client'))");
}
if (!userColumns.some((column) => column.name === 'phone')) {
  db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
}
if (!userColumns.some((column) => column.name === 'is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1))');
}
if (!userColumns.some((column) => column.name === 'is_suspended')) {
  db.exec('ALTER TABLE users ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0 CHECK (is_suspended IN (0, 1))');
}

const clientColumns = db.prepare('PRAGMA table_info(clients)').all();
if (!clientColumns.some((column) => column.name === 'account_user_id')) {
  db.exec('ALTER TABLE clients ADD COLUMN account_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
}
if (!clientColumns.some((column) => column.name === 'invite_token_hash')) {
  db.exec('ALTER TABLE clients ADD COLUMN invite_token_hash TEXT');
}
if (!clientColumns.some((column) => column.name === 'invite_expires_at')) {
  db.exec('ALTER TABLE clients ADD COLUMN invite_expires_at TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_clients_account_user ON clients(account_user_id, user_id)');

const eventColumns = db.prepare('PRAGMA table_info(events)').all();
if (!eventColumns.some((column) => column.name === 'event_type')) {
  db.exec("ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'other'");
}
if (!eventColumns.some((column) => column.name === 'client_id')) {
  db.exec('ALTER TABLE events ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL');
}
if (!eventColumns.some((column) => column.name === 'venue_notes')) {
  db.exec("ALTER TABLE events ADD COLUMN venue_notes TEXT NOT NULL DEFAULT ''");
}
if (!eventColumns.some((column) => column.name === 'client_token')) {
  db.exec('ALTER TABLE events ADD COLUMN client_token TEXT');
}
if (!eventColumns.some((column) => column.name === 'client_token_expires_at')) {
  db.exec('ALTER TABLE events ADD COLUMN client_token_expires_at TEXT');
}
if (!eventColumns.some((column) => column.name === 'client_pin_hash')) {
  db.exec('ALTER TABLE events ADD COLUMN client_pin_hash TEXT');
}
if (!eventColumns.some((column) => column.name === 'client_show_budget')) {
  db.exec('ALTER TABLE events ADD COLUMN client_show_budget INTEGER NOT NULL DEFAULT 1 CHECK (client_show_budget IN (0, 1))');
}
const approvalColumns = db.prepare('PRAGMA table_info(client_link_approvals)').all();
if (!approvalColumns.some((column) => column.name === 'decision')) {
  db.exec("ALTER TABLE client_link_approvals ADD COLUMN decision TEXT NOT NULL DEFAULT 'approved'");
}
if (!approvalColumns.some((column) => column.name === 'note')) {
  db.exec("ALTER TABLE client_link_approvals ADD COLUMN note TEXT NOT NULL DEFAULT ''");
}
if (!approvalColumns.some((column) => column.name === 'fingerprint')) {
  db.exec("ALTER TABLE client_link_approvals ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''");
}
db.exec(`
  DROP INDEX IF EXISTS idx_client_link_approval_target;
  CREATE INDEX IF NOT EXISTS idx_client_link_approval_history
    ON client_link_approvals(event_id, approval_type, vendor_id, id);
`);
if (!eventColumns.some((column) => column.name === 'budget_total')) {
  db.exec('ALTER TABLE events ADD COLUMN budget_total REAL NOT NULL DEFAULT 0 CHECK (budget_total >= 0)');
}
if (!eventColumns.some((column) => column.name === 'budget_currency')) {
  db.exec("ALTER TABLE events ADD COLUMN budget_currency TEXT NOT NULL DEFAULT 'KES'");
}
if (!eventColumns.some((column) => column.name === 'expected_guests')) {
  db.exec('ALTER TABLE events ADD COLUMN expected_guests INTEGER NOT NULL DEFAULT 0 CHECK (expected_guests >= 0)');
}
if (!eventColumns.some((column) => column.name === 'catering_allowance_percent')) {
  db.exec('ALTER TABLE events ADD COLUMN catering_allowance_percent REAL NOT NULL DEFAULT 10 CHECK (catering_allowance_percent BETWEEN 0 AND 200)');
}
if (!eventColumns.some((column) => column.name === 'registration_token')) {
  db.exec('ALTER TABLE events ADD COLUMN registration_token TEXT');
}
if (!eventColumns.some((column) => column.name === 'custom_questions')) {
  db.exec("ALTER TABLE events ADD COLUMN custom_questions TEXT NOT NULL DEFAULT '[]'");
}
if (!eventColumns.some((column) => column.name === 'registration_is_open')) {
  db.exec('ALTER TABLE events ADD COLUMN registration_is_open INTEGER NOT NULL DEFAULT 0 CHECK (registration_is_open IN (0, 1))');
}
if (!eventColumns.some((column) => column.name === 'meals_served_count')) {
  db.exec('ALTER TABLE events ADD COLUMN meals_served_count INTEGER NOT NULL DEFAULT 0 CHECK (meals_served_count >= 0)');
}
if (!eventColumns.some((column) => column.name === 'ticket_color')) {
  db.exec("ALTER TABLE events ADD COLUMN ticket_color TEXT NOT NULL DEFAULT '#343a35'");
}
if (!eventColumns.some((column) => column.name === 'ticket_logo')) {
  db.exec("ALTER TABLE events ADD COLUMN ticket_logo TEXT NOT NULL DEFAULT ''");
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_client_token ON events(client_token) WHERE client_token IS NOT NULL');
const eventsWithoutRegistrationTokens = db.prepare('SELECT id FROM events WHERE registration_token IS NULL').all();
const setEventRegistrationToken = db.prepare('UPDATE events SET registration_token = ? WHERE id = ?');
for (const event of eventsWithoutRegistrationTokens) {
  setEventRegistrationToken.run(crypto.randomBytes(32).toString('hex'), event.id);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_registration_token ON events(registration_token) WHERE registration_token IS NOT NULL');

const guestColumns = db.prepare('PRAGMA table_info(guests)').all();
if (!guestColumns.some((column) => column.name === 'email')) {
  db.exec("ALTER TABLE guests ADD COLUMN email TEXT NOT NULL DEFAULT ''");
}
if (!guestColumns.some((column) => column.name === 'rsvp_token')) {
  db.exec('ALTER TABLE guests ADD COLUMN rsvp_token TEXT');
}
if (!guestColumns.some((column) => column.name === 'checkin_token')) {
  db.exec('ALTER TABLE guests ADD COLUMN checkin_token TEXT');
}
if (!guestColumns.some((column) => column.name === 'checked_in_at')) {
  db.exec('ALTER TABLE guests ADD COLUMN checked_in_at TEXT');
}
const guestsNeedingTokens = db.prepare('SELECT id FROM guests WHERE rsvp_token IS NULL OR checkin_token IS NULL').all();
const updateGuestTokens = db.prepare('UPDATE guests SET rsvp_token = COALESCE(rsvp_token, ?), checkin_token = COALESCE(checkin_token, ?) WHERE id = ?');
for (const guest of guestsNeedingTokens) {
  updateGuestTokens.run(crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex'), guest.id);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_rsvp_token ON guests(rsvp_token) WHERE rsvp_token IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_checkin_token ON guests(checkin_token) WHERE checkin_token IS NOT NULL');

const vendorColumns = db.prepare('PRAGMA table_info(vendors)').all();
if (!vendorColumns.some((column) => column.name === 'services')) {
  db.exec("ALTER TABLE vendors ADD COLUMN services TEXT NOT NULL DEFAULT ''");
}
if (!vendorColumns.some((column) => column.name === 'account_id')) {
  db.exec('ALTER TABLE vendors ADD COLUMN account_id INTEGER REFERENCES vendor_accounts(id) ON DELETE SET NULL');
}
if (!vendorColumns.some((column) => column.name === 'last_notified_at')) {
  db.exec('ALTER TABLE vendors ADD COLUMN last_notified_at TEXT');
}
if (!vendorColumns.some((column) => column.name === 'reminder_count')) {
  db.exec('ALTER TABLE vendors ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0');
}
if (!vendorColumns.some((column) => column.name === 'estimated_cost')) {
  db.exec('ALTER TABLE vendors ADD COLUMN estimated_cost REAL NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0)');
}
if (!vendorColumns.some((column) => column.name === 'cost_per_guest')) {
  db.exec('ALTER TABLE vendors ADD COLUMN cost_per_guest REAL NOT NULL DEFAULT 0 CHECK (cost_per_guest >= 0)');
}
const vendorProfileColumns = db.prepare('PRAGMA table_info(vendor_profiles)').all();
if (!vendorProfileColumns.some((column) => column.name === 'service_categories')) {
  db.exec("ALTER TABLE vendor_profiles ADD COLUMN service_categories TEXT NOT NULL DEFAULT ''");
}
if (!vendorProfileColumns.some((column) => column.name === 'gallery_json')) {
  db.exec("ALTER TABLE vendor_profiles ADD COLUMN gallery_json TEXT NOT NULL DEFAULT '[]'");
}
const portalMessageColumns = db.prepare('PRAGMA table_info(client_portal_messages)').all();
if (!portalMessageColumns.some((column) => column.name === 'progress_url')) {
  db.exec("ALTER TABLE client_portal_messages ADD COLUMN progress_url TEXT NOT NULL DEFAULT ''");
}
const taskColumns = db.prepare('PRAGMA table_info(tasks)').all();
if (!taskColumns.some((column) => column.name === 'assigned_staff_id')) {
  db.exec('ALTER TABLE tasks ADD COLUMN assigned_staff_id INTEGER REFERENCES event_staff(id) ON DELETE SET NULL');
}
if (!taskColumns.some((column) => column.name === 'priority')) {
  db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high'))");
}
const vendorOperationalColumns = db.prepare('PRAGMA table_info(vendors)').all();
if (!vendorOperationalColumns.some((column) => column.name === 'arrival_status')) {
  db.exec("ALTER TABLE vendors ADD COLUMN arrival_status TEXT NOT NULL DEFAULT 'not_arrived' CHECK (arrival_status IN ('not_arrived', 'arrived', 'setting_up', 'ready', 'delayed'))");
}
const registrationColumns = db.prepare('PRAGMA table_info(registrations)').all();
if (!registrationColumns.some((column) => column.name === 'custom_answers')) {
  db.exec("ALTER TABLE registrations ADD COLUMN custom_answers TEXT NOT NULL DEFAULT '{}'");
}
if (!registrationColumns.some((column) => column.name === 'account_user_id')) {
  db.exec('ALTER TABLE registrations ADD COLUMN account_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_registrations_account ON registrations(account_user_id, created_at DESC)');
const contractColumns = db.prepare('PRAGMA table_info(vendor_contracts)').all();
if (!contractColumns.some((column) => column.name === 'reminder_sent_at')) {
  db.exec('ALTER TABLE vendor_contracts ADD COLUMN reminder_sent_at TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_vendors_account ON vendors(account_id)');

module.exports = db;
