CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updates BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('school_admin', 'teacher', 'bursar')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, school_id),
  UNIQUE (school_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_school_per_user ON memberships(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  school_id UUID NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, school_id) REFERENCES memberships(user_id, school_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS school_invitations (
  token_hash TEXT PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'bursar')),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS school_invitations_school_id ON school_invitations(school_id);
CREATE UNIQUE INDEX IF NOT EXISTS school_invitations_pending_email
  ON school_invitations(school_id, email)
  WHERE claimed_at IS NULL;

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  admission_no TEXT NOT NULL CHECK (char_length(admission_no) BETWEEN 1 AND 40),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, id),
  UNIQUE (school_id, admission_no),
  FOREIGN KEY (created_by, school_id) REFERENCES memberships(user_id, school_id)
);
CREATE INDEX IF NOT EXISTS students_school_name ON students(school_id, full_name);

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  student_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  recorded_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_id, attendance_date),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by, school_id) REFERENCES memberships(user_id, school_id)
);
CREATE INDEX IF NOT EXISTS attendance_school_date ON attendance(school_id, attendance_date);

CREATE TABLE IF NOT EXISTS fee_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  student_id UUID NOT NULL,
  amount_kes NUMERIC(12, 2) NOT NULL CHECK (amount_kes > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'mpesa_manual', 'other')),
  reference TEXT CHECK (reference IS NULL OR char_length(reference) <= 80),
  note TEXT NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  recorded_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id),
  FOREIGN KEY (recorded_by, school_id) REFERENCES memberships(user_id, school_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fee_payment_school_reference
  ON fee_payments(school_id, reference)
  WHERE reference IS NOT NULL AND reference <> '';
CREATE INDEX IF NOT EXISTS fee_payments_school_paid_at ON fee_payments(school_id, paid_at DESC);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS students_tenant_isolation ON students;
CREATE POLICY students_tenant_isolation ON students
  USING (school_id = NULLIF(current_setting('app.school_id', true), '')::UUID)
  WITH CHECK (school_id = NULLIF(current_setting('app.school_id', true), '')::UUID);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_tenant_isolation ON attendance;
CREATE POLICY attendance_tenant_isolation ON attendance
  USING (school_id = NULLIF(current_setting('app.school_id', true), '')::UUID)
  WITH CHECK (school_id = NULLIF(current_setting('app.school_id', true), '')::UUID);

ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fee_payments_tenant_isolation ON fee_payments;
CREATE POLICY fee_payments_tenant_isolation ON fee_payments
  USING (school_id = NULLIF(current_setting('app.school_id', true), '')::UUID)
  WITH CHECK (school_id = NULLIF(current_setting('app.school_id', true), '')::UUID);
