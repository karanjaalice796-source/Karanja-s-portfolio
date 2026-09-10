document.addEventListener('DOMContentLoaded', () => {
	const menuButton = document.querySelector('.menu-toggle');
	const menu = document.querySelector('#site-menu');
	const menuLinks = document.querySelectorAll('#site-menu a');
	const form = document.querySelector('#contactForm');
	const status = document.querySelector('#formStatus');
	const backToTop = document.querySelector('#backToTop');
	const projectGrid = document.querySelector('#projectGrid');
	const profileRole = document.querySelector('#profileRole');
	const profileBio = document.querySelector('#profileBio');
	const aboutContent = document.querySelector('#aboutContent');
	const skillList = document.querySelector('#skillList');
	const portrait = document.querySelector('.portrait-card img');

	if (portrait && portrait.src.endsWith('.jpg')) {
		portrait.src = portrait.src.slice(0, -4);
		portrait.style.display = 'block';
		portrait.nextElementSibling.style.display = 'none';
	}

	menuButton.addEventListener('click', () => {
		const isOpen = menu.classList.toggle('is-open');
		menuButton.setAttribute('aria-expanded', String(isOpen));
		menuButton.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
		menuButton.classList.toggle('is-open', isOpen);
	});

	menuLinks.forEach((link) => link.addEventListener('click', () => {
		menu.classList.remove('is-open');
		menuButton.classList.remove('is-open');
		menuButton.setAttribute('aria-expanded', 'false');
		menuButton.setAttribute('aria-label', 'Open menu');
	}));

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const submitButton = form.querySelector('button[type="submit"]');
		const formData = Object.fromEntries(new FormData(form));
		submitButton.disabled = true;
		status.textContent = 'Sending...';

		try {
			const response = await fetch('/api/messages', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(formData)
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || 'Unable to send your message.');
			status.textContent = 'Thanks! Your message has been received.';
			form.reset();
		} catch (error) {
			status.textContent = error.message;
		} finally {
			submitButton.disabled = false;
		}
	});

	const updateBackToTop = () => {
		backToTop.classList.toggle('is-visible', window.scrollY > 420);
	};

	window.addEventListener('scroll', updateBackToTop, { passive: true });
	backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
	updateBackToTop();

	const wireProjectCards = () => document.querySelectorAll('.project[data-preview]').forEach((card) => {
		const openPreview = () => window.open(card.dataset.preview, '_blank', 'noopener,noreferrer');

		card.addEventListener('click', (event) => {
			if (!event.target.closest('a')) openPreview();
		});
		card.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				openPreview();
			}
		});
	});

	const renderProjects = (projects) => {
		projectGrid.innerHTML = projects.map((project) => {
			const title = project.title.split(' ');
			const titleMarkup = title.length > 1 ? `${title.slice(0, -1).join(' ')}<br>${title.at(-1)}` : project.title;
			return `<article class="project project--${project.theme}" data-preview="${project.preview_url}" role="button" tabindex="0" aria-label="Open ${project.title} preview"><div class="project-top"><span>${project.number}</span><a href="${project.github_url}" target="_blank" rel="noopener noreferrer" aria-label="View ${project.title} source on GitHub"><i class="fa-brands fa-github" aria-hidden="true"></i></a></div><div><p class="project-type">${project.type} / ${project.year}</p><h3>${titleMarkup}</h3><p class="project-description">${project.description}</p><span class="project-tag">${project.tag}</span></div></article>`;
		}).join('');
		wireProjectCards();
	};

	const renderProfile = (profile) => {
		profileRole.textContent = profile.role;
		profileBio.textContent = profile.bio;
		aboutContent.innerHTML = profile.about.map((paragraph) => `<p>${paragraph}</p>`).join('') + `<p class="goal"><strong>My Goal:</strong> ${profile.goal}</p><blockquote>“${profile.quote}”</blockquote>`;
	};

	const renderSkills = (skills) => {
		skillList.innerHTML = skills.map((skill) => `<span>${skill}</span>`).join('');
	};

	fetch('/api/projects')
		.then((response) => response.json())
		.then(renderProjects)
		.catch(() => { projectGrid.innerHTML = '<p>Projects are temporarily unavailable.</p>'; });

	fetch('/api/profile')
		.then((response) => response.json())
		.then(renderProfile);

	fetch('/api/skills')
		.then((response) => response.json())
		.then(renderSkills);
});
