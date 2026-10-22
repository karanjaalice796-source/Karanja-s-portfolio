const crypto = require('crypto');

function homeFor(role) {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  return '/student';
}

function notFound(res) {
  return res.status(404).render('error', { message: 'We could not find that page.' });
}

function requireRole() {
  var roles = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    if (!req.session.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/login');
    }
    if (roles.indexOf(req.session.user.role) === -1) {
      return res.status(403).render('error', { message: 'You do not have access to that page.' });
    }
    next();
  };
}

function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (req.method === 'POST') {
    var submitted = Buffer.from(String(req.body._csrf || ''));
    var expected = Buffer.from(req.session.csrf);
    if (submitted.length !== expected.length || !crypto.timingSafeEqual(submitted, expected)) {
      return res.status(403).render('error', {
        message: 'Your session expired. Go back, refresh the page and try again.'
      });
    }
  }
  next();
}

function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
}

function setFlash(req, type, text) {
  req.session.flash = { type: type, text: text };
}

function backTo(req, fallback) {
  try {
    var referer = new URL(req.get('referer'));
    if (referer.host === req.get('host')) return referer.pathname + referer.search;
  } catch (e) { /* No usable referer. */ }
  return fallback;
}

module.exports = {
  homeFor: homeFor, notFound: notFound, requireRole: requireRole,
  csrf: csrf, flash: flash, setFlash: setFlash, backTo: backTo
};