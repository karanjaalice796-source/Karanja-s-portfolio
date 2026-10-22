const express = require('express');
const db = require('../config/db');
const wrap = require('../lib/wrap');
const csv = require('../lib/csv');
const dates = require('../lib/dates');
const { clean, isDate } = require('../lib/validate');
const { studentAssignments } = require('../lib/queries');
const { requireRole, notFound, setFlash, backTo } = require('../middleware/auth');

const router = express.Router();
const STATUSES = ['Not Started', 'In Progress', 'Completed'];
router.use(requireRole('student', 'teacher', 'admin'));

async function loadOne(me, id) {
  if (!Number.isInteger(id)) return null;
  var rows = await studentAssignments(me.id, id);
  return rows.length ? dates.annotate(rows[0], me.remindDays) : null;
}

async function saveStatus(assignmentId, studentId, status) {
  var submittedAt = status === 'Completed' ? new Date() : null;
  await db.query(
    'INSERT INTO submissions (assignment_id, student_id, status, submitted_at) VALUES ($1,$2,$3,$4)' +
    ' ON CONFLICT (assignment_id, student_id) DO UPDATE SET status = EXCLUDED.status, submitted_at = EXCLUDED.submitted_at',
    [assignmentId, studentId, status, submittedAt]
  );
}

