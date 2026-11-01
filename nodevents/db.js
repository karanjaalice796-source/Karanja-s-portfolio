const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'data.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
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
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
  CREATE INDEX IF NOT EXISTS idx_guests_event ON guests(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_catering_items_event ON catering_items(event_id, id);
  CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_vendors_event ON vendors(event_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_event_time ON tasks(event_id, start_time);
  CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_id);
  CREATE INDEX IF NOT EXISTS idx_changes_event ON changes(event_id, id);
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

const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some((column) => column.name === 'is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1))');
}
if (!userColumns.some((column) => column.name === 'is_suspended')) {
  db.exec('ALTER TABLE users ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0 CHECK (is_suspended IN (0, 1))');
}

const eventColumns = db.prepare('PRAGMA table_info(events)').all();
if (!eventColumns.some((column) => column.name === 'event_type')) {
  db.exec("ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'other'");
}
if (!eventColumns.some((column) => column.name === 'venue_notes')) {
  db.exec("ALTER TABLE events ADD COLUMN venue_notes TEXT NOT NULL DEFAULT ''");
}
if (!eventColumns.some((column) => column.name === 'client_token')) {
  db.exec('ALTER TABLE events ADD COLUMN client_token TEXT');
}
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
const contractColumns = db.prepare('PRAGMA table_info(vendor_contracts)').all();
if (!contractColumns.some((column) => column.name === 'reminder_sent_at')) {
  db.exec('ALTER TABLE vendor_contracts ADD COLUMN reminder_sent_at TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_vendors_account ON vendors(account_id)');

module.exports = db;
