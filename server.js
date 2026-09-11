const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');

const app = express();
const port = Number(process.env.PORT) || 3000;
const database = new DatabaseSync(path.join(__dirname, 'portfolio.sqlite'));
const providedProfileImageUrl = 'https://lens.usercontent.google.com/image?vsrid=CPaVweGo4ZqQZRACGAEiJGM3MThkMDhkLTQ3MjUtNGI1ZS04ODVmLThmYjAxMDNhZThkMzKAASICZWgoKkJyCi5sZmUtZHVtbXk6MmMzNjI5ZjYtMDUzNy00YzRkLThkMzktNzNjODY4NTE0MzY3EkAKPi9ibnMvZWgvYm9yZy9laC9ibnMvbGVucy1mcm9udGVuZC1hcGkvcHJvZC5sZW5zLWZyb250ZW5kLWFwaS81WgQKAmVoONefo5SH4ZYD&gsessionid=pQel07hyLuW2bqCVEQs1zrqo3iRmmXCcrTNrfFvaZbeCOLXZQQekBQ';

app.use(express.json({ limit: '32kb' }));
app.use(express.static(__dirname));

database.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    year INTEGER NOT NULL,
    description TEXT NOT NULL,
    tag TEXT NOT NULL,
    theme TEXT NOT NULL,
    preview_url TEXT NOT NULL,
    github_url TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Unresolved',
    confirmations INTEGER NOT NULL DEFAULT 1,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    photo_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS fixers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    location TEXT NOT NULL,
    distance TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    phone TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS heroes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    reports INTEGER NOT NULL DEFAULT 0,
    confirmations INTEGER NOT NULL DEFAULT 0,
    solved INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0
  );
`);

const reportCount = database.prepare('SELECT COUNT(*) AS count FROM reports').get().count;
if (reportCount === 0) {
  const insertReport = database.prepare(`
    INSERT INTO reports (title, category, location, severity, status, confirmations, icon, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  [
    ['Streetlight out on River Road', 'Streetlight', 'Ngara, Nairobi', 'Medium', 'Unresolved', 14, 'light', 'yellow'],
    ['Deep pothole beside the market', 'Roads', 'Kawangware, Nairobi', 'High', 'Unresolved', 21, 'road', 'coral'],
    ['Blocked drainage after the rain', 'Drainage', 'Kilimani, Nairobi', 'Critical', 'In progress', 9, 'water', 'blue']
  ].forEach((report) => insertReport.run(...report));
}