router.get('/', wrap(async function (req, res) {
  var me = req.session.user;
  var all = (await studentAssignments(me.id)).map(function (row) { return dates.annotate(row, me.remindDays); });
  var filter = ['open', 'overdue', 'completed', 'all'].indexOf(req.query.filter) > -1 ? req.query.filter : 'open';
  var sort = ['due', 'course', 'status'].indexOf(req.query.sort) > -1 ? req.query.sort : 'due';
  var q = clean(req.query.q, 60).toLowerCase();
  var course = clean(req.query.course, 80);
  var rows = all.filter(function (row) {
    if (filter === 'open' && row.submitted) return false;
    if (filter === 'overdue' && row.state !== 'late') return false;
    if (filter === 'completed' && !row.submitted) return false;
    if (course && row.course_name !== course) return false;
    if (q && (row.title + ' ' + (row.description || '') + ' ' + row.course_name).toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  rows.sort(function (a, b) {
    if (sort === 'course') return a.course_name.localeCompare(b.course_name) || String(a.due_on).localeCompare(String(b.due_on));
    if (sort === 'status') return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || String(a.due_on).localeCompare(String(b.due_on));
    return String(a.due_on).localeCompare(String(b.due_on));
  });
  var courses = Array.from(new Set(all.map(function (row) { return row.course_name; }))).sort();
  var summary = {
    open: all.filter(function (row) { return !row.submitted; }).length,
    week: all.filter(function (row) { return !row.submitted && row.days >= 0 && row.days <= 7; }).length,
    late: all.filter(function (row) { return row.state === 'late'; }).length,
    done: all.filter(function (row) { return row.submitted; }).length
  };
  var alerts = all.filter(function (row) { return row.state === 'late' || row.state === 'soon'; });
  var notes = (await db.query('SELECT id, message, created_at FROM notifications WHERE user_id = $1 AND is_read = FALSE ORDER BY created_at DESC LIMIT 20', [me.id])).rows;
  res.render('student/dashboard', {
    title: 'My assignments', rows: rows, courses: courses, summary: summary, alerts: alerts,
    notes: notes, filter: filter, sort: sort, q: q, course: course, totalCount: all.length
  });
}));

router.post('/notifications/read', wrap(async function (req, res) {
  await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [req.session.user.id]);
  res.redirect('/student');
}));

router.post('/settings', wrap(async function (req, res) {
  var remindDays = parseInt(req.body.remind_days, 10);
  if ([0, 1, 2, 3, 7, 14].indexOf(remindDays) === -1) remindDays = 2;
  await db.query('UPDATE users SET remind_days = $1 WHERE id = $2', [remindDays, req.session.user.id]);
  req.session.user.remindDays = remindDays;
  setFlash(req, 'success', 'Reminder setting saved.');
  res.redirect(backTo(req, '/student'));
}));

router.get('/assignments/:id', wrap(async function (req, res) {
  var assignment = await loadOne(req.session.user, parseInt(req.params.id, 10));
  if (!assignment) return notFound(res);
  res.render('student/detail', { title: assignment.title, a: assignment, personal: assignment.owner_id !== null, statuses: STATUSES });
}));

router.post('/assignments/:id/progress', wrap(async function (req, res) {
  var me = req.session.user;
  var id = parseInt(req.params.id, 10);
  var assignment = await loadOne(me, id);
  if (!assignment) return notFound(res);
  var personal = assignment.owner_id !== null;
  var allowed = personal ? STATUSES : ['Not Started', 'In Progress'];
  if (allowed.indexOf(req.body.status) === -1) setFlash(req, 'error', 'Pick a progress option from the list.');
  else if (!personal && assignment.submitted) setFlash(req, 'error', 'This assignment is already handed in.');
  else await saveStatus(id, me.id, req.body.status);
  res.redirect(backTo(req, '/student/assignments/' + id));
}));

router.post('/assignments/:id/submit', wrap(async function (req, res) {
  var me = req.session.user;
  var id = parseInt(req.params.id, 10);
  var assignment = await loadOne(me, id);
  if (!assignment || assignment.owner_id !== null) return notFound(res);
  if (assignment.submitted) { setFlash(req, 'error', 'You already handed this in.'); return res.redirect('/student/assignments/' + id); }
  var note = clean(req.body.work_note, 500);
  if (!note) { setFlash(req, 'error', 'Add a link or short note about your work before handing it in.'); return res.redirect('/student/assignments/' + id); }
  await db.query(
    "INSERT INTO submissions (assignment_id, student_id, status, submitted_at, work_note) VALUES ($1,$2,'Completed',NOW(),$3)" +
    " ON CONFLICT (assignment_id, student_id) DO UPDATE SET status = 'Completed', submitted_at = NOW(), work_note = EXCLUDED.work_note",
    [id, me.id, note]
  );
  setFlash(req, 'success', 'Handed in. Your trainer can now see it.');
  res.redirect('/student/assignments/' + id);
}));

function readTask(body) {
  var values = {
    title: clean(body.title, 80),
    description: clean(body.description, 500),
    issued_on: clean(body.issued_on, 10) || dates.toISO(new Date()),
    due_on: clean(body.due_on, 10),
    status: STATUSES.indexOf(body.status) > -1 ? body.status : 'Not Started'
  };
  var error = !values.title ? 'Enter a title for the task.' : !isDate(values.due_on) ? 'Pick a valid due date.' :
    !isDate(values.issued_on) ? 'The date given is not valid.' : null;
  return { values: values, error: error };
}

router.get('/tasks/new', function (req, res) {
  res.render('student/form', {
    title: 'Add a task', heading: 'Add your own task', action: '/student/tasks',
    task: { issued_on: dates.toISO(new Date()), status: 'Not Started' }, error: null, statuses: STATUSES
  });
});

router.post('/tasks', wrap(async function (req, res) {
  var task = readTask(req.body);
  if (task.error) return res.status(400).render('student/form', {
    title: 'Add a task', heading: 'Add your own task', action: '/student/tasks',
    task: task.values, error: task.error, statuses: STATUSES
  });
  var inserted = await db.query(
    'INSERT INTO assignments (owner_id, title, description, issued_on, due_on) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [req.session.user.id, task.values.title, task.values.description, task.values.issued_on, task.values.due_on]
  );
  await saveStatus(inserted.rows[0].id, req.session.user.id, task.values.status);
  setFlash(req, 'success', 'Task added.');
  res.redirect('/student');
}));

router.get('/tasks/:id/edit', wrap(async function (req, res) {
  var assignment = await loadOne(req.session.user, parseInt(req.params.id, 10));
  if (!assignment || assignment.owner_id !== req.session.user.id) return notFound(res);
  res.render('student/form', {
    title: 'Edit task', heading: 'Edit task', action: '/student/tasks/' + assignment.id,
    task: assignment, error: null, statuses: STATUSES
  });
}));

router.post('/tasks/:id', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  var assignment = await loadOne(req.session.user, id);
  if (!assignment || assignment.owner_id !== req.session.user.id) return notFound(res);
  var task = readTask(req.body);
  if (task.error) return res.status(400).render('student/form', {
    title: 'Edit task', heading: 'Edit task', action: '/student/tasks/' + id,
    task: task.values, error: task.error, statuses: STATUSES
  });
  await db.query('UPDATE assignments SET title = $1, description = $2, issued_on = $3, due_on = $4 WHERE id = $5 AND owner_id = $6',
    [task.values.title, task.values.description, task.values.issued_on, task.values.due_on, id, req.session.user.id]);
  await saveStatus(id, req.session.user.id, task.values.status);
  setFlash(req, 'success', 'Task saved.');
  res.redirect('/student');
}));

router.post('/tasks/:id/delete', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  if (Number.isInteger(id)) await db.query('DELETE FROM assignments WHERE id = $1 AND owner_id = $2', [id, req.session.user.id]);
  setFlash(req, 'success', 'Task deleted.');
  res.redirect('/student');
}));

router.get('/export.csv', wrap(async function (req, res) {
  var me = req.session.user;
  var rows = (await studentAssignments(me.id)).map(function (row) { return dates.annotate(row, me.remindDays); });
  csv.send(res, 'my-assignments-' + dates.toISO(new Date()) + '.csv',
    ['Course', 'Title', 'Notes', 'Date given', 'Due date', 'Progress', 'Handed in', 'Marks', 'Out of'],
    rows.map(function (row) {
      return [row.course_name, row.title, row.description, row.issued_on, row.due_on, row.status,
        row.submitted ? (row.handedInLate ? 'Yes, late' : 'Yes') : 'No', row.marks, row.max_marks];
    }));
}));

module.exports = router;