const db = require('./db');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node make-admin.js planner@example.com');
  db.close();
  process.exitCode = 1;
} else {
  const account = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
  if (!account) {
    console.error(`No planner account exists for ${email}. Register that account first, then run this command again.`);
    db.close();
    process.exitCode = 1;
  } else {
    db.prepare('UPDATE users SET is_admin = 1, is_suspended = 0 WHERE id = ?').run(account.id);
    console.log(`Admin access enabled for ${account.name} (${email}). Reload the app page to refresh the navigation.`);
    db.close();
  }
}
