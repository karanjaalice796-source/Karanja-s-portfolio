import React, { useEffect, useMemo, useState } from 'react';
import { curriculumResources } from './curriculumResources.js';

const starterResources = [
  { id: 'math-fractions', title: 'Fractions made simple', subject: 'Mathematics', grade: 'Grade 6', kind: 'Study guide', description: 'A visual guide to comparing, adding, and simplifying fractions.', createdBy: 'A. Wanjiku', content: 'FRACTIONS MADE SIMPLE\n\nA fraction shows equal parts of a whole. The top number is the numerator; the bottom number is the denominator.\n\nTo compare fractions with the same denominator, compare the numerators. To add fractions with the same denominator, add the numerators and keep the denominator.\n\nExample: 2/8 + 3/8 = 5/8.\n\nPractice: Draw a shape divided into 4 equal parts. Shade 3 parts and write the fraction.' },
  { id: 'english-reading', title: 'Reading for meaning', subject: 'English', grade: 'Grade 7', kind: 'Worksheet', description: 'Short passages and questions for building reading comprehension.', createdBy: 'J. Otieno', content: 'READING FOR MEANING\n\nRead a short story or paragraph twice. First, find out what it is mostly about. Then look for details that explain who, what, where, when, and why.\n\nPRACTICE\n1. What is the main idea of a paragraph you read today?\n2. Which two details support that idea?\n3. Write one question you still have.' },
  { id: 'science-water', title: 'Water and the water cycle', subject: 'Science', grade: 'Grade 8', kind: 'Revision notes', description: 'Learn how water moves through evaporation, condensation, and rainfall.', createdBy: 'M. Njeri', content: 'THE WATER CYCLE\n\nThe sun warms water on Earth and changes some of it into water vapour. This is evaporation. As water vapour cools, it forms tiny droplets in clouds. This is condensation. When droplets become heavy, they fall as precipitation, such as rain.\n\nWater then collects in rivers, lakes, and the ground. The cycle continues.' },
  { id: 'digital-safety', title: 'Staying safe online', subject: 'Digital Skills', grade: 'Grade 6', kind: 'Digital skills', description: 'Simple steps for protecting your personal information and asking for help.', createdBy: 'Digital Learning Team', content: 'STAYING SAFE ONLINE\n\n1. Keep passwords private and difficult to guess.\n2. Do not share your home address, school details, or phone number with strangers online.\n3. Ask a trusted adult before opening an unfamiliar link or downloading a file.\n4. Be kind in messages. Tell a teacher if someone makes you uncomfortable.\n5. Log out when using a shared computer.' },
  { id: 'physics-energy', title: 'Energy in everyday life', subject: 'Physics', grade: 'Grade 9', kind: 'Revision notes', description: 'Explore common forms of energy and how they change from one form to another.', createdBy: 'P. Kamau', content: 'ENERGY IN EVERYDAY LIFE\n\nEnergy is the ability to cause change. Common forms include light, heat, sound, electrical, chemical, and movement energy.\n\nA torch changes chemical energy stored in its battery into electrical energy, then light and heat. A solar panel changes light energy into electrical energy.' },
  { id: 'history-community', title: 'Our community history', subject: 'History', grade: 'Grade 7', kind: 'Project guide', description: 'Interview a community elder and record the story of a local place.', createdBy: 'L. Achieng', content: 'COMMUNITY HISTORY PROJECT\n\nAsk a trusted elder about an important place in your community. Prepare three respectful questions. Write down the answers in your own words, and ask permission before recording or sharing anyone’s story.\n\nInclude: the place name, when it became important, and how it has changed.' },
  { id: 'typing-basics', title: 'Keyboarding practice', subject: 'Digital Skills', grade: 'Grade 6', kind: 'Practice activity', description: 'Build typing confidence with a short daily home-row routine.', createdBy: 'Digital Learning Team', content: 'KEYBOARDING PRACTICE\n\nSit comfortably and place your fingers gently on the home row: left hand on A, S, D, F; right hand on J, K, L, and semicolon.\n\nPractice slowly for five minutes. Keep your eyes on the screen when possible. Accuracy comes before speed.' },
  { id: 'biology-plants', title: 'How plants grow', subject: 'Biology', grade: 'Grade 8', kind: 'Study guide', description: 'A simple introduction to roots, stems, leaves, and what plants need.', createdBy: 'E. Mwangi', content: 'HOW PLANTS GROW\n\nRoots take in water and hold a plant in place. Stems support the plant and move water. Leaves use sunlight, air, and water to make food. This process is called photosynthesis.\n\nObserve a local plant. Draw it and label its roots, stem, and leaves.' },
  { id: 'math-past-paper', title: 'Mathematics practice paper', subject: 'Mathematics', grade: 'Grade 9', kind: 'Past paper', description: 'Practice number patterns, fractions, measurement, and word problems.', createdBy: 'School Teachers', content: 'MATHEMATICS PRACTICE PAPER\n\n1. Simplify 18/24.\n2. A water tank holds 120 litres. How many 15-litre containers can be filled?\n3. Find the next two numbers: 4, 7, 10, 13, __, __.\n4. A garden is 8 m long and 5 m wide. Find its area.\n\nShow your working and check your answers with a teacher.' },
  ...curriculumResources,
];

