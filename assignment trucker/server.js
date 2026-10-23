require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const db = require('./config/db');
const dates = require('./lib/dates');
const { csrf, flash } = require('./middleware/auth');

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('Set DATABASE_URL and a SESSION_SECRET of at least 32 characters in .env.');
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT) || 3000;
const centreName = process.env.CENTRE_NAME || 'Training Centre';
const isProd = process.env.NODE_ENV === 'production';

if (isProd) app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.user = null;
app.locals.centreName = centreName;
app.locals.fmt = dates;
app.locals.allowRegistration = process.env.ALLOW_REGISTRATION !== 'false';
app.locals.csrfToken = '';
app.locals.flash = null;

app.use(function (req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(session({
  store: new PgSession({ pool: db.pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 8 }
}));

app.use(function (req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.centreName = centreName;
  res.locals.fmt = dates;
  res.locals.allowRegistration = process.env.ALLOW_REGISTRATION !== 'false';
  next();
});

app.use(function (req, res, next) {
  if (!req.session.user) return next();
  db.query('SELECT active, role FROM users WHERE id = $1', [req.session.user.id])
    .then(function (result) {
      var account = result.rows[0];
      if (!account || !account.active || account.role !== req.session.user.role) {
        return req.session.destroy(function () { res.redirect('/login'); });
      }
      next();
    })
    .catch(next);
});

app.use(csrf);
app.use(flash);
app.use('/', require('./routes/auth'));
app.use('/student', require('./routes/student'));
app.use('/teacher', require('./routes/teacher'));
app.use('/admin', require('./routes/admin'));
app.use(function (req, res) {
  res.status(404).render('error', { message: 'We could not find that page.' });
});
app.use(function (err, req, res, next) {
  console.error(err);
  res.status(500).render('error', { message: 'Something went wrong on our side. Please try again.' });
});

app.listen(port, function () {
  console.log('Assignment Tracker running at http://localhost:' + port);
});