const fixerCount = database.prepare('SELECT COUNT(*) AS count FROM fixers').get().count;
if (fixerCount === 0) {
  const insertFixer = database.prepare(`
    INSERT INTO fixers (name, specialty, location, distance, verified, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  [
    ["Mike's Plumbing", 'Water & drainage', 'Ngara, Nairobi', '1.2 km', 1, '+254700000001'],
    ['Eastlands Waste Co.', 'Waste collection', 'Eastlands, Nairobi', '2.4 km', 1, '+254700000002'],
    ['Jirani Electric', 'Streetlights & power', 'Kilimani, Nairobi', '3.1 km', 1, '+254700000003']
  ].forEach((fixer) => insertFixer.run(...fixer));
}

const heroCount = database.prepare('SELECT COUNT(*) AS count FROM heroes').get().count;
if (heroCount === 0) {
  const insertHero = database.prepare(`
    INSERT INTO heroes (name, reports, confirmations, solved, points)
    VALUES (?, ?, ?, ?, ?)
  `);

  [
    ['Alice Karanja', 12, 27, 8, 850],
    ['James Mwangi', 14, 32, 6, 720],
    ['Naomi Wambui', 8, 19, 5, 610]
  ].forEach((hero) => insertHero.run(...hero));
}

const projectCount = database.prepare('SELECT COUNT(*) AS count FROM projects').get().count;
if (projectCount === 0) {
  const insertProject = database.prepare(`
    INSERT INTO projects (number, title, type, year, description, tag, theme, preview_url, github_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  [
    ['01', 'Bakery Website', 'Final project', 2026, 'A warm, inviting bakery experience built as a final web project.', 'HTML', 'coral', 'https://htmlpreview.github.io/?https://github.com/karanjaalice796-source/DI_BOOTCAMP/blob/main/DI-BOOTCAMP%20STAGE%201/Final-Projects/bakery%20project.html', 'https://github.com/karanjaalice796-source/DI_BOOTCAMP/blob/main/DI-BOOTCAMP%20STAGE%201/Final-Projects/bakery%20project.html'],
    ['02', 'Drum Set', 'Mini project', 2026, 'An interactive drum set project that brings rhythm and browser events together.', 'JavaScript', 'yellow', 'https://htmlpreview.github.io/?https://github.com/karanjaalice796-source/FULL-STACK/blob/main/FULL-STACK/WEEK%203/DAY%205/miniproject-drumset.html', 'https://github.com/karanjaalice796-source/FULL-STACK/blob/main/FULL-STACK/WEEK%203/DAY%205/miniproject-drumset.html'],
    ['03', 'Tribute Page', 'Final project', 2026, 'A focused tribute page with a clear visual story and thoughtful layout.', 'HTML + CSS', 'mint', 'https://htmlpreview.github.io/?https://github.com/karanjaalice796-source/DI_BOOTCAMP/blob/main/DI-BOOTCAMP%20STAGE%201/Final-Projects/tribute.html', 'https://github.com/karanjaalice796-source/DI_BOOTCAMP/blob/main/DI-BOOTCAMP%20STAGE%201/Final-Projects/tribute.html']
  ].forEach((project) => insertProject.run(...project));
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/projects', (_request, response) => {
  const projects = database.prepare('SELECT * FROM projects ORDER BY id').all();
  response.json(projects);
});

app.get('/api/profile', (_request, response) => {
  response.json({
    name: 'Alice Karanja',
    role: 'Creative frontend developer',
    bio: 'I design and build playful, purposeful websites for people with something worth saying.',
    about: [
      'Hello! I’m Alice Karanja, an aspiring Web Developer and IT student at Empower Hope, passionate about technology, creativity, and building things that make a difference.',
      'I enjoy turning ideas into beautiful, responsive, and user-friendly websites. My journey in IT has introduced me to technologies such as HTML, CSS, Python, and GitHub, and I’m continuously learning and improving my skills every day.',
      'For me, web development is more than just writing code—it’s about bringing ideas to life. I love experimenting with designs, solving problems, and creating digital experiences that are simple, functional, and visually appealing.'
    ],
    goal: 'To grow into a skilled and innovative web developer who creates meaningful digital solutions while continuing to learn, explore, and push the boundaries of what technology can do.',
    quote: 'I don’t just build websites. I turn ideas into experiences.'
  });
});

app.get('/api/profile-image', (_request, response) => {
  const portfolioHtml = fs.readFileSync(path.join(__dirname, 'portfolio.html'), 'utf8');
  const imageSource = portfolioHtml.match(/<img src="(data:image\/jpeg;base64,[^"]+)"/);

  if (!imageSource) return response.status(404).json({ error: 'Profile image not found.' });
  return response.type('text/plain').send(imageSource[1].replace(/\.jpg$/, ''));
});

app.get('/profile.jpg', (_request, response) => {
  const portfolioHtml = fs.readFileSync(path.join(__dirname, 'portfolio.html'), 'utf8');
  const imageSource = portfolioHtml.match(/<img src="data:image\/jpeg;base64,([^"]+)"/);

  if (!imageSource) return response.sendStatus(404);
  return response.type('image/jpeg').send(Buffer.from(imageSource[1].replace(/\.jpg$/, ''), 'base64'));
});

app.get('/api/profile-image-provided', async (_request, response) => {
  try {
    const imageResponse = await fetch(providedProfileImageUrl);
    if (!imageResponse.ok) return response.sendStatus(imageResponse.status);
    response.type(imageResponse.headers.get('content-type') || 'image/jpeg');
    return response.send(Buffer.from(await imageResponse.arrayBuffer()));
  } catch (_error) {
    return response.sendStatus(502);
  }
});

app.get('/api/skills', (_request, response) => {
  response.json(['HTML', 'CSS', 'Python', 'JavaScript']);
});

app.get('/api/reports', (_request, response) => {
  const reports = database.prepare(`
    SELECT
      id, title, category, location, severity, status, confirmations,
      icon, color, photo_name AS photo, created_at AS createdAt
    FROM reports
    ORDER BY created_at DESC, id DESC
  `).all();

  response.json(reports);
});