const subjects = ['All resources', 'Mathematics', 'English', 'Science', 'Biology', 'Physics', 'Chemistry', 'History', 'Geography', 'Agriculture', 'Digital Skills', 'Past papers'];
const navItems = [
  { id: 'all', label: 'Resource library', icon: '▦' },
  { id: 'saved', label: 'Saved for later', icon: '♡' },
  { id: 'past papers', label: 'Past papers', icon: '▤' },
  { id: 'teachers', label: 'Teacher toolkit', icon: '✎' },
  { id: 'students', label: 'Student skills', icon: '✦' },
  { id: 'support', label: 'Device support', icon: '⚙' },
  { id: 'donations', label: 'Needs & donations', icon: '♡' },
];

const translations = {
  English: { resources: 'Resource library', saved: 'Saved for later', past: 'Past papers', teachers: 'Teacher toolkit', students: 'Student skills', support: 'Device support', donations: 'Needs & donations', search: 'Search notes, subjects...', add: 'Add a resource', all: 'All resources' },
  Kiswahili: { resources: 'Maktaba ya rasilimali', saved: 'Zilizohifadhiwa', past: 'Mitihani iliyopita', teachers: 'Zana za walimu', students: 'Ujuzi wa wanafunzi', support: 'Usaidizi wa vifaa', donations: 'Mahitaji na michango', search: 'Tafuta maelezo, masomo...', add: 'Ongeza rasilimali', all: 'Rasilimali zote' },
};

const teacherGuides = [
  {
    title: 'Start with one shared device',
    tag: 'LOW-RESOURCE CLASSROOM',
    text: 'Plan a short rotation: one group uses the device, one works on a printed activity, and one discusses the lesson. Switch groups after 10–15 minutes.',
    action: 'Read the guide',
    sections: [
      { heading: 'Before the lesson', items: ['Choose one task learners can complete on the device in 10–15 minutes.', 'Prepare one related printed activity and one discussion question.', 'Charge the device, open the lesson, and arrange learners into three mixed groups.'] },
      { heading: 'Run three 12-minute rotations', items: ['Device group: explore the lesson, take turns controlling the device, and record one finding.', 'Paper group: solve the printed task together and mark any question for the teacher.', 'Discussion group: explain the topic to one another using examples from class.'] },
      { heading: 'Close together', items: ['Rotate each group through all three activities.', 'Use the final five minutes for each group to share one discovery or question.'] },
    ],
  },
  {
    title: 'Make a lesson work offline',
    tag: 'PEDAGOGY GUIDE',
    text: 'Download materials before class, test them in airplane mode, and keep a printed or spoken alternative ready for every activity.',
    action: 'View checklist',
    sections: [
      { heading: 'Prepare', items: ['Save the reading, worksheet, images, and any audio or video to the device.', 'Charge the device and check that files are stored locally, not only in a browser tab or cloud drive.', 'Print one copy per group, or write down a spoken alternative for each activity.'] },
      { heading: 'Test before class', items: ['Turn on airplane mode and reopen every file.', 'Check that text is readable and media plays without a network connection.', 'If something fails, use the printed or spoken activity and note what needs fixing later.'] },
      { heading: 'During the lesson', items: ['Keep the device with the assigned group and rotate turns fairly.', 'Save learner work on the device or in notebooks so the activity can continue without internet.'] },
    ],
  },
  {
    title: 'A simple lesson plan template',
    tag: 'TEACHER TEMPLATE',
    text: 'Set one learning goal, list the materials available, choose an offline-first activity, and leave time for learners to explain what they discovered.',
    action: 'Use template',
    sections: [
      { heading: 'Plan one lesson', items: ['Keep the goal observable: what will learners be able to explain, solve, or make?', 'Plan a short opening, a learner activity, and a check for understanding.', 'List what is available today, including printed materials and shared devices.'] },
    ],
    template: 'Topic:\nGrade and date:\nLearning goal (By the end, learners can...)\nMaterials available:\nOpening question (5 min):\nMain activity and group roles (20 min):\nOffline or printed alternative:\nCheck for understanding (10 min):\nLearner reflection / next step:',
  },
];

