import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import express from 'express';
import pg from 'pg';
import react from '@vitejs/plugin-react';
import { createServer as createViteServer } from 'vite';

const { Pool } = pg;
const scryptAsync = promisify(scrypt);
const projectRoot = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(projectRoot, '.env.local');
const databaseEnvPath = resolve(projectRoot, '.env.database');
if (existsSync(envPath)) loadEnvFile(envPath);
if (existsSync(databaseEnvPath)) loadEnvFile(databaseEnvPath);
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Add your PostgreSQL connection string to CSR Project/.env.database.');
}

const sessionCookieName = 'empower_session';
const sessionDuration = 30 * 24 * 60 * 60;
const invitationRoles = new Set(['teacher', 'bursar']);
const attendanceStatuses = new Set(['present', 'absent', 'late', 'excused']);
const secureCookies = process.env.NODE_ENV === 'production';
const host = process.env.HOST || (secureCookies ? '0.0.0.0' : '127.0.0.1');

const database = new Pool({ connectionString: process.env.DATABASE_URL });
const databaseRole = await database.query(`
  SELECT current_user AS name, rolsuper, rolbypassrls
  FROM pg_roles WHERE rolname = current_user
`);
if (!databaseRole.rows[0] || databaseRole.rows[0].rolsuper || databaseRole.rows[0].rolbypassrls) {
  await database.end();
  throw new Error('DATABASE_URL must use a dedicated PostgreSQL application role without superuser or BYPASSRLS privileges.');
}
await database.query(readFileSync(join(projectRoot, 'db', 'schema.sql'), 'utf8'));

const app = express();
const httpServer = createServer(app);
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

const publicUser = (row) => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  role: row.role,
  updates: Boolean(row.updates),
  createdAt: row.created_at,
  school: {
    id: row.school_id,
    name: row.school_name,
    slug: row.school_slug,
  },
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sessionTokenFrom(request) {
  const cookie = (request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));
  return cookie ? cookie.slice(sessionCookieName.length + 1) : '';
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(response, token, remember = true) {
  const options = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
  };
  if (remember) options.maxAge = sessionDuration * 1000;
  response.cookie(sessionCookieName, token, options);
}

function clearSessionCookie(response) {
  response.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
  });
}

async function createSession(response, userId, schoolId, remember = true, client = database) {
  const token = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (remember ? sessionDuration : 12 * 60 * 60);
  await client.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
  await client.query(
    'INSERT INTO sessions (token_hash, user_id, school_id, expires_at) VALUES ($1, $2, $3, $4)',
    [tokenHash(token), userId, schoolId, expiresAt],
  );
  setSessionCookie(response, token, remember);
}

async function withTransaction(callback) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function withTenant(request, callback) {
  return withTransaction(async (client) => {
    await client.query("SELECT set_config('app.school_id', $1, true)", [request.auth.schoolId]);
    return callback(client);
  });
}

function handleAsync(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function validDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

const sessionSelect = `
  SELECT users.id, users.full_name, users.email, users.updates, users.created_at,
    memberships.role, schools.id AS school_id, schools.name AS school_name,
    schools.slug AS school_slug
  FROM users
  JOIN memberships ON memberships.user_id = users.id
  JOIN schools ON schools.id = memberships.school_id
`;

const authenticate = handleAsync(async (request, response, next) => {
  const token = sessionTokenFrom(request);
  if (!token) throw new HttpError(401, 'Please sign in to continue.');

  const result = await database.query(
    `${sessionSelect}
    JOIN sessions ON sessions.user_id = users.id AND sessions.school_id = schools.id
    WHERE sessions.token_hash = $1 AND sessions.expires_at > $2`,
    [tokenHash(token), Math.floor(Date.now() / 1000)],
  );
  if (!result.rows[0]) {
    await database.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }

  const row = result.rows[0];
  request.auth = {
    userId: row.id,
    schoolId: row.school_id,
    role: row.role,
    user: publicUser(row),
  };
  return next();
});

function allowRoles(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.auth.role)) {
      return next(new HttpError(403, 'Your school role does not allow this action.'));
    }
    return next();
  };
}

