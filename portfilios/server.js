const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const { createManagerRouter } = require('./manager');

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
  CREATE TABLE IF NOT EXISTS school_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    grade TEXT NOT NULL,
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT NOT NULL,
    downloads INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use('/api/manager', createManagerRouter(database));

const schoolResourceCount = database.prepare('SELECT COUNT(*) AS count FROM school_resources').get().count;
if (schoolResourceCount === 0) {
  const insertSchoolResource = database.prepare(`
    INSERT INTO school_resources (title, subject, grade, kind, description, content, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  [
    ['Fractions made visual', 'Mathematics', 'Grade 7', 'Revision notes', 'A clear guide to equivalent fractions, simplifying, and comparing values.', 'Equivalent fractions have the same value even when their numerators and denominators differ. To simplify a fraction, divide both numbers by their highest common factor.\n\nExample: 12/18 = 2/3 because both numbers divide by 6.\n\nTry it: simplify 15/25, then compare 3/4 and 5/8 by finding a common denominator.', 'Ms. Wanjiku'],
    ['The cell: structure and function', 'Biology', 'Grade 8', 'Study guide', 'Explore the parts of plant and animal cells and what each one does.', 'Cells are the basic units of life. The cell membrane controls what enters and leaves. The cytoplasm is where many reactions happen, and the nucleus contains genetic information.\n\nPlant cells also have a rigid cell wall, chloroplasts for photosynthesis, and a large permanent vacuole.\n\nQuick check: Which cell structure absorbs light energy?', 'Mr. Otieno'],
    ['Kenya: independence and nationhood', 'History', 'Grade 9', 'Past paper', 'Practice source questions on the road to independence in Kenya.', 'SECTION A\n1. State two roles played by political associations in Kenya before 1945.\n2. Name one outcome of the Lancaster House conferences.\n\nSECTION B\nUsing examples, explain three ways the struggle for independence shaped modern Kenya.\n\nAnswer guide: Support each point with a named event, person, or organization.', 'History department'],
    ['Reading for meaning', 'English', 'Grade 6', 'Worksheet', 'Build comprehension skills with a short passage and guided questions.', 'Read a short article from a newspaper or book. As you read, underline unfamiliar words and use the surrounding sentence to infer their meaning.\n\n1. What is the main idea of the passage?\n2. Which detail best supports that idea?\n3. What can you infer about the writer’s point of view?\n4. Summarize the passage in two sentences.', 'Mrs. Achieng'],
    ['Forces and motion', 'Physics', 'Grade 9', 'Revision notes', 'A quick introduction to balanced forces, friction, and acceleration.', 'A force is a push or pull measured in newtons (N). Balanced forces do not change an object’s motion. Unbalanced forces cause acceleration.\n\nFriction acts against movement between surfaces. It can be reduced with lubrication or increased with a rough surface.\n\nRemember: acceleration describes how quickly velocity changes over time.', 'Mr. Kamau'],
    ['Healthy soil, stronger harvests', 'Agriculture', 'Grade 7', 'Study guide', 'Learn how soil structure, water, and organic matter support healthy crops.', 'Healthy soil provides plants with water, nutrients, air, and support. Compost adds organic matter and improves the soil’s ability to hold water.\n\nTo reduce erosion: keep soil covered, plant along contours on slopes, and use grass strips where water flows.\n\nActivity: Compare how quickly water drains through sandy soil and soil mixed with compost.', 'Agriculture club']
  ].forEach((resource) => insertSchoolResource.run(...resource));
}

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

app.get('/api/schoolportal/resources', (_request, response) => {
  const resources = database.prepare(`
    SELECT id, title, subject, grade, kind, description, created_by AS createdBy,
      downloads, created_at AS createdAt
    FROM school_resources
    ORDER BY created_at DESC, id DESC
  `).all();
  response.json(resources);
});

app.post('/api/schoolportal/resources', (request, response) => {
  const fields = ['title', 'subject', 'grade', 'kind', 'description', 'content', 'createdBy'];
  const resource = Object.fromEntries(fields.map((field) => [
    field,
    typeof request.body?.[field] === 'string' ? request.body[field].trim() : ''
  ]));

  if (fields.some((field) => !resource[field])) {
    return response.status(400).json({ error: 'Please complete every field before sharing a resource.' });
  }
  if (resource.content.length > 20000) {
    return response.status(400).json({ error: 'Resource content must be 20,000 characters or fewer.' });
  }

  const result = database.prepare(`
    INSERT INTO school_resources (title, subject, grade, kind, description, content, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(resource.title, resource.subject, resource.grade, resource.kind, resource.description, resource.content, resource.createdBy);

  const created = database.prepare(`
    SELECT id, title, subject, grade, kind, description, created_by AS createdBy,
      downloads, created_at AS createdAt
    FROM school_resources WHERE id = ?
  `).get(Number(result.lastInsertRowid));
  return response.status(201).json(created);
});

app.get('/api/schoolportal/resources/:id/download', (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid resource ID.' });

  const resource = database.prepare('SELECT * FROM school_resources WHERE id = ?').get(id);
  if (!resource) return response.status(404).json({ error: 'Resource not found.' });

  database.prepare('UPDATE school_resources SET downloads = downloads + 1 WHERE id = ?').run(id);
  const safeTitle = resource.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  response.setHeader('Content-Disposition', `attachment; filename="${safeTitle || 'study-resource'}.txt"`);
  return response.type('text/plain').send(`${resource.title}\n${resource.subject} · ${resource.grade} · ${resource.kind}\nShared by ${resource.created_by}\n\n${resource.description}\n\n${resource.content}\n`);
});

app.get('/api/schoolportal/stats', (_request, response) => {
  const stats = database.prepare(`
    SELECT COUNT(*) AS resources, COUNT(DISTINCT subject) AS subjects, COALESCE(SUM(downloads), 0) AS downloads
    FROM school_resources
  `).get();
  response.json(stats);
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
