import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import express from 'express';
import react from '@vitejs/plugin-react';
import { createServer as createViteServer } from 'vite';

const scryptAsync = promisify(scrypt);
const projectRoot = dirname(fileURLToPath(import.meta.url));
const databasePath = resolve(process.env.DATABASE_PATH || join(projectRoot, 'data', 'accounts.sqlite'));
const sessionCookieName = 'empower_session';
const sessionDuration = 30 * 24 * 60 * 60;
const allowedRoles = new Set(['Student', 'Teacher', 'Parent or caregiver', 'Community member']);
const secureCookies = process.env.NODE_ENV === 'production';
const host = process.env.HOST || (secureCookies ? '0.0.0.0' : '127.0.0.1');

mkdirSync(dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    updates INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
`);

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
});

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

function userForSession(request) {
  const token = sessionTokenFrom(request);
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const row = database.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash(token), now);

  if (!row) {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    return null;
  }
  return publicUser(row);
}

function createSession(response, userId, remember = true) {
  const token = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (remember ? sessionDuration : 12 * 60 * 60);
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), userId, expiresAt);
  setSessionCookie(response, token, remember);
}

app.get('/api/auth/session', (request, response) => {
  response.json({ user: userForSession(request) });
});

app.post('/api/auth/signup', async (request, response, next) => {
  try {
    const fullName = typeof request.body.name === 'string' ? request.body.name.trim() : '';
    const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body.password === 'string' ? request.body.password : '';
    const role = typeof request.body.role === 'string' ? request.body.role : '';
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

    if (fullName.length < 2 || fullName.length > 120) {
      return response.status(400).json({ error: 'Enter a name between 2 and 120 characters.' });
    }
    if (email.length > 254 || !emailPattern.test(email)) {
      return response.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!allowedRoles.has(role)) {
      return response.status(400).json({ error: 'Select a valid account role.' });
    }
    if (password.length < 8 || password.length > 128) {
      return response.status(400).json({ error: 'Your password must be between 8 and 128 characters.' });
    }

    const salt = randomBytes(16).toString('hex');
    const passwordHash = await scryptAsync(password, salt, 64);
    let result;
    try {
      result = database.prepare(`
        INSERT INTO users (full_name, email, role, password_salt, password_hash, updates)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(fullName, email, role, salt, passwordHash.toString('hex'), request.body.updates === true ? 1 : 0);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return response.status(409).json({ error: 'An account with this email already exists. Log in instead.' });
      }
      throw error;
    }

    const user = database.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    createSession(response, user.id);
    return response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const password = typeof request.body.password === 'string' ? request.body.password : '';
    if (!email || password.length < 1 || password.length > 128) {
      return response.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const user = database.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return response.status(401).json({ error: 'Email or password is incorrect.' });

    const passwordHash = await scryptAsync(password, user.password_salt, 64);
    const storedHash = Buffer.from(user.password_hash, 'hex');
    if (!timingSafeEqual(passwordHash, storedHash)) {
      return response.status(401).json({ error: 'Email or password is incorrect.' });
    }

    createSession(response, user.id, request.body.remember === true);
    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/auth/logout', (request, response, next) => {
  try {
    const token = sessionTokenFrom(request);
    if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    clearSessionCookie(response);
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
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
  console.log(`Account database: ${databasePath}`);
});

function closeServer() {
  httpServer.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
