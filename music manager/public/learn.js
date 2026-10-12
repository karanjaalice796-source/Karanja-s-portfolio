const lessonsState = { lessons: [], user: null, selectedId: null, filter: "All" };
const lessonList = document.querySelector("#lesson-list");
const lessonReader = document.querySelector("#lesson-reader");
const toast = document.querySelector("#learn-toast");

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(notify.timeout);
  notify.timeout = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function renderProgress() {
  const completed = lessonsState.lessons.filter((lesson) => lesson.completed).length;
  const percent = lessonsState.lessons.length ? Math.round(completed / lessonsState.lessons.length * 100) : 0;
  document.querySelector("#progress-count").textContent = `${completed} of ${lessonsState.lessons.length} lessons`;
  document.querySelector("#progress-percent").textContent = `${percent}%`;
  document.querySelector("#progress-fill").style.width = `${percent}%`;
  document.querySelector("#progress-heading").textContent = completed
    ? `${completed} ${completed === 1 ? "good idea" : "good ideas"} down. Keep going.`
    : "A few good ideas, one lesson at a time.";
  document.querySelector("#progress-caption").textContent = lessonsState.user
    ? `Your progress is saved to ${lessonsState.user.email}.`
    : "Sign in to keep your progress wherever you go.";

  const account = document.querySelector("#learn-account");
  account.innerHTML = lessonsState.user
    ? `<span class="learn-greeting">Hi, ${escapeText(lessonsState.user.name)}</span><button class="login-link" id="learn-logout" type="button">Log out</button>`
    : '<a class="login-link" href="/login">Log in</a><a class="signup-link" href="/signup">Sign up <span>↗</span></a>';
  document.querySelector("#learn-logout")?.addEventListener("click", logout);
}

function renderLessons() {
  const filtered = lessonsState.filter === "All"
    ? lessonsState.lessons
    : lessonsState.lessons.filter((lesson) => lesson.category === lessonsState.filter);
  lessonList.innerHTML = filtered.map((lesson, index) => `
    <button class="lesson-item ${lesson.id === lessonsState.selectedId ? "selected" : ""} ${lesson.completed ? "complete" : ""}" data-lesson="${lesson.id}">
      <span class="lesson-number">${lesson.completed ? "✓" : String(lesson.position).padStart(2, "0")}</span>
      <span class="lesson-item-copy"><span class="lesson-category">${escapeText(lesson.category)}</span><strong>${escapeText(lesson.title)}</strong><span class="lesson-item-description">${escapeText(lesson.description)}</span></span>
      <span class="lesson-time">${escapeText(lesson.duration)}</span>
    </button>
  `).join("");
  lessonList.querySelectorAll("[data-lesson]").forEach((button) => button.addEventListener("click", () => {
    lessonsState.selectedId = Number(button.dataset.lesson);
    renderLessons();
    renderSelectedLesson();
  }));
}

function renderSelectedLesson() {
  const lesson = lessonsState.lessons.find((item) => item.id === lessonsState.selectedId);
  if (!lesson) return;
  lessonReader.innerHTML = `
    <div class="reader-topline"><span>${escapeText(lesson.category)}</span><span>${escapeText(lesson.duration)} read</span></div>
    <div class="reader-content">
      <div class="reader-decoration" aria-hidden="true">✳</div>
      <div class="reader-label">LESSON ${String(lesson.position).padStart(2, "0")}</div>
      <h3>${escapeText(lesson.title)}</h3>
      <p class="reader-intro">${escapeText(lesson.description)}</p>
      <div class="reader-rule"></div>
      <div class="lesson-body">${escapeText(lesson.content)}</div>
      <div class="takeaway-card"><span>✦</span><div><strong>TAKE IT WITH YOU</strong><p>${escapeText(lesson.takeaway)}</p></div></div>
      <button class="lesson-complete ${lesson.completed ? "is-complete" : ""}" id="lesson-complete" type="button">
        ${lesson.completed ? "✓ Completed" : "Mark as complete"}${lesson.completed ? "" : '<span>↗</span>'}
      </button>
      ${lessonsState.user ? "" : '<p class="save-progress-note">Your progress will save after you <a href="/signup?next=%2Flearn">create an account</a> or <a href="/login?next=%2Flearn">log in</a>.</p>'}
    </div>
  `;
  document.querySelector("#lesson-complete").addEventListener("click", toggleCompletion);
}

async function toggleCompletion() {
  const lesson = lessonsState.lessons.find((item) => item.id === lessonsState.selectedId);
  if (!lessonsState.user) {
    window.location.href = "/signup?next=%2Flearn";
    return;
  }
  try {
    const result = await api(`/api/lessons/${lesson.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ completed: !lesson.completed })
    });
    lesson.completed = result.completed ? 1 : 0;
    renderProgress();
    renderLessons();
    renderSelectedLesson();
    notify(result.completed ? "Lesson complete — nicely done." : "Lesson moved back to your list.");
  } catch (error) {
    notify(error.message);
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    window.location.reload();
  } catch (error) {
    notify(error.message);
  }
}

document.querySelectorAll(".course-filter").forEach((button) => button.addEventListener("click", () => {
  lessonsState.filter = button.dataset.filter;
  document.querySelectorAll(".course-filter").forEach((item) => item.classList.toggle("active", item === button));
  renderLessons();
}));

async function loadLessons() {
  const data = await api("/api/lessons");
  lessonsState.lessons = data.lessons;
  lessonsState.user = data.user;
  lessonsState.selectedId = data.lessons[0]?.id ?? null;
  renderProgress();
  renderLessons();
  renderSelectedLesson();
}

loadLessons().catch((error) => notify(error.message));
