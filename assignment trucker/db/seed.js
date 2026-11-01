require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const dates = require('../lib/dates');

function offset(days) {
  var date = dates.today();
  date.setDate(date.getDate() + days);
  return dates.toISO(date);
}

async function addUser(role, name, email, studentNo, password) {
  var hash = await bcrypt.hash(password, 10);
  var result = await db.query(
    'INSERT INTO users (role, full_name, email, student_no, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [role, name, email, studentNo, hash]
  );
  return result.rows[0].id;
}

(async function () {
  try {
    var exists = await db.query("SELECT 1 FROM users WHERE email = 'admin@example.com'");
    if (exists.rows.length) {
      console.log('Sample data is already there. Nothing added.');
      return;
    }

    var admin = await addUser('admin', 'Centre Admin', 'admin@example.com', null, 'Admin#12345');
    var teacher = await addUser('teacher', 'Grace Wanjiru', 'teacher@example.com', null, 'Teacher#12345');
    var amina = await addUser('student', 'Amina Otieno', 'amina@example.com', 'TC-2026-001', 'Student#12345');
    var brian = await addUser('student', 'Brian Kamau', 'brian@example.com', 'TC-2026-002', 'Student#12345');
    var cynthia = await addUser('student', 'Cynthia Mutua', 'cynthia@example.com', 'TC-2026-003', 'Student#12345');
    var dennis = await addUser('student', 'Dennis Njoroge', 'dennis@example.com', 'TC-2026-004', 'Student#12345');
    void admin;

    var web = (await db.query("INSERT INTO courses (name, code, teacher_id) VALUES ('Web Development','WEB101',$1) RETURNING id", [teacher])).rows[0].id;
    var database = (await db.query("INSERT INTO courses (name, code, teacher_id) VALUES ('Databases','DB102',$1) RETURNING id", [teacher])).rows[0].id;
    for (var student of [amina, brian, cynthia, dennis]) await db.query('INSERT INTO enrollments (course_id, student_id) VALUES ($1,$2)', [web, student]);
    for (var databaseStudent of [amina, brian]) await db.query('INSERT INTO enrollments (course_id, student_id) VALUES ($1,$2)', [database, databaseStudent]);

    async function addAssignment(courseId, title, description, issued, due, maxMarks) {
      var result = await db.query(
        'INSERT INTO assignments (course_id, title, description, issued_on, due_on, max_marks) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [courseId, title, description, issued, due, maxMarks]
      );
      return result.rows[0].id;
    }
    var a1 = await addAssignment(web, 'HTML portfolio page', 'Header, about section and a contact form.', offset(-10), offset(-3), 20);
    var a2 = await addAssignment(web, 'CSS layout exercise', 'Rebuild the sample page using flexbox.', offset(-4), offset(2), 20);
    await addAssignment(web, 'JavaScript quiz app', 'Five questions, a score at the end.', offset(-1), offset(12), 30);
    var a4 = await addAssignment(database, 'Library database design', 'Draw the tables and relationships.', offset(-6), offset(1), 25);

    async function submission(assignmentId, studentId, status, daysAgo, note, marks, feedback) {
      var submittedAt = daysAgo === null ? null : new Date(Date.now() - daysAgo * 86400000);
      await db.query(
        'INSERT INTO submissions (assignment_id, student_id, status, submitted_at, work_note, marks, feedback) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [assignmentId, studentId, status, submittedAt, note, marks, feedback]
      );
    }
    await submission(a1, amina, 'Completed', 5, 'https://example.com/amina-portfolio', 17, 'Neat layout. Add alt text to your images.');
    await submission(a1, brian, 'Completed', 1, 'https://example.com/brian-portfolio', null, null);
    await submission(a1, cynthia, 'In Progress', null, null, null, null);
    await submission(a2, amina, 'In Progress', null, null, null, null);
    await submission(a4, brian, 'Not Started', null, null, null, null);
    await db.query('INSERT INTO assignments (owner_id, title, description, issued_on, due_on) VALUES ($1,$2,$3,$4,$5)',
      [amina, 'Read chapter 4 notes', 'Before Friday revision.', offset(-2), offset(4)]);

    console.log('Sample data added. Change these passwords before real use.');
    console.log('admin@example.com / Admin#12345');
    console.log('teacher@example.com / Teacher#12345');
    console.log('amina@example.com / Student#12345 (Brian, Cynthia, Dennis use the same student password)');
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();