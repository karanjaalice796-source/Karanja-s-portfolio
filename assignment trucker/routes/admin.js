const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const wrap = require('../lib/wrap');
const { clean, isEmail } = require('../lib/validate');
const { requireRole, notFound, setFlash } = require('../middleware/auth');

const router = express.Router();
const ROLES = ['student', 'teacher', 'admin'];
router.use(requireRole('admin'));

router.get('/', wrap(async function (req, res) {
  var stats = (await db.query(
    "SELECT (SELECT COUNT(*) FROM users WHERE role = 'student' AND active) AS students," +
    " (SELECT COUNT(*) FROM users WHERE role = 'teacher' AND active) AS teachers," +
    ' (SELECT COUNT(*) FROM courses) AS courses,' +
    ' (SELECT COUNT(*) FROM assignments WHERE course_id IS NOT NULL) AS assignments,' +
    ' (SELECT COUNT(*) FROM assignments a JOIN enrollments e ON e.course_id = a.course_id' +
    ' WHERE a.due_on < CURRENT_DATE AND NOT EXISTS (SELECT 1 FROM submissions s' +
    ' WHERE s.assignment_id = a.id AND s.student_id = e.student_id AND s.submitted_at IS NOT NULL)) AS overdue'
  )).rows[0];
  var recent = (await db.query('SELECT id, role, full_name, email, created_at FROM users ORDER BY created_at DESC, id DESC LIMIT 6')).rows;
  res.render('admin/dashboard', { title: 'Overview', stats: stats, recent: recent });
}));

router.get('/users', wrap(async function (req, res) {
  var role = ROLES.indexOf(req.query.role) > -1 ? req.query.role : '';
  var q = clean(req.query.q, 60);
  var where = [], params = [];
  if (role) { params.push(role); where.push('role = $' + params.length); }
  if (q) {
    params.push('%' + q + '%');
    where.push('(full_name ILIKE $' + params.length + ' OR email ILIKE $' + params.length + ' OR student_no ILIKE $' + params.length + ')');
  }
  var users = (await db.query(
    'SELECT id, role, full_name, email, student_no, active, approved FROM users' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY role, full_name LIMIT 300', params
  )).rows;
  res.render('admin/users', { title: 'People', users: users, role: role, q: q });
}));

router.get('/users/new', function (req, res) {
  res.render('admin/user-form', { title: 'Add a person', error: null, form: { role: 'student' } });
});

router.post('/users', wrap(async function (req, res) {
  var form = {
    role: ROLES.indexOf(req.body.role) > -1 ? req.body.role : 'student',
    full_name: clean(req.body.full_name, 100),
    email: clean(req.body.email, 150).toLowerCase(),
    student_no: clean(req.body.student_no, 30)
  };
  var password = String(req.body.password || '');
  var error = !form.full_name ? 'Enter the full name.' : !isEmail(form.email) ? 'Enter a valid email address.' :
    form.role === 'student' && !form.student_no ? 'Students need a student number.' :
      password.length < 8 ? 'Use a starting password with at least 8 characters.' : null;
  if (error) return res.status(400).render('admin/user-form', { title: 'Add a person', error: error, form: form });
  try {
    var hash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (role, full_name, email, student_no, password_hash) VALUES ($1,$2,$3,$4,$5)',
      [form.role, form.full_name, form.email, form.role === 'student' ? form.student_no : null, hash]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).render('admin/user-form', {
      title: 'Add a person', error: 'That email or student number is already in use.', form: form
    });
    throw err;
  }
  setFlash(req, 'success', form.full_name + ' was added.');
  res.redirect('/admin/users');
}));

router.post('/users/:id/toggle', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return notFound(res);
  if (id === req.session.user.id) {
    setFlash(req, 'error', 'You cannot switch off your own account.');
    return res.redirect('/admin/users');
  }
  var result = await db.query('UPDATE users SET active = NOT active WHERE id = $1 AND approved = TRUE', [id]);
  setFlash(req, result.rowCount ? 'success' : 'error', result.rowCount ? 'Account updated.' : 'Person not found.');
  res.redirect('/admin/users');
}));

router.post('/users/:id/approve', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return notFound(res);
  var result = await db.query(
    "UPDATE users SET approved = TRUE, active = TRUE WHERE id = $1 AND role = 'teacher' AND approved = FALSE",
    [id]
  );
  setFlash(req, result.rowCount ? 'success' : 'error', result.rowCount ? 'Trainer account approved.' : 'Pending trainer not found.');
  res.redirect('/admin/users');
}));

router.post('/users/:id/password', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  var password = String(req.body.password || '');
  if (!Number.isInteger(id) || id < 1) return notFound(res);
  if (password.length < 8) {
    setFlash(req, 'error', 'The new password needs at least 8 characters.');
    return res.redirect('/admin/users');
  }
  var result = await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 10), id]);
  setFlash(req, result.rowCount ? 'success' : 'error', result.rowCount ? 'Password changed.' : 'Person not found.');
  res.redirect('/admin/users');
}));

router.get('/courses', wrap(async function (req, res) {
  var courses = (await db.query(
    'SELECT c.id, c.name, c.code, c.teacher_id, u.full_name AS teacher_name,' +
    ' (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students,' +
    ' (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id) AS assignments' +
    ' FROM courses c LEFT JOIN users u ON u.id = c.teacher_id ORDER BY c.name'
  )).rows;
  var teachers = (await db.query("SELECT id, full_name FROM users WHERE role = 'teacher' AND active ORDER BY full_name")).rows;
  res.render('admin/courses', { title: 'Courses', courses: courses, teachers: teachers });
}));

async function validTeacher(raw) {
  var id = parseInt(raw, 10);
  if (!Number.isInteger(id)) return null;
  var result = await db.query("SELECT id FROM users WHERE id = $1 AND role = 'teacher' AND active", [id]);
  return result.rows.length ? id : null;
}

router.post('/courses', wrap(async function (req, res) {
  var name = clean(req.body.name, 80);
  var code = clean(req.body.code, 20).toUpperCase() || null;
  if (!name) { setFlash(req, 'error', 'Enter a course name.'); return res.redirect('/admin/courses'); }
  try {
    await db.query('INSERT INTO courses (name, code, teacher_id) VALUES ($1,$2,$3)',
      [name, code, await validTeacher(req.body.teacher_id)]);
    setFlash(req, 'success', 'Course added.');
  } catch (err) {
    if (err.code !== '23505') throw err;
    setFlash(req, 'error', 'That course code is already used.');
  }
  res.redirect('/admin/courses');
}));

router.post('/courses/:id/teacher', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return notFound(res);
  var result = await db.query('UPDATE courses SET teacher_id = $1 WHERE id = $2', [await validTeacher(req.body.teacher_id), id]);
  setFlash(req, result.rowCount ? 'success' : 'error', result.rowCount ? 'Trainer updated.' : 'Course not found.');
  res.redirect('/admin/courses');
}));

router.post('/courses/:id/delete', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return notFound(res);
  var result = await db.query('DELETE FROM courses WHERE id = $1', [id]);
  setFlash(req, result.rowCount ? 'success' : 'error', result.rowCount ? 'Course and its assignments were deleted.' : 'Course not found.');
  res.redirect('/admin/courses');
}));

module.exports = router;