app.post('/api/reports', (request, response) => {
  const { category, description, location, photo } = request.body || {};
  const cleanCategory = typeof category === 'string' ? category.trim() : '';
  const cleanDescription = typeof description === 'string' ? description.trim() : '';
  const cleanLocation = typeof location === 'string' ? location.trim() : '';
  const cleanPhoto = typeof photo === 'string' ? photo.trim() : '';
  const categoryData = {
    Streetlight: ['light', 'yellow'],
    Roads: ['road', 'coral'],
    Drainage: ['water', 'blue'],
    Waste: ['waste', 'mint'],
    Water: ['water', 'blue'],
    Safety: ['safety', 'coral']
  };
  const [icon, color] = categoryData[cleanCategory] || ['road', 'coral'];
  const severity = cleanCategory === 'Safety' ? 'High' : 'Medium';

  if (!cleanCategory || !cleanDescription || !cleanLocation) {
    return response.status(400).json({ error: 'Category, description, and location are required.' });
  }

  const result = database.prepare(`
    INSERT INTO reports (title, category, location, severity, status, confirmations, icon, color, photo_name)
    VALUES (?, ?, ?, ?, 'Unresolved', 1, ?, ?, ?)
  `).run(cleanDescription, cleanCategory, cleanLocation, severity, icon, color, cleanPhoto);

  const report = database.prepare(`
    SELECT id, title, category, location, severity, status, confirmations,
      icon, color, photo_name AS photo, created_at AS createdAt
    FROM reports
    WHERE id = ?
  `).get(Number(result.lastInsertRowid));

  return response.status(201).json(report);
});

app.post('/api/reports/:id/confirm', (request, response) => {
  const reportId = Number(request.params.id);
  const report = database.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);

  if (!report) return response.status(404).json({ error: 'Report not found.' });

  const confirmations = report.confirmations + 1;
  database.prepare('UPDATE reports SET confirmations = ? WHERE id = ?').run(confirmations, reportId);

  return response.json({ id: reportId, confirmations, highPriority: confirmations >= 20 });
});

app.patch('/api/reports/:id/status', (request, response) => {
  const reportId = Number(request.params.id);
  const allowedStatuses = ['Unresolved', 'In progress', 'Fixed'];
  const status = typeof request.body?.status === 'string' ? request.body.status.trim() : '';

  if (!allowedStatuses.includes(status)) {
    return response.status(400).json({
      error: `Status must be one of: ${allowedStatuses.join(', ')}.`
    });
  }

  const result = database.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, reportId);
  if (result.changes === 0) return response.status(404).json({ error: 'Report not found.' });

  return response.json({ id: reportId, status });
});

app.get('/api/stats', (_request, response) => {
  const stats = database.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) AS critical,
      SUM(CASE WHEN status = 'Unresolved' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'Fixed' THEN 1 ELSE 0 END) AS fixed,
      SUM(CASE WHEN confirmations >= 20 THEN 1 ELSE 0 END) AS highPriority
    FROM reports
  `).get();
  const activeFixers = database.prepare('SELECT COUNT(*) AS count FROM fixers WHERE verified = 1').get().count;

  response.json({ ...stats, activeFixers });
});

app.get('/api/fixers', (_request, response) => {
  const fixers = database.prepare(`
    SELECT id, name, specialty, location, distance, verified, phone
    FROM fixers
    ORDER BY verified DESC, id
  `).all();

  response.json(fixers);
});

app.get('/api/heroes', (_request, response) => {
  const heroes = database.prepare(`
    SELECT id, name, reports, confirmations, solved, points
    FROM heroes
    ORDER BY points DESC
  `).all();

  response.json(heroes);
});

app.post('/api/messages', (request, response) => {
  const { name, email, message } = request.body || {};
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim() : '';
  const cleanMessage = typeof message === 'string' ? message.trim() : '';

  if (!cleanName || !cleanEmail || !cleanMessage) {
    return response.status(400).json({ error: 'Name, email, and message are required.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return response.status(400).json({ error: 'Please provide a valid email address.' });
  }

  const result = database.prepare(
    'INSERT INTO messages (name, email, message) VALUES (?, ?, ?)'
  ).run(cleanName, cleanEmail, cleanMessage);

  return response.status(201).json({ id: Number(result.lastInsertRowid), message: 'Message received.' });
});

app.listen(port, () => {
  console.log(`Portfolio backend running at http://localhost:${port}`);
});
