const db = require('../config/db');

async function studentAssignments(studentId, assignmentId) {
  var params = [studentId];
  var assignmentFilter = '';
  if (assignmentId !== undefined) {
    params.push(assignmentId);
    assignmentFilter = ' AND a.id = $2';
  }
  var result = await db.query(
    'SELECT a.id, a.course_id, a.owner_id, a.title, a.description, a.issued_on, a.due_on, a.max_marks,' +
    " COALESCE(c.name, 'Personal task') AS course_name," +
    " COALESCE(s.status, 'Not Started') AS status, s.submitted_at, s.work_note, s.marks, s.feedback," +
    ' s.id AS submission_id' +
    ' FROM assignments a' +
    ' LEFT JOIN courses c ON c.id = a.course_id' +
    ' LEFT JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = $1' +
    ' LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = $1' +
    ' WHERE (a.owner_id = $1 OR e.student_id = $1)' + assignmentFilter +
    ' ORDER BY a.due_on, a.id', params
  );
  return result.rows;
}

module.exports = { studentAssignments: studentAssignments };