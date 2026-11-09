const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/resume', (req, res) => res.sendFile(path.join(__dirname, 'public', 'resume.html')));
app.get('/resume.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'resume.html')));

// Simple rate limit: 5 messages per IP per hour (stops basic spam)
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 3600000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

app.post('/api/contact', (req, res) => {
  const { name, email, subject, message, website } = req.body || {};
  if (website) return res.json({ ok: true }); // honeypot: bots fill this hidden field
  if (limited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many messages. Please try again later.' });

  const errors = [];
  if (!name || name.trim().length < 2) errors.push('Enter your full name.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
  if (!subject || subject.trim().length < 3) errors.push('Enter a subject.');
  if (!message || message.trim().length < 10) errors.push('Message must be at least 10 characters.');
  if (errors.length) return res.status(400).json({ ok: false, error: errors.join(' ') });

  let saved = [];
  try { saved = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); } catch (e) {}
  saved.push({
    name: name.trim().slice(0, 100), email: email.trim().slice(0, 150),
    subject: subject.trim().slice(0, 150), message: message.trim().slice(0, 2000),
    date: new Date().toISOString()
  });
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(saved, null, 2));
  res.json({ ok: true });
});

const esc = t => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

app.get('/blog/:slug', (req, res) => {
  let posts = [];
  try { posts = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data', 'posts.json'), 'utf8')); } catch (e) {}
  const post = posts.find(p => p.slug === req.params.slug);
  if (!post) return res.status(404).send('Post not found');
  const body = post.body.map(block => {
    if (typeof block === 'string') return `<p>${esc(block)}</p>`;
    if (block.type === 'heading') return `<h2>${esc(block.text)}</h2>`;
    if (block.type === 'byline') return `<p class="post-byline">${esc(block.text)}</p>`;
    if (block.type === 'list' && Array.isArray(block.items)) return `<ul>${block.items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
    return `<p>${esc(block.text)}</p>`;
  }).join('');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(post.title)} | Alice Karanja</title><meta name="description" content="${esc(post.summary)}">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css"></head><body>
<header class="top"><div class="in"><a class="name" href="/">ALICE<span>.DEV</span></a><nav style="display:flex;position:static;background:none;box-shadow:none;padding:0;flex-direction:row"><a href="/#blog" style="border:0;width:auto">&larr; All posts</a></nav></div></header>
<main><article class="post-page"><h1>${esc(post.title)}</h1><time datetime="${esc(post.date)}">${esc(post.date)}</time>
${body}</article></main>
<footer><div class="in">&copy; ${new Date().getFullYear()} Alice Karanja</div></footer></body></html>`);
});

app.use((req, res) => res.status(404).send('Page not found'));
app.listen(PORT, () => console.log(`Portfolio running at http://localhost:${PORT}`));
