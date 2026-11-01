const resourceGrid = document.querySelector('#resource-grid');
const searchInput = document.querySelector('#search-input');
const gradeFilter = document.querySelector('#grade-filter');
const filterBar = document.querySelector('#subject-filters');
const savedCount = document.querySelector('#saved-count');
const emptyState = document.querySelector('#empty-state');
const uploadDialog = document.querySelector('#upload-dialog');
const uploadForm = document.querySelector('#upload-form');
const formError = document.querySelector('#form-error');

let resources = [];
let subjectFilter = 'All';
let currentView = 'all';
let savedIds = new Set(JSON.parse(localStorage.getItem('jifunze-saved') || '[]'));

const subjectStyles = {
  Mathematics: ['M', ''], English: ['E', 'orange'], Biology: ['B', 'blue'], Physics: ['P', 'yellow'],
  Chemistry: ['C', 'rose'], History: ['H', 'orange'], Agriculture: ['A', ''], Geography: ['G', 'blue']
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function updateSavedCount() {
  savedCount.textContent = String(savedIds.size);
}

function renderFilters() {
  const subjects = [...new Set(resources.map((resource) => resource.subject))].sort();
  filterBar.innerHTML = `<button class="filter-chip ${subjectFilter === 'All' ? 'is-selected' : ''}" type="button" data-subject="All">All resources</button>` +
    subjects.map((subject) => `<button class="filter-chip ${subjectFilter === subject ? 'is-selected' : ''}" type="button" data-subject="${escapeHtml(subject)}">${escapeHtml(subject)}</button>`).join('');
}

function filteredResources() {
  const query = searchInput.value.trim().toLowerCase();
  return resources.filter((resource) => {
    const matchesSubject = subjectFilter === 'All' || resource.subject === subjectFilter;
    const matchesGrade = gradeFilter.value === 'All' || resource.grade === gradeFilter.value;
    const matchesQuery = !query || [resource.title, resource.subject, resource.grade, resource.kind, resource.description, resource.createdBy]
      .some((field) => String(field).toLowerCase().includes(query));
    const matchesView = currentView === 'all' || (currentView === 'saved'
      ? savedIds.has(resource.id)
      : resource.kind.toLowerCase() === (currentView === 'past papers' ? 'past paper' : currentView));
    return matchesSubject && matchesGrade && matchesQuery && matchesView;
  });
}

function renderResources() {
  const visibleResources = filteredResources();
  resourceGrid.innerHTML = visibleResources.map((resource, index) => {
    const [initial, tone] = subjectStyles[resource.subject] || [resource.subject[0] || 'R', ''];
    const contributorInitials = resource.createdBy.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
    return `<article class="resource-card" style="animation-delay:${Math.min(index * 45, 250)}ms">
      <div class="card-topline"><span class="subject-mark ${tone}">${escapeHtml(initial)}</span><span class="kind-label">${escapeHtml(resource.kind)}</span>
        <button class="save-button ${savedIds.has(resource.id) ? 'is-saved' : ''}" type="button" data-save="${resource.id}" aria-label="${savedIds.has(resource.id) ? 'Remove saved resource' : 'Save resource'}" aria-pressed="${savedIds.has(resource.id)}">${savedIds.has(resource.id) ? '♥' : '♡'}</button>
      </div>
      <h3>${escapeHtml(resource.title)}</h3><p class="description">${escapeHtml(resource.description)}</p>
      <div class="card-meta"><span>${escapeHtml(resource.subject)}</span><span class="meta-dot"></span><span>${escapeHtml(resource.grade)}</span><span class="meta-dot"></span><span>${Number(resource.downloads)} downloads</span></div>
      <div class="card-footer"><span class="contributor"><span class="contributor-avatar">${escapeHtml(contributorInitials)}</span>${escapeHtml(resource.createdBy)}</span>
        <button class="download-button" type="button" data-download="${resource.id}">Download <span aria-hidden="true">↓</span></button></div>
    </article>`;
  }).join('');
  emptyState.hidden = visibleResources.length > 0;
  resourceGrid.hidden = visibleResources.length === 0;
}

async function loadResources() {
  const response = await fetch('/api/schoolportal/resources');
  if (!response.ok) throw new Error('The resource library could not be loaded.');
  resources = await response.json();
  renderFilters();
  renderResources();
}

function showLoadError() {
  resourceGrid.innerHTML = '<div class="loading-state">The library is unavailable right now. Please refresh to try again.</div>';
}

searchInput.addEventListener('input', renderResources);
gradeFilter.addEventListener('change', renderResources);
filterBar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-subject]');
  if (!button) return;
  subjectFilter = button.dataset.subject;
  renderFilters();
  renderResources();
});

document.querySelector('.primary-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  currentView = button.dataset.view;
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('is-active', link === button));
  document.querySelector('#current-view-label').textContent = button.textContent.trim().replace(/\d+$/, '').trim();
  document.querySelector('#library-title').textContent = currentView === 'saved' ? 'Saved for later' : currentView === 'past papers' ? 'Past papers' : 'Explore the library';
  renderResources();
});

resourceGrid.addEventListener('click', async (event) => {
  const saveButton = event.target.closest('[data-save]');
  if (saveButton) {
    const id = Number(saveButton.dataset.save);
    if (savedIds.has(id)) savedIds.delete(id);
    else savedIds.add(id);
    localStorage.setItem('jifunze-saved', JSON.stringify([...savedIds]));
    updateSavedCount();
    renderResources();
    return;
  }

  const downloadButton = event.target.closest('[data-download]');
  if (!downloadButton) return;
  const id = Number(downloadButton.dataset.download);
  downloadButton.disabled = true;
  try {
    const response = await fetch(`/api/schoolportal/resources/${id}/download`);
    if (!response.ok) throw new Error('Could not download this resource.');
    const file = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'study-resource.txt';
    link.click();
    URL.revokeObjectURL(link.href);
    await loadResources();
  } catch (error) {
    window.alert(error.message);
  }
});

document.querySelector('#open-upload').addEventListener('click', () => uploadDialog.showModal());
document.querySelector('#close-upload').addEventListener('click', () => uploadDialog.close());
document.querySelector('#cancel-upload').addEventListener('click', () => uploadDialog.close());
uploadDialog.addEventListener('click', (event) => {
  if (event.target === uploadDialog) uploadDialog.close();
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  const submitButton = uploadForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const resource = Object.fromEntries(new FormData(uploadForm));
  try {
    const response = await fetch('/api/schoolportal/resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resource)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not share this resource.');
    uploadForm.reset();
    uploadDialog.close();
    currentView = 'all';
    document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('is-active', link.dataset.view === 'all'));
    document.querySelector('#current-view-label').textContent = 'School library';
    document.querySelector('#library-title').textContent = 'Library resources';
    await loadResources();
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
});

updateSavedCount();
loadResources().catch(showLoadError);