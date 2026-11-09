# My Portfolio — Alice Karanja

A full-stack developer portfolio built with HTML, CSS, JavaScript, Node.js and Express.

## Run it on your computer
```
npm install
npm start
```
Open http://localhost:3000 (use `npm run dev` to restart automatically on changes).

## Folder map
```
Karanja-s-portfolio/
├── server.js                 Express server, contact API, blog post pages
├── package.json
├── views/index.html          The page (all 7 sections + testimonials + blog)
└── public/
    ├── css/style.css         Dark editorial design, side navigation, light and dark modes
    ├── js/script.js          Theme, menu, filter, GitHub list, form, buttons
    ├── data/testimonials.json   Add real testimonials here
    ├── data/posts.json          Add blog posts here
    ├── images/alice.jpg      Profile photo
    ├── resume.html           Viewable resume
    ├── resume.pdf            Downloadable resume
    ├── portfolio-download.zip Downloadable portfolio source
    ├── favicon.svg, robots.txt, sitemap.xml
```

## Before you publish: your checklist
1. Update `public/resume.html` whenever your resume details change, then regenerate `public/resume.pdf`.
2. In `views/index.html`: replace every `[bracketed note]`, `you@example.com`, `your-username`, `your-profile`, and the `#` project links.
3. In `public/js/script.js`: set `GITHUB_USER` to your GitHub username.
4. Replace the placeholder entries in `public/data/testimonials.json` (real people, with permission) and `posts.json`, or delete them.
5. After buying a domain, replace `your-domain.com` in `index.html`, `robots.txt` and `sitemap.xml`.

## Deploy on Render
Create a Web Service from your GitHub repo. Build command `npm install`, start command `npm start`.
Then add your domain under Settings > Custom Domains.
Note: contact messages are saved to `messages.json`, which can be wiped on Render's free plan.
For messages you can rely on, store them in PostgreSQL or send them to your email.
