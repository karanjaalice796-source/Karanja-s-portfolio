const express = require('express');
const db = require('../config/db');
const wrap = require('../lib/wrap');
const csv = require('../lib/csv');
const dates = require('../lib/dates');
const { clean, isDate } = require('../lib/validate');
const { requireRole, notFound, setFlash } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('teacher', 'admin'));

async function ownedCourse(user, courseId) {
  if (!Number.isInteger(courseId)) return null;
  if (user.role === 'admin') {
    var allCourses = await db.query('SELECT id, name, code FROM courses WHERE id = $1', [courseId]);
    return allCourses.rows[0] || null;
  }
  var result = await db.query('SELECT id, name, code FROM courses WHERE id = $1 AND teacher_id = $2', [courseId, user.id]);
  return result.rows[0] || null;
}

async function ownedAssignment(user, assignmentId) {
  if (!Number.isInteger(assignmentId)) return null;
  var scope = user.role === 'admin' ? '' : ' AND c.teacher_id = $2';
  var params = user.role === 'admin' ? [assignmentId] : [assignmentId, user.id];
  var result = await db.query(
    'SELECT a.*, c.name AS course_name, c.code AS course_code FROM assignments a' +
    ' JOIN courses c ON c.id = a.course_id WHERE a.id = $1' + scope,
    params
  );
  return result.rows[0] || null;
}

router.get('/', wrap(async function (req, res) {
  var admin = req.session.user.role === 'admin';
  var courseScope = admin ? '' : ' WHERE c.teacher_id = $1';
  var params = admin ? [] : [req.session.user.id];
  var courses = (await db.query(
    'SELECT c.id, c.name, c.code,' +
    ' (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students,' +
    ' (SELECT COUNT(*) FROM assignments a WHERE a.course_id = c.id) AS assignments' +
    ' FROM courses c' + courseScope + ' ORDER BY c.name', params
  )).rows;
  var recent = (await db.query(
    'SELECT a.id, a.title, a.due_on, c.name AS course_name,' +
    ' (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students,' +
    ' (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.submitted_at IS NOT NULL) AS handed_in' +
    ' FROM assignments a JOIN courses c ON c.id = a.course_id' + courseScope +
    ' ORDER BY a.created_at DESC LIMIT 8', params
  )).rows;
  res.render('teacher/dashboard', { title: 'Trainer overview', courses: courses, recent: recent });
}));

router.get('/courses/:id', wrap(async function (req, res) {
  var courseId = parseInt(req.params.id, 10);
  var course = await ownedCourse(req.session.user, courseId);
  if (!course) return notFound(res);
  var students = (await db.query(
    'SELECT u.id, u.full_name, u.email, u.student_no FROM enrollments e' +
    ' JOIN users u ON u.id = e.student_id WHERE e.course_id = $1 ORDER BY u.full_name', [courseId]
  )).rows;
  var assignments = (await db.query(
    'SELECT a.id, a.title, a.due_on, a.max_marks,' +
    ' (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.submitted_at IS NOT NULL) AS handed_in' +
    ' FROM assignments a WHERE a.course_id = $1 ORDER BY a.due_on, a.id', [courseId]
  )).rows;
  res.render('teacher/course', { title: course.name, course: course, students: students, assignments: assignments });
}));

