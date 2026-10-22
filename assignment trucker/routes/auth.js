const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const wrap = require('../lib/wrap');
const { clean, isEmail } = require('../lib/validate');
const { homeFor, setFlash } = require('../middleware/auth');

const router = express.Router();
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;

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
  res.render('login', { error: null, email: '' });
});

router.post('/login', wrap(async function (req, res) {
  var email = clean(req.body.email, 150).toLowerCase();
  var password = String(req.body.password || '');
  if (isBlocked(req.ip)) {
    return res.status(429).render('login', { error: 'Too many attempts. Wait 15 minutes and try again.', email: email });
  }
  var user = (await db.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
  var valid = user && user.active && await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    recordFail(req.ip);
    return res.status(401).render('login', {
      error: user && !user.active ? 'This account has been switched off. Ask your centre admin.' : 'Email or password is not correct.',
      email: email
    });
  }

  attempts.delete(req.ip);
  var returnTo = req.session.returnTo;
  await new Promise(function (resolve, reject) {
    req.session.regenerate(function (err) { return err ? reject(err) : resolve(); });
  });
  req.session.user = { id: user.id, role: user.role, name: user.full_name, remindDays: user.remind_days };
  setFlash(req, 'success', 'Signed in successfully. Welcome back.');
  await saveSession(req);
  if (returnTo && returnTo.charAt(0) === '/' && returnTo.charAt(1) !== '/') return res.redirect(returnTo);
  res.redirect(homeFor(user.role));
}));

router.get('/register', function (req, res) {
  if (process.env.ALLOW_REGISTRATION === 'false') return res.redirect('/login');
  res.render('register', { error: null, form: {} });
});

router.post('/register', wrap(async function (req, res) {
  if (process.env.ALLOW_REGISTRATION === 'false') return res.redirect('/login');
  var form = {
    full_name: clean(req.body.full_name, 100),
    email: clean(req.body.email, 150).toLowerCase(),
    student_no: clean(req.body.student_no, 30)
  };
  var password = String(req.body.password || '');
  var error = null;
  if (!form.full_name) error = 'Enter your full name.';
  else if (!isEmail(form.email)) error = 'Enter a valid email address.';
  else if (!form.student_no) error = 'Enter your student number.';
  else if (password.length < 8) error = 'Use a password with at least 8 characters.';
  else if (password !== String(req.body.confirm || '')) error = 'The two passwords do not match.';
  if (error) return res.status(400).render('register', { error: error, form: form });

  var user;
  try {
    var hash = await bcrypt.hash(password, 10);
    user = (await db.query(
      "INSERT INTO users (role, full_name, email, student_no, password_hash) VALUES ('student',$1,$2,$3,$4)" +
      ' RETURNING id, role, full_name, remind_days',
      [form.full_name, form.email, form.student_no, hash]
    )).rows[0];
  } catch (err) {
    if (err.code === '23505') return res.status(400).render('register', {
      error: 'That email or student number is already registered.', form: form
    });
    throw err;
  }

  await new Promise(function (resolve, reject) {
    req.session.regenerate(function (err) { return err ? reject(err) : resolve(); });
  });
  req.session.user = { id: user.id, role: user.role, name: user.full_name, remindDays: user.remind_days };
  setFlash(req, 'success', 'Your account is ready. Welcome to your assignment tracker.');
  await saveSession(req);
  res.redirect(homeFor(user.role));
}));

router.post('/logout', wrap(async function (req, res) {
  await new Promise(function (resolve, reject) {
    req.session.destroy(function (err) { return err ? reject(err) : resolve(); });
  });
  res.clearCookie('connect.sid');
  res.redirect('/login');
}));

module.exports = router;