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
`);

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