const studentModules = [
  { id: 'computer-basics', title: 'Meet the computer', skill: 'Computer basics', text: 'Learn the parts of a computer and how to use a mouse, touchpad, or shared tablet safely.', minutes: '10 min', icon: '⌨' },
  { id: 'keyboard-skills', title: 'Keyboard explorer', skill: 'Keyboarding', text: 'Practice finding letters, using spaces, and typing a short sentence with care.', minutes: '8 min', icon: '▤' },
  { id: 'internet-safety', title: 'Smart and safe online', skill: 'Internet safety', text: 'Choose what information is safe to share and learn when to ask a trusted adult for help.', minutes: '7 min', icon: '◉' },
];

const deviceGuides = [
  { title: 'The device will not turn on', steps: 'Check the power cable and wall socket. Leave the device charging for 15 minutes, then try again. If it is shared equipment, tell the teacher before opening the case.' },
  { title: 'The internet is slow or unavailable', steps: 'Check whether other devices are affected. Move closer to the router, if safe and permitted. Continue with downloaded or printed materials while the connection is restored.' },
  { title: 'Free, lightweight software', steps: 'LibreOffice for documents and presentations; VLC for audio and video; Kolibri for offline learning libraries; Audacity for recording audio lessons. Ask a teacher before installing software.' },
];

const schoolNeeds = [
  { id: 'tablets', title: 'Shared learning tablets', school: 'Mwangaza Primary School', quantity: '4 devices', detail: 'For offline reading practice and small-group digital literacy lessons.' },
  { id: 'router', title: 'Reliable classroom router', school: 'Riverbend Community School', quantity: '1 router', detail: 'To share existing learning resources across the classroom.' },
  { id: 'headphones', title: 'Headphones for audio lessons', school: 'Hillview Learning Centre', quantity: '10 pairs', detail: 'Help learners listen to recorded literacy and language lessons.' },
];

function readStored(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    console.error(`Could not read ${key} from local storage.`, error);
    return fallback;
  }
}

function loadResources() {
  const storedResources = readStored('empower-resources', []);
  const stored = Array.isArray(storedResources) ? storedResources : [];
  return [...new Map([...starterResources, ...stored].map((resource) => [resource.id, resource])).values()];
}

