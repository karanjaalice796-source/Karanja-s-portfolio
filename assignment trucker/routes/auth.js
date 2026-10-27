const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const wrap = require('../lib/wrap');
const { clean, isEmail } = require('../lib/validate');
const { homeFor, requireRole, setFlash } = require('../middleware/auth');

const router = express.Router();
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const LOGIN_ROLES = {
  student: 'Student sign in',
  teacher: 'Trainer sign in',
  admin: 'Admin sign in'
};

function loginRole(value) {
  return Object.prototype.hasOwnProperty.call(LOGIN_ROLES, value) ? value : '';
}

function renderLogin(res, role, locals, status) {
  return res.status(status || 200).render('login', Object.assign({
    error: null,
    email: '',
    role: role,
    roleLabel: LOGIN_ROLES[role] || 'Sign in'
  }, locals));
}

function registrationRole(value) {
  return value === 'teacher' ? 'teacher' : 'student';
}

function renderRegistration(res, role, locals, status) {
  return res.status(status || 200).render('register', Object.assign({
    error: null,
    form: {},
    accountType: role,
    pending: false
  }, locals));
}

function isBlocked(ip) {
  var entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW) { attempts.delete(ip); return false; }
  return entry.count >= 8;
}

function recordFail(ip) {
  var entry = attempts.get(ip);
  if (!entry || Date.now() - entry.first > WINDOW) attempts.set(ip, { count: 1, first: Date.now() });
  else entry.count++;
}

function saveSession(req) {
  return new Promise(function (resolve, reject) {
    req.session.save(function (err) { return err ? reject(err) : resolve(); });
  });
}

router.get('/', function (req, res) {
  if (req.session.user) return res.redirect(homeFor(req.session.user.role));
  res.render('home');
});

router.get('/learn', function (req, res) {
  res.render('learn', { title: 'Learning hub' });
});

router.get('/login', function (req, res) {
  if (req.session.user) return res.redirect(homeFor(req.session.user.role));
  renderLogin(res, loginRole(req.query.role));
});

router.post('/login', wrap(async function (req, res) {
  var role = loginRole(req.query.role);
  var email = clean(req.body.email, 150).toLowerCase();
  var password = String(req.body.password || '');
  if (isBlocked(req.ip)) {
    return renderLogin(res, role, {
      error: 'Too many attempts. Wait 15 minutes and try again.',
      email: email
    }, 429);
  }
  var user = (await db.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
  var valid = user && user.active && user.approved && (!role || user.role === role)
    && await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    recordFail(req.ip);
    return renderLogin(res, role, {
      error: user && user.role === 'teacher' && !user.approved
        ? 'Your trainer account is waiting for administrator approval.'
        : user && !user.active ? 'This account has been switched off. Ask your centre admin.' : 'Email or password is not correct.',
      email: email
    }, 401);
  }

  attempts.delete(req.ip);
  var returnTo = req.session.returnTo;
  await new Promise(function (resolve, reject) {
    req.session.regenerate(function (err) { return err ? reject(err) : resolve(); });
  });
  req.session.user = { id: user.id, role: user.role, name: user.full_name, remindDays: user.remind_days };
  setFlash(req, 'success', 'Signed in successfully. Welcome back.');
  await saveSession(req);
  if (role) return res.redirect(homeFor(user.role));
  if (returnTo && returnTo.charAt(0) === '/' && returnTo.charAt(1) !== '/') return res.redirect(returnTo);
  res.redirect(homeFor(user.role));
}));

router.get('/register', function (req, res) {
  if (req.session.user) return res.redirect(homeFor(req.session.user.role));
  if (req.query.role === 'admin') return res.redirect('/login?role=admin');
  var role = registrationRole(req.query.role);
  if (process.env.ALLOW_REGISTRATION === 'false') return res.redirect('/login?role=' + role);
  renderRegistration(res, role, { pending: role === 'teacher' && req.query.pending === '1' });
});

