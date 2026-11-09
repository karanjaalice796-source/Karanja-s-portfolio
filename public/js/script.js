const root = document.documentElement;
document.getElementById('year').textContent = new Date().getFullYear();

// Start with the dark palette; a user's choice is remembered between visits.
const themeButton = document.getElementById('theme');
const updateThemeLabel = () => {
  const nextTheme = root.dataset.theme === 'light' ? 'dark' : 'light';
  themeButton.textContent = nextTheme === 'light' ? 'Light mode' : 'Dark mode';
  themeButton.setAttribute('aria-label', `Switch to ${nextTheme} mode`);
};
updateThemeLabel();
themeButton.addEventListener('click', () => {
  const current = root.dataset.theme || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  updateThemeLabel();
  try { localStorage.setItem('theme', next); } catch (e) {}
});

// Sections fade in as they are scrolled to
const io = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// Keep the side navigation in step with the section currently on screen.
const sectionLinks = [...document.querySelectorAll('#menu a[href^="#"]')];
const sectionObserver = new IntersectionObserver(entries => entries.forEach(entry => {
  if (!entry.isIntersecting) return;
  sectionLinks.forEach(link => {
    if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}), { rootMargin: '-35% 0px -55% 0px' });
document.querySelectorAll('main section[id]').forEach(section => sectionObserver.observe(section));

// GitHub: show the latest public repositories. Change the username below.
const GITHUB_USER = 'your-username';
if (GITHUB_USER !== 'your-username') {
  fetch(`https://api.github.com/users/${GITHUB_USER}/repos?sort=updated&per_page=5`)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(repos => {
      const list = document.getElementById('repos');
      repos.filter(r => !r.fork).slice(0, 4).forEach(r => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = r.html_url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = r.name;
        const small = document.createElement('small');
        small.textContent = [r.language, r.description].filter(Boolean).join(' · ');
        li.append(a, small);
        list.append(li);
      });
      if (list.children.length) document.getElementById('github').hidden = false;
    })
    .catch(() => {});
}

// Contact form: check the fields, send to the server, say what happened
const form = document.getElementById('form');
const status = document.getElementById('status');
form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
  if (!data.name.trim() || !emailOk || !data.subject.trim() || data.message.trim().length < 10) {
    status.className = 'err';
    status.textContent = 'Please fill in every field, with a valid email and a message of at least 10 characters.';
    return;
  }
  status.className = ''; status.textContent = 'Sending...';
  try {
    const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error);
    form.reset();
    status.className = 'ok'; status.textContent = 'Thank you. Your message is in and I will reply soon.';
  } catch (err) {
    status.className = 'err'; status.textContent = err.message || 'Something went wrong. Please try again or email me directly.';
  }
});

// Blog posts come from a simple JSON file in public/data
const make = (tag, text, cls) => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; };

fetch('/data/posts.json').then(r => r.json()).then(posts => {
  const list = document.getElementById('posts');
  posts.forEach(p => {
    const li = document.createElement('li');
    const a = make('a', p.title); a.href = '/blog/' + p.slug;
    const t = make('time', p.date); t.dateTime = p.date;
    li.append(a, t, make('p', p.summary));
    list.append(li);
  });
}).catch(() => document.getElementById('blog').remove());

// Mobile navigation drawer
const burger = document.getElementById('burger');
const menu = document.getElementById('menu');
const menuBackdrop = document.getElementById('menu-backdrop');
const mobileNavigation = window.matchMedia('(max-width: 820px)');
let menuIsOpen = false;

const setMenuOpen = (open, returnFocus = false) => {
  menuIsOpen = open && mobileNavigation.matches;
  menu.classList.toggle('open', menuIsOpen);
  burger.setAttribute('aria-expanded', menuIsOpen);
  burger.setAttribute('aria-label', menuIsOpen ? 'Close navigation' : 'Open navigation');
  burger.querySelector('.burger-label').textContent = menuIsOpen ? 'Close' : 'Menu';
  menuBackdrop.hidden = !menuIsOpen;
  menu.setAttribute('aria-hidden', mobileNavigation.matches && !menuIsOpen);
  menu.inert = mobileNavigation.matches && !menuIsOpen;
  document.body.style.overflow = menuIsOpen ? 'hidden' : '';
  if (menuIsOpen) menu.querySelector('a')?.focus();
  else if (returnFocus) burger.focus();
};

setMenuOpen(false);
burger.addEventListener('click', () => {
  setMenuOpen(!menuIsOpen, menuIsOpen);
});
menuBackdrop.addEventListener('click', () => setMenuOpen(false, true));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuIsOpen) setMenuOpen(false, true);
});
menu.addEventListener('click', event => {
  if (event.target.closest('a')) setMenuOpen(false);
});
mobileNavigation.addEventListener('change', () => {
  setMenuOpen(false);
});

// Back-to-top arrow: appears after scrolling, one click takes you to the top
const toTop = document.getElementById('totop');
window.addEventListener('scroll', () => toTop.classList.toggle('show', window.scrollY > 400), { passive: true });
toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// "Hire me" button floats until the contact section is on screen
const hire = document.getElementById('hire');
new IntersectionObserver(([entry]) => hire.classList.toggle('gone', entry.isIntersecting), { threshold: 0.25 })
  .observe(document.getElementById('contact'));