function App() {
  const [resources, setResources] = useState(loadResources);
  const [savedIds, setSavedIds] = useState(() => new Set(readStored('empower-saved', [])));
  const [completedModules, setCompletedModules] = useState(() => new Set(readStored('empower-completed', [])));
  const [offers, setOffers] = useState(() => new Set(readStored('empower-offers', [])));
  const [currentView, setCurrentView] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('All');
  const [gradeFilter, setGradeFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeResource, setActiveResource] = useState(null);
  const [formError, setFormError] = useState('');
  const [language, setLanguage] = useState('English');
  const [liteMode, setLiteMode] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [textSize, setTextSize] = useState('normal');
  const [openGuide, setOpenGuide] = useState(null);
  const t = translations[language];

  useEffect(() => {
    function focusSearch(event) {
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        document.querySelector('.search-box input')?.focus();
      }
    }
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  const visibleResources = useMemo(() => resources.filter((resource) => {
    const matchesSubject = subjectFilter === 'All'
      || (subjectFilter === 'Past papers' ? resource.kind.toLowerCase() === 'past paper' : resource.subject === subjectFilter);
    const matchesGrade = gradeFilter === 'All' || resource.grade === gradeFilter;
    const text = [resource.title, resource.subject, resource.grade, resource.kind, resource.description, resource.createdBy].join(' ').toLowerCase();
    const matchesQuery = !query.trim() || text.includes(query.trim().toLowerCase());
    const matchesView = currentView === 'all' || (currentView === 'saved'
      ? savedIds.has(resource.id)
      : currentView === 'past papers' && resource.kind.toLowerCase() === 'past paper');
    return matchesSubject && matchesGrade && matchesQuery && matchesView;
  }), [resources, subjectFilter, gradeFilter, query, currentView, savedIds]);

  const persist = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Could not save ${key} to local storage.`, error);
    }
  };

  function toggleSaved(id) {
    const next = new Set(savedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSavedIds(next);
    persist('empower-saved', [...next]);
  }

  function addResource(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const resource = Object.fromEntries(formData.entries());
    const next = [{ ...resource, id: `shared-${Date.now()}`, kind: resource.kind, content: resource.content }, ...resources];
    setResources(next);
    persist('empower-resources', next);
    setCurrentView('all');
    setSubjectFilter('All');
    setDialogOpen(false);
    setFormError('');
    event.currentTarget.reset();
  }

  function toggleModule(id) {
    const next = new Set(completedModules);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCompletedModules(next);
    persist('empower-completed', [...next]);
  }

  function offerSupport(id) {
    const next = new Set(offers);
    next.add(id);
    setOffers(next);
    persist('empower-offers', [...next]);
  }

  const isLibrary = ['all', 'saved', 'past papers'].includes(currentView);
  const activeLabel = navItems.find((item) => item.id === currentView)?.label || 'Resource library';
  const pageTitle = currentView === 'saved' ? t.saved : currentView === 'past papers' ? t.past : isLibrary ? t.resources : activeLabel;

  return (
    <div className={`app-shell ${liteMode ? 'lite-mode' : ''} ${highContrast ? 'high-contrast' : ''} text-${textSize}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#home" onClick={() => setCurrentView('all')} aria-label="Empower Hope learning portal home">
          <span className="brand-mark">EH</span>
          <span className="brand-name">Empower Hope<small>LEARNING PORTAL</small></span>
        </a>
        <p className="nav-label">LEARN & CONNECT</p>
        <nav className="primary-nav">
          {navItems.map((item) => (
            <button className={`nav-link ${currentView === item.id ? 'is-active' : ''}`} data-view={item.id} key={item.id} onClick={() => { setCurrentView(item.id); setSubjectFilter('All'); }} type="button">
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>{t[item.id === 'all' ? 'resources' : item.id === 'past papers' ? 'past' : item.id] || item.label}
              {item.id === 'saved' && <span className="nav-count">{savedIds.size}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">Learning resources and practical digital skills, made for every school.</div>
        <div className="offline-note"><span className="offline-dot" aria-hidden="true"></span><span><strong>Offline-friendly</strong><small>Save lessons to use later</small></span></div>
      </aside>

      <main className="main-content" id="home">
        <header className="topbar">
          <div className="breadcrumbs"><span>Empower Hope</span><span className="crumb-divider">/</span><strong>{pageTitle}</strong></div>
          <div className="accessibility-controls" aria-label="Accessibility and display options">
            <label className="compact-select"><span className="sr-only">Language</span><select aria-label="Choose language" value={language} onChange={(event) => setLanguage(event.target.value)}><option>English</option><option>Kiswahili</option></select></label>
            <button className={`utility-button ${liteMode ? 'utility-active' : ''}`} type="button" onClick={() => setLiteMode(!liteMode)} aria-pressed={liteMode}>Lite mode</button>
            <button className={`utility-button ${highContrast ? 'utility-active' : ''}`} type="button" onClick={() => setHighContrast(!highContrast)} aria-pressed={highContrast} aria-label="Toggle high contrast">◐</button>
            <label className="compact-select size-select"><span className="sr-only">Text size</span><select aria-label="Choose text size" value={textSize} onChange={(event) => setTextSize(event.target.value)}><option value="normal">A</option><option value="large">A+</option><option value="larger">A++</option></select></label>
          </div>
        </header>

        <div className="page-wrap">
          <section className="library-hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="hero-kicker">EMPOWER HOPE · LEARN WITHOUT LIMITS</p>
              <h1 id="hero-title">{isLibrary ? <>Find a resource<br />for class.</> : <>Learn, teach,<br />and grow together.</>}</h1>
              <p>Open learning materials, digital skills, and practical support for every school community.</p>
            </div>
            <button className="share-button" id="open-upload" type="button" onClick={() => { setDialogOpen(true); setFormError(''); }}><span aria-hidden="true">＋</span>{t.add}</button>
          </section>

          <section className="impact-strip" aria-label="Portal impact">
            <div className="impact-intro"><span className="impact-icon" aria-hidden="true">✦</span><span><strong>Learning belongs to everyone</strong><small>Free resources, ready for connected or offline classrooms.</small></span></div>
            <div className="impact-metrics"><div><strong>{resources.length}</strong><small>resources</small></div><div><strong>{completedModules.size}/{studentModules.length}</strong><small>skills explored</small></div><div><strong>Free</strong><small>always</small></div></div>
          </section>

          {isLibrary && (
            <section className="library-section" aria-labelledby="library-title">
              <div className="section-heading">
                <div><p className="eyebrow">BROWSE BY SUBJECT OR GRADE</p><h2 id="library-title">{pageTitle}</h2></div>
                <label className="search-box"><span aria-hidden="true">⌕</span><input type="search" placeholder={t.search} aria-label="Search resources" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>/</kbd></label>
              </div>
              <div className="filter-row">
                <div className="subject-filters" aria-label="Filter by subject">
                  {subjects.map((subject) => {
                    const value = subject === 'All resources' ? 'All' : subject === 'Past papers' ? 'Past papers' : subject;
                    return <button className={`filter-chip ${subjectFilter === value ? 'is-selected' : ''}`} key={subject} type="button" onClick={() => { setSubjectFilter(value); if (value === 'Past papers') setCurrentView('past papers'); else if (currentView === 'past papers') setCurrentView('all'); }}>{subject === 'All resources' ? t.all : subject}</button>;
                  })}
                </div>
                <label className="grade-select"><span className="sr-only">Filter by grade</span><select value={gradeFilter} onChange={(event) => setGradeFilter(event.target.value)}><option value="All">All grades</option>{['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'].map((grade) => <option key={grade}>{grade}</option>)}</select></label>
              </div>
              {visibleResources.length ? (
                <div className="resource-grid" aria-live="polite">{visibleResources.map((resource, index) => {
                  const initial = resource.subject?.[0] || 'R';
                  const contributorInitials = (resource.createdBy || 'School').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
                  return <article className="resource-card" key={resource.id} style={{ animationDelay: `${Math.min(index * 45, 250)}ms` }}>
                    <div className="card-topline"><span className="subject-mark">{initial}</span><span className="kind-label">{resource.kind}</span><button className={`save-button ${savedIds.has(resource.id) ? 'is-saved' : ''}`} type="button" onClick={() => toggleSaved(resource.id)} aria-label={savedIds.has(resource.id) ? 'Remove saved resource' : 'Save resource'} aria-pressed={savedIds.has(resource.id)}>{savedIds.has(resource.id) ? '♥' : '♡'}</button></div>
                    <h3><button className="resource-title-button" type="button" onClick={() => setActiveResource(resource)}>{resource.title}</button></h3><p className="description">{resource.description}</p>
                    <div className="card-meta"><span>{resource.subject}</span><span className="meta-dot"></span><span>{resource.grade}</span><span className="meta-dot"></span><span>Offline-ready</span></div>
                    <div className="card-footer"><span className="contributor"><span className="contributor-avatar">{contributorInitials}</span>{resource.createdBy}</span><button className="resource-open-button" type="button" onClick={() => setActiveResource(resource)}>Open resource <span aria-hidden="true">→</span></button></div>
                  </article>;
                })}</div>
              ) : <p className="empty-state">No resources match this view. Try another subject or search.</p>}
            </section>
          )}

          {currentView === 'teachers' && <section className="content-section"><div className="section-heading"><div><p className="eyebrow">PRACTICAL SUPPORT FOR EDUCATORS</p><h2>Teacher training & support</h2></div></div><p className="section-intro">Short, adaptable guides for bringing learning technology into low-resource classrooms.</p><div className="feature-grid">{teacherGuides.map((guide) => <article className="feature-card" key={guide.title}><span className="feature-icon" aria-hidden="true">✎</span><p className="eyebrow">{guide.tag}</p><h3>{guide.title}</h3><p>{guide.text}</p><button className="text-action" type="button" aria-expanded={openGuide === guide.title} onClick={() => setOpenGuide(openGuide === guide.title ? null : guide.title)}>{openGuide === guide.title ? 'Close guide' : guide.action} <span aria-hidden="true">↗</span></button>{openGuide === guide.title && <div className="guide-detail">{guide.sections.map((section) => <div className="guide-detail-section" key={section.heading}><strong>{section.heading}</strong><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}{guide.template && <pre className="lesson-plan-template">{guide.template}</pre>}</div>}</article>)}</div><div className="community-card"><span className="community-icon" aria-hidden="true">◎</span><div><h3>Learn with other teachers</h3><p>Start a peer learning circle at your school. Meet regularly to exchange lesson ideas, troubleshoot devices, and celebrate progress.</p></div><a className="text-action" href="mailto:community@empowerhope.example?subject=Teacher%20peer%20community">Connect by email ↗</a></div></section>}

          {currentView === 'students' && <section className="content-section"><div className="section-heading"><div><p className="eyebrow">YOUR DIGITAL LITERACY PATH</p><h2>Build skills, one step at a time</h2></div><span className="progress-pill">{completedModules.size} of {studentModules.length} completed</span></div><p className="section-intro">Explore short lessons in computer basics, keyboarding, and staying safe online. Your progress is saved on this device.</p><div className="feature-grid">{studentModules.map((module, index) => <article className="feature-card module-card" key={module.id}><div className="module-topline"><span className="feature-icon" aria-hidden="true">{module.icon}</span><span className="module-number">0{index + 1} · {module.minutes}</span></div><p className="eyebrow">{module.skill}</p><h3>{module.title}</h3><p>{module.text}</p><button className={`module-action ${completedModules.has(module.id) ? 'is-complete' : ''}`} type="button" aria-pressed={completedModules.has(module.id)} onClick={() => toggleModule(module.id)}>{completedModules.has(module.id) ? '✓ Completed · mark to revisit' : 'Start this module →'}</button></article>)}</div><div className="challenge-card"><span className="challenge-symbol" aria-hidden="true">✦</span><div><p className="eyebrow">OFFLINE PROJECT CHALLENGE</p><h3>Make a community helpful guide</h3><p>Write or draw five steps that help someone use a shared device safely. Share your guide with your class.</p></div></div></section>}

          {currentView === 'support' && <section className="content-section"><div className="section-heading"><div><p className="eyebrow">KEEP YOUR CLASSROOM CONNECTED</p><h2>Hardware & software support</h2></div></div><p className="section-intro">Plain-language troubleshooting and free tools that can work well on older devices.</p><div className="support-list">{deviceGuides.map((guide) => <article className="support-item" key={guide.title}><button type="button" aria-expanded={openGuide === guide.title} onClick={() => setOpenGuide(openGuide === guide.title ? null : guide.title)}><span className="support-mark" aria-hidden="true">＋</span><span>{guide.title}</span><span className="support-caret">{openGuide === guide.title ? '−' : '⌄'}</span></button>{openGuide === guide.title && <p>{guide.steps}</p>}</article>)}</div><div className="community-card"><span className="community-icon" aria-hidden="true">↗</span><div><h3>Free and open learning platforms</h3><p>Explore trusted open educational resources, then download materials before class when possible.</p></div><div className="oer-links"><a href="https://www.oercommons.org/" target="_blank" rel="noreferrer">OER Commons ↗</a><a href="https://www.khanacademy.org/" target="_blank" rel="noreferrer">Khan Academy ↗</a><a href="https://learningequality.org/kolibri/" target="_blank" rel="noreferrer">Kolibri ↗</a></div></div></section>}

          {currentView === 'donations' && <section className="content-section"><div className="section-heading"><div><p className="eyebrow">CONNECT SCHOOLS AND SUPPORTERS</p><h2>Community needs & donations</h2></div></div><p className="section-intro">Schools can share practical technology needs. Supporters can register interest and coordinate directly with the school.</p><div className="feature-grid">{schoolNeeds.map((need) => <article className="feature-card need-card" key={need.id}><span className="need-quantity">{need.quantity}</span><p className="eyebrow">{need.school}</p><h3>{need.title}</h3><p>{need.detail}</p><button className={`module-action ${offers.has(need.id) ? 'is-complete' : ''}`} type="button" onClick={() => offerSupport(need.id)} disabled={offers.has(need.id)}>{offers.has(need.id) ? '✓ Interest recorded on this device' : 'I can offer support →'}</button></article>)}</div><p className="support-note">This demo records interest on your device only. Please contact the school directly to arrange any donation.</p></section>}

          <footer className="page-footer"><span>Questions about a resource? Ask your teacher.</span><span>Empower Hope · Learning for every community</span></footer>
        </div>
      </main>

      {activeResource && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveResource(null); }}><section className="upload-dialog resource-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-dialog-title"><div className="dialog-heading"><div><p className="eyebrow">{activeResource.subject} · {activeResource.grade} · {activeResource.kind}</p><h2 id="resource-dialog-title">{activeResource.title}</h2></div><button className="dialog-close" type="button" onClick={() => setActiveResource(null)} aria-label="Close resource" autoFocus>×</button></div><p className="dialog-intro">{activeResource.description}</p><div className="resource-reading">{activeResource.content || 'Ask your teacher for the lesson content.'}</div><div className="dialog-actions"><button className="cancel-button" type="button" onClick={() => setActiveResource(null)}>Close</button></div></section></div>}

      {dialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}><section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><form onSubmit={addResource}><div className="dialog-heading"><div><p className="eyebrow">COMMUNITY CONTRIBUTION</p><h2 id="dialog-title">Share a resource</h2></div><button className="dialog-close" type="button" onClick={() => setDialogOpen(false)} aria-label="Close dialog">×</button></div><p className="dialog-intro">Add notes, a revision guide, or practice questions for everyone to use.</p><label className="form-field">Resource title<input name="title" required maxLength="120" placeholder="e.g. Algebra revision notes" /></label><div className="form-split"><label className="form-field">Subject<select name="subject" required defaultValue=""><option value="" disabled>Choose subject</option>{['Mathematics', 'English', 'Biology', 'Physics', 'Chemistry', 'History', 'Agriculture', 'Geography', 'Science', 'Digital Skills'].map((subject) => <option key={subject}>{subject}</option>)}</select></label><label className="form-field">Grade<select name="grade" required defaultValue=""><option value="" disabled>Choose grade</option>{['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9'].map((grade) => <option key={grade}>{grade}</option>)}</select></label></div><label className="form-field">Resource type<select name="kind" required defaultValue=""><option value="" disabled>Choose type</option>{['Revision notes', 'Study guide', 'Past paper', 'Worksheet', 'Digital skills'].map((kind) => <option key={kind}>{kind}</option>)}</select></label><label className="form-field">Short description<input name="description" required maxLength="180" placeholder="What will students learn?" /></label><label className="form-field">Resource content<textarea name="content" required maxLength="20000" rows="5" placeholder="Write or paste the study material here..." /><small>Text resources can be downloaded and used offline.</small></label><label className="form-field">Your name<input name="createdBy" required maxLength="80" placeholder="Teacher or contributor name" /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="dialog-actions"><button className="cancel-button" type="button" onClick={() => setDialogOpen(false)}>Cancel</button><button className="submit-button" type="submit">Share with students <span aria-hidden="true">↗</span></button></div></form></section></div>}
    </div>
  );
}

export default App;