router.post('/courses/:id/students', wrap(async function (req, res) {
  var courseId = parseInt(req.params.id, 10);
  var course = await ownedCourse(req.session.user, courseId);
  if (!course) return notFound(res);
  var lookup = clean(req.body.student, 150).toLowerCase();
  var student = (await db.query(
    "SELECT id, full_name FROM users WHERE active AND role = 'student' AND (LOWER(email) = $1 OR LOWER(student_no) = $1)", [lookup]
  )).rows[0];
  if (!student) {
    setFlash(req, 'error', 'No active student matches that email or student number.');
    return res.redirect('/teacher/courses/' + courseId);
  }
  var result = await db.query('INSERT INTO enrollments (course_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [courseId, student.id]);
  if (!result.rowCount) setFlash(req, 'error', 'That student is already enrolled.');
  else {
    await db.query('INSERT INTO notifications (user_id, message) VALUES ($1,$2)', [student.id, 'You were added to ' + course.name + '.']);
    setFlash(req, 'success', student.full_name + ' was added to the course.');
  }
  res.redirect('/teacher/courses/' + courseId);
}));

router.post('/courses/:id/students/:studentId/remove', wrap(async function (req, res) {
  var courseId = parseInt(req.params.id, 10);
  var studentId = parseInt(req.params.studentId, 10);
  var course = await ownedCourse(req.session.user, courseId);
  if (!course) return notFound(res);
  var result = await db.query('DELETE FROM enrollments WHERE course_id = $1 AND student_id = $2', [courseId, studentId]);
  setFlash(req, result.rowCount ? 'success' : 'error', result.rowCount ? 'Student removed from the course.' : 'Enrollment not found.');
  res.redirect('/teacher/courses/' + courseId);
}));

router.get('/assignments/new', wrap(async function (req, res) {
  var courseSql = req.session.user.role === 'admin'
    ? 'SELECT id, name FROM courses ORDER BY name'
    : 'SELECT id, name FROM courses WHERE teacher_id = $1 ORDER BY name';
  var courseParams = req.session.user.role === 'admin' ? [] : [req.session.user.id];
  var courses = (await db.query(courseSql, courseParams)).rows;
  var courseId = parseInt(req.query.course, 10);
  if (!courses.length) {
    setFlash(req, 'error', 'Create or ask an admin to assign a course before posting work.');
    return res.redirect('/teacher');
  }
  res.render('teacher/assignment-form', {
    title: 'Post assignment', courses: courses, courseId: courses.some(function (c) { return c.id === courseId; }) ? courseId : courses[0].id,
    form: { issued_on: dates.toISO(new Date()) }, error: null
  });
}));

router.post('/assignments', wrap(async function (req, res) {
  var courseId = parseInt(req.body.course_id, 10);
  var course = await ownedCourse(req.session.user, courseId);
  var form = {
    course_id: courseId,
    title: clean(req.body.title, 80),
    description: clean(req.body.description, 500),
    issued_on: clean(req.body.issued_on, 10) || dates.toISO(new Date()),
    due_on: clean(req.body.due_on, 10),
    max_marks: clean(req.body.max_marks, 4)
  };
  var maxMarks = form.max_marks ? Number(form.max_marks) : null;
  var error = !course ? 'Choose a course you can manage.' : !form.title ? 'Enter an assignment title.' :
    !isDate(form.issued_on) || !isDate(form.due_on) ? 'Choose valid issue and due dates.' :
      form.due_on < form.issued_on ? 'The due date cannot be before the date given.' :
        (maxMarks !== null && (!Number.isInteger(maxMarks) || maxMarks < 1 || maxMarks > 10000)) ? 'Enter a valid maximum mark.' : null;
  if (error) {
    var courses = (await db.query(courseSql, courseParams)).rows;
    return res.status(400).render('teacher/assignment-form', { title: 'Post assignment', courses: courses, courseId: courseId, form: form, error: error });
  }

  var client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    var inserted = await client.query(
      'INSERT INTO assignments (course_id, title, description, issued_on, due_on, max_marks) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [courseId, form.title, form.description || null, form.issued_on, form.due_on, maxMarks]
    );
    await client.query(
      'INSERT INTO notifications (user_id, message) SELECT e.student_id, $1 FROM enrollments e WHERE e.course_id = $2',
      ['New assignment in ' + course.name + ': ' + form.title, courseId]
    );
    await client.query('COMMIT');
    setFlash(req, 'success', 'Assignment posted to ' + course.name + '.');
    res.redirect('/teacher/assignments/' + inserted.rows[0].id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.get('/assignments/:id', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  var assignment = await ownedAssignment(req.session.user, id);
  if (!assignment) return notFound(res);
  var students = (await db.query(
    'SELECT u.id, u.full_name, u.email, u.student_no, s.status, s.submitted_at, s.work_note, s.marks, s.feedback' +
    ' FROM enrollments e JOIN users u ON u.id = e.student_id' +
    ' LEFT JOIN submissions s ON s.assignment_id = $1 AND s.student_id = u.id' +
    ' WHERE e.course_id = $2 ORDER BY u.full_name', [id, assignment.course_id]
  )).rows;
  res.render('teacher/assignment', { title: assignment.title, assignment: assignment, students: students });
}));

router.post('/assignments/:id/marks', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  var assignment = await ownedAssignment(req.session.user, id);
  if (!assignment) return notFound(res);
  var studentId = parseInt(req.body.student_id, 10);
  var rawMarks = clean(req.body.marks, 5);
  var marks = rawMarks ? Number(rawMarks) : null;
  var feedback = clean(req.body.feedback, 500);
  var student = (await db.query('SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2', [assignment.course_id, studentId])).rows[0];
  if (!student || (marks !== null && (!Number.isInteger(marks) || marks < 0 || (assignment.max_marks !== null && marks > assignment.max_marks)))) {
    setFlash(req, 'error', 'Check the student and mark; the mark must be within the maximum.');
    return res.redirect('/teacher/assignments/' + id);
  }
  await db.query(
    "INSERT INTO submissions (assignment_id, student_id, status, marks, feedback) VALUES ($1,$2,'Not Started',$3,$4)" +
    ' ON CONFLICT (assignment_id, student_id) DO UPDATE SET marks = EXCLUDED.marks, feedback = EXCLUDED.feedback',
    [id, studentId, marks, feedback || null]
  );
  await db.query('INSERT INTO notifications (user_id, message) VALUES ($1,$2)', [studentId, 'Your trainer updated marks or feedback for ' + assignment.title + '.']);
  setFlash(req, 'success', 'Marks and feedback saved.');
  res.redirect('/teacher/assignments/' + id);
}));

router.post('/assignments/:id/remind', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  var assignment = await ownedAssignment(req.session.user, id);
  if (!assignment) return notFound(res);
  var result = await db.query(
    'INSERT INTO notifications (user_id, message)' +
    ' SELECT e.student_id, $1 FROM enrollments e' +
    ' LEFT JOIN submissions s ON s.assignment_id = $2 AND s.student_id = e.student_id' +
    ' WHERE e.course_id = $3 AND s.submitted_at IS NULL',
    ['Reminder: please hand in ' + assignment.title + '.', id, assignment.course_id]
  );
  setFlash(req, 'success', result.rowCount + ' student' + (result.rowCount === 1 ? '' : 's') + ' reminded.');
  res.redirect('/teacher/assignments/' + id);
}));

router.get('/assignments/:id/export.csv', wrap(async function (req, res) {
  var id = parseInt(req.params.id, 10);
  var assignment = await ownedAssignment(req.session.user, id);
  if (!assignment) return notFound(res);
  var students = (await db.query(
    'SELECT u.full_name, u.student_no, u.email, s.status, s.submitted_at, s.work_note, s.marks, s.feedback' +
    ' FROM enrollments e JOIN users u ON u.id = e.student_id' +
    ' LEFT JOIN submissions s ON s.assignment_id = $1 AND s.student_id = u.id' +
    ' WHERE e.course_id = $2 ORDER BY u.full_name', [id, assignment.course_id]
  )).rows;
  csv.send(res, 'assignment-' + id + '-submissions.csv',
    ['Student', 'Student ID', 'Email', 'Progress', 'Handed in', 'Work link or note', 'Marks', 'Feedback'],
    students.map(function (student) {
      return [student.full_name, student.student_no, student.email, student.status || 'Not Started',
        student.submitted_at ? dates.pretty(student.submitted_at) : 'No', student.work_note, student.marks, student.feedback];
    }));
}));

module.exports = router;