app.get('/api/auth/session', handleAsync(async (request, response) => {
  const token = sessionTokenFrom(request);
  if (!token) return response.json({ user: null });
  const result = await database.query(
    `${sessionSelect}
    JOIN sessions ON sessions.user_id = users.id AND sessions.school_id = schools.id
    WHERE sessions.token_hash = $1 AND sessions.expires_at > $2`,
    [tokenHash(token), Math.floor(Date.now() / 1000)],
  );
  if (!result.rows[0]) {
    await database.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
    clearSessionCookie(response);
    return response.json({ user: null });
  }
  return response.json({ user: publicUser(result.rows[0]) });
}));

app.post('/api/auth/signup', handleAsync(async (request, response) => {
  try {
    const body = request.body || {};
    const fullName = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const schoolName = typeof body.schoolName === 'string' ? body.schoolName.trim() : '';
    const inviteToken = typeof body.inviteToken === 'string' ? body.inviteToken : '';
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

    if (fullName.length < 2 || fullName.length > 120) {
      return response.status(400).json({ error: 'Enter a name between 2 and 120 characters.' });
    }
    if (email.length > 254 || !emailPattern.test(email)) {
      return response.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!inviteToken && (schoolName.length < 2 || schoolName.length > 160)) {
      return response.status(400).json({ error: 'Enter a school name between 2 and 160 characters.' });
    }
    if (password.length < 8 || password.length > 128) {
      return response.status(400).json({ error: 'Your password must be between 8 and 128 characters.' });
    }

    const salt = randomBytes(16).toString('hex');
    const passwordHash = await scryptAsync(password, salt, 64);
    const result = await withTransaction(async (client) => {
      let schoolId;
      let role;
      if (inviteToken) {
        const invitation = await client.query(`
          SELECT school_id, role FROM school_invitations
          WHERE token_hash = $1 AND email = $2 AND expires_at > now() AND claimed_at IS NULL
          FOR UPDATE
        `, [tokenHash(inviteToken), email]);
        if (!invitation.rows[0]) {
          throw new HttpError(400, 'This school invitation is invalid, expired, or for a different email address.');
        }
        schoolId = invitation.rows[0].school_id;
        role = invitation.rows[0].role;
      } else {
        const slug = `${schoolName.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 40) || 'school'}-${randomBytes(4).toString('hex')}`;
        const school = await client.query(
          'INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id',
          [schoolName, slug],
        );
        schoolId = school.rows[0].id;
        role = 'school_admin';
      }

      const createdUser = await client.query(`
        INSERT INTO users (full_name, email, password_salt, password_hash, updates)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [fullName, email, salt, passwordHash.toString('hex'), body.updates === true]);
      const userId = createdUser.rows[0].id;
      await client.query(
        'INSERT INTO memberships (user_id, school_id, role) VALUES ($1, $2, $3)',
        [userId, schoolId, role],
      );
      if (inviteToken) {
        await client.query(
          'UPDATE school_invitations SET claimed_at = now() WHERE token_hash = $1',
          [tokenHash(inviteToken)],
        );
      }

      const user = await client.query(`${sessionSelect} WHERE users.id = $1 AND schools.id = $2`, [userId, schoolId]);
      await createSession(response, userId, schoolId, true, client);
      return user.rows[0];
    });
    return response.status(201).json({ user: publicUser(result) });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'users_email_key') {
      return response.status(409).json({ error: 'An account with this email already exists. Log in instead.' });
    }
    throw error;
  }
}));

app.post('/api/auth/login', handleAsync(async (request, response) => {
  const body = request.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || password.length < 1 || password.length > 128) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }

  const result = await database.query(
    `SELECT users.password_salt, users.password_hash, users.id, users.full_name,
      users.email, users.updates, users.created_at, memberships.role,
      schools.id AS school_id, schools.name AS school_name, schools.slug AS school_slug
    FROM users
    JOIN memberships ON memberships.user_id = users.id
    JOIN schools ON schools.id = memberships.school_id
    WHERE users.email = $1
    ORDER BY memberships.created_at ASC
    LIMIT 1`,
    [email],
  );
  const user = result.rows[0];
  if (!user) throw new HttpError(401, 'Email or password is incorrect.');

  const passwordHash = await scryptAsync(password, user.password_salt, 64);
  const storedHash = Buffer.from(user.password_hash, 'hex');
  if (!timingSafeEqual(passwordHash, storedHash)) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }

  await createSession(response, user.id, user.school_id, body.remember === true);
  return response.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', handleAsync(async (request, response) => {
  const token = sessionTokenFrom(request);
  if (token) await database.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
  clearSessionCookie(response);
  return response.status(204).end();
}));

app.get('/api/pilot/students', authenticate, allowRoles('school_admin', 'teacher', 'bursar'), handleAsync(async (request, response) => {
  const result = await withTenant(request, (client) => client.query(`
    SELECT id, full_name AS "fullName", admission_no AS "admissionNo"
    FROM students ORDER BY full_name
  `));
  return response.json({ students: result.rows });
}));

app.post('/api/pilot/students', authenticate, allowRoles('school_admin', 'teacher'), handleAsync(async (request, response) => {
  const body = request.body || {};
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const admissionNo = typeof body.admissionNo === 'string' ? body.admissionNo.trim() : '';
  if (fullName.length < 2 || fullName.length > 120 || admissionNo.length < 1 || admissionNo.length > 40) {
    throw new HttpError(400, 'Enter a student name and admission number within the allowed lengths.');
  }
  try {
    const result = await withTenant(request, (client) => client.query(`
      INSERT INTO students (school_id, full_name, admission_no, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING id, full_name AS "fullName", admission_no AS "admissionNo"
    `, [request.auth.schoolId, fullName, admissionNo, request.auth.userId]));
    return response.status(201).json({ student: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'That admission number is already in use at this school.');
    throw error;
  }
}));

app.get('/api/pilot/attendance', authenticate, allowRoles('school_admin', 'teacher'), handleAsync(async (request, response) => {
  const date = typeof request.query.date === 'string' ? request.query.date : '';
  if (!validDate(date)) {
    throw new HttpError(400, 'Choose a valid attendance date.');
  }
  const result = await withTenant(request, (client) => client.query(`
    SELECT students.id, students.full_name AS "fullName", students.admission_no AS "admissionNo",
      attendance.status, attendance.note
    FROM students
    LEFT JOIN attendance
      ON attendance.student_id = students.id AND attendance.school_id = students.school_id
      AND attendance.attendance_date = $2
    WHERE students.school_id = $1
    ORDER BY students.full_name
  `, [request.auth.schoolId, date]));
  return response.json({ date, students: result.rows });
}));

app.put('/api/pilot/attendance', authenticate, allowRoles('school_admin', 'teacher'), handleAsync(async (request, response) => {
  const { date, entries } = request.body || {};
  if (!validDate(date)
    || new Date(`${date}T00:00:00Z`) > new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) {
    throw new HttpError(400, 'Choose today or an earlier valid attendance date.');
  }
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 500) {
    throw new HttpError(400, 'Submit attendance for between 1 and 500 students.');
  }
  const seenStudents = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.studentId !== 'string' || !attendanceStatuses.has(entry.status)
      || (entry.note !== undefined && (typeof entry.note !== 'string' || entry.note.length > 500))
      || seenStudents.has(entry.studentId)) {
      throw new HttpError(400, 'Check each student attendance status and note before saving.');
    }
    seenStudents.add(entry.studentId);
  }

  await withTenant(request, async (client) => {
    for (const entry of entries) {
      const saved = await client.query(`
        INSERT INTO attendance (school_id, student_id, attendance_date, status, note, recorded_by)
        SELECT $1, students.id, $3, $4, $5, $6
        FROM students WHERE students.id = $2 AND students.school_id = $1
        ON CONFLICT (school_id, student_id, attendance_date)
        DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note,
          recorded_by = EXCLUDED.recorded_by, updated_at = now()
        RETURNING id
      `, [request.auth.schoolId, entry.studentId, date, entry.status, entry.note || '', request.auth.userId]);
      if (!saved.rows[0]) throw new HttpError(400, 'One or more selected students do not belong to this school.');
    }
  });
  return response.json({ saved: entries.length });
}));

app.get('/api/pilot/fees', authenticate, allowRoles('school_admin', 'bursar'), handleAsync(async (request, response) => {
  const result = await withTenant(request, (client) => client.query(`
    SELECT fee_payments.id, students.full_name AS "studentName",
      students.admission_no AS "admissionNo", fee_payments.amount_kes AS amount,
      fee_payments.payment_method AS method, fee_payments.reference,
      fee_payments.note, fee_payments.paid_at AS date
    FROM fee_payments
    JOIN students ON students.id = fee_payments.student_id AND students.school_id = fee_payments.school_id
    WHERE fee_payments.school_id = $1
    ORDER BY fee_payments.paid_at DESC, fee_payments.created_at DESC
    LIMIT 200
  `, [request.auth.schoolId]));
  return response.json({ payments: result.rows });
}));

app.post('/api/pilot/fees', authenticate, allowRoles('school_admin', 'bursar'), handleAsync(async (request, response) => {
  const body = request.body || {};
  const { studentId, method } = body;
  const amount = Number(body.amount);
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const date = typeof body.date === 'string' ? body.date : '';
  if (typeof studentId !== 'string' || !Number.isFinite(amount) || amount <= 0 || amount > 10000000
    || Math.round(amount * 100) !== amount * 100
    || !['cash', 'mpesa_manual', 'other'].includes(method)
    || reference.length > 80 || note.length > 500
    || !validDate(date)
    || new Date(`${date}T00:00:00Z`) > new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) {
    throw new HttpError(400, 'Check the student, amount, payment method, reference, and date.');
  }
  try {
    const result = await withTenant(request, (client) => client.query(`
      INSERT INTO fee_payments (school_id, student_id, amount_kes, payment_method, reference, note, paid_at, recorded_by)
      SELECT $1, students.id, $3, $4, NULLIF($5, ''), $6, $7, $8
      FROM students WHERE students.id = $2 AND students.school_id = $1
      RETURNING id, amount_kes AS amount, payment_method AS method, reference, paid_at AS date
    `, [request.auth.schoolId, studentId, amount, method, reference, note, date, request.auth.userId]));
    if (!result.rows[0]) throw new HttpError(400, 'The selected student does not belong to this school.');
    return response.status(201).json({ payment: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'That payment reference has already been recorded at this school.');
    throw error;
  }
}));

app.get('/api/pilot/members', authenticate, allowRoles('school_admin'), handleAsync(async (request, response) => {
  const result = await database.query(`
    SELECT users.full_name AS "fullName", users.email, memberships.role
    FROM memberships JOIN users ON users.id = memberships.user_id
    WHERE memberships.school_id = $1
    ORDER BY memberships.created_at
  `, [request.auth.schoolId]);
  return response.json({ members: result.rows });
}));

app.post('/api/pilot/invitations', authenticate, allowRoles('school_admin'), handleAsync(async (request, response) => {
  const body = request.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = typeof body.role === 'string' ? body.role : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254 || !invitationRoles.has(role)) {
    throw new HttpError(400, 'Enter a valid email and choose Teacher or Bursar.');
  }
  const existingUser = await database.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (existingUser.rows[0]) {
    throw new HttpError(409, 'This email already has a school account. The pilot supports one school per account.');
  }

  const token = randomBytes(32).toString('base64url');
  try {
    await withTenant(request, (client) => client.query(`
      INSERT INTO school_invitations (token_hash, school_id, email, role, expires_at)
      VALUES ($1, $2, $3, $4, now() + interval '7 days')
      ON CONFLICT (school_id, email) WHERE claimed_at IS NULL
      DO UPDATE SET token_hash = EXCLUDED.token_hash, role = EXCLUDED.role,
        expires_at = EXCLUDED.expires_at
    `, [tokenHash(token), request.auth.schoolId, email, role]));
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'An invitation for this email already exists.');
    throw error;
  }
  return response.status(201).json({ token, email, role });
}));

app.get('/api/pilot/school', authenticate, (request, response) => {
  return response.json({
    school: request.auth.user.school,
    role: request.auth.role,
  });
});

if (process.env.NODE_ENV === 'production') {
  const distPath = join(projectRoot, 'dist');
  app.use(express.static(distPath));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) return next();
    return response.sendFile(join(distPath, 'index.html'));
  });
} else {
  const vite = await createViteServer({
    configFile: false,
    root: projectRoot,
    plugins: [react()],
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.use((error, request, response, _next) => {
  console.error('Request failed:', error);
  if (response.headersSent) return;
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500;
  return response.status(status).json({
    error: status === 500 ? 'The account service could not complete your request.' : error.message,
  });
});

const port = Number(process.env.PORT) || 5173;
httpServer.listen(port, host, () => {
  console.log(`Empower Hope is available at http://localhost:${port}`);
  console.log(`PostgreSQL database: ${new URL(process.env.DATABASE_URL).host}`);
});

function closeServer() {
  httpServer.close(() => {
    database.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
