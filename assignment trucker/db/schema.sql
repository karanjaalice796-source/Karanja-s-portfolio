CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role VARCHAR(10) NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  student_no VARCHAR(30) UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  remind_days SMALLINT NOT NULL DEFAULT 2 CHECK (remind_days IN (0, 1, 2, 3, 7, 14)),
  email_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_sent_on DATE,
  approved BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_reminders BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_sent_on DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  code VARCHAR(20) UNIQUE,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enrollments (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(80) NOT NULL,
  description VARCHAR(500),
  issued_on DATE NOT NULL DEFAULT CURRENT_DATE,
  due_on DATE NOT NULL,
  max_marks SMALLINT CHECK (max_marks IS NULL OR max_marks >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK ((course_id IS NOT NULL AND owner_id IS NULL) OR (course_id IS NULL AND owner_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(12) NOT NULL DEFAULT 'Not Started'
    CHECK (status IN ('Not Started', 'In Progress', 'Completed')),
  submitted_at TIMESTAMP,
  work_note VARCHAR(500),
  marks SMALLINT CHECK (marks IS NULL OR marks >= 0),
  feedback VARCHAR(500),
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message VARCHAR(250) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments (course_id, due_on);
CREATE INDEX IF NOT EXISTS idx_assignments_owner ON assignments (owner_id, due_on);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions (student_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);