router.post('/register', wrap(async function (req, res) {
  if (req.session.user) return res.redirect(homeFor(req.session.user.role));
  if (req.query.role === 'admin') return res.redirect('/login?role=admin');
  var role = registrationRole(req.query.role);
  if (process.env.ALLOW_REGISTRATION === 'false') return res.redirect('/login?role=' + role);
  var form = {
    full_name: clean(req.body.full_name, 100),
    email: clean(req.body.email, 150).toLowerCase(),
    student_no: role === 'student' ? clean(req.body.student_no, 30) : ''
  };
  var password = String(req.body.password || '');
  var error = null;
  if (!form.full_name) error = 'Enter your full name.';
  else if (!isEmail(form.email)) error = 'Enter a valid email address.';
  else if (role === 'student' && !form.student_no) error = 'Enter your student number.';
  else if (password.length < 8) error = 'Use a password with at least 8 characters.';
  else if (password !== String(req.body.confirm || '')) error = 'The two passwords do not match.';
  if (error) return renderRegistration(res, role, { error: error, form: form }, 400);

  var user;
  try {
    var hash = await bcrypt.hash(password, 10);
    user = (await db.query(
      'INSERT INTO users (role, full_name, email, student_no, password_hash, active, approved)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, role, full_name, remind_days',
      [role, form.full_name, form.email, form.student_no || null, hash, role === 'student', role === 'student']
    )).rows[0];
  } catch (err) {
    if (err.code === '23505') return renderRegistration(res, role, {
      error: 'That email or student number is already registered.',
      form: form
    }, 400);
    throw err;
  }

  if (role === 'teacher') return res.redirect('/register?role=teacher&pending=1');

  await new Promise(function (resolve, reject) {
    req.session.regenerate(function (err) { return err ? reject(err) : resolve(); });
  });
  req.session.user = { id: user.id, role: user.role, name: user.full_name, remindDays: user.remind_days };
  setFlash(req, 'success', 'Your account is ready. Welcome to your assignment tracker.');
  await saveSession(req);
  res.redirect(homeFor(user.role));
}));

router.get('/account', requireRole('student', 'teacher', 'admin'), wrap(async function (req, res) {
  var account = (await db.query(
    'SELECT email, remind_days, email_reminders FROM users WHERE id = $1',
    [req.session.user.id]
  )).rows[0];
  if (!account) return res.redirect('/login');
  res.render('account', { title: 'Account settings', error: null, account: account });
}));

router.post('/account/password', requireRole('student', 'teacher', 'admin'), wrap(async function (req, res) {
  var user = (await db.query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id])).rows[0];
  if (!user) return res.redirect('/login');
  var currentPassword = String(req.body.current_password || '');
  var newPassword = String(req.body.new_password || '');
  var confirmPassword = String(req.body.confirm_password || '');
  var error = !await bcrypt.compare(currentPassword, user.password_hash) ? 'Your current password is not correct.' :
    newPassword.length < 8 ? 'Use a new password with at least 8 characters.' :
      newPassword !== confirmPassword ? 'The new passwords do not match.' :
        await bcrypt.compare(newPassword, user.password_hash) ? 'Choose a password you have not used before.' : null;
  if (error) {
    var account = (await db.query(
      'SELECT email, remind_days, email_reminders FROM users WHERE id = $1',
      [req.session.user.id]
    )).rows[0];
    return res.status(400).render('account', { title: 'Account settings', error: error, account: account });
  }
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    await bcrypt.hash(newPassword, 10), req.session.user.id
  ]);
  setFlash(req, 'success', 'Your password has been changed.');
  res.redirect('/account');
}));

router.post('/account/preferences', requireRole('student', 'teacher', 'admin'), wrap(async function (req, res) {
  var remindDays = parseInt(req.body.remind_days, 10);
  if ([0, 1, 2, 3, 7, 14].indexOf(remindDays) === -1) {
    setFlash(req, 'error', 'Choose a valid reminder window.');
    return res.redirect('/account');
  }
  var emailReminders = req.body.email_reminders === 'on';
  await db.query(
    'UPDATE users SET remind_days = $1, email_reminders = $2 WHERE id = $3',
    [remindDays, emailReminders, req.session.user.id]
  );
  req.session.user.remindDays = remindDays;
  setFlash(req, 'success', 'Your reminder preferences have been saved.');
  res.redirect('/account');
}));

router.post('/logout', wrap(async function (req, res) {
  await new Promise(function (resolve, reject) {
    req.session.destroy(function (err) { return err ? reject(err) : resolve(); });
  });
  res.clearCookie('connect.sid');
  res.redirect('/login');
}));

module.exports = router;