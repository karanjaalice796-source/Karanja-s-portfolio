const state = {
  playlists: [],
  tracks: [],
  libraryTracks: [],
  artists: [],
  user: null,
  activePlaylist: null,
  activeTrack: null,
  playing: false,
  listView: true,
  libraryView: "songs",
  sort: "added",
  selectedArtist: null,
  selectedPlaylistId: null,
  selectedPlaylistTracks: []
};

const previewAudio = new Audio();

const elements = {
  sidebar: document.querySelector("#sidebar-playlists"),
  playlistGrid: document.querySelector("#playlist-grid"),
  trackList: document.querySelector("#track-list"),
  libraryContent: document.querySelector("#library-content"),
  search: document.querySelector("#search"),
  promptForm: document.querySelector("#prompt-form"),
  promptInput: document.querySelector("#prompt-input"),
  toast: document.querySelector("#toast"),
  playlistDialog: document.querySelector("#playlist-dialog"),
  uploadForm: document.querySelector("#song-upload-form"),
  uploadInput: document.querySelector("#audio-upload-input"),
  videoInput: document.querySelector("#video-upload-input"),
  video: document.querySelector("#now-video"),
  nowArt: document.querySelector("#now-art")
};

let pendingVideoTrackId = null;
let ignoredAudioPauseEvents = 0;
const palettes = {
  "Deep Focus": ["#263e4d", "#88b5ac"],
  "Slow mornings": ["#714b50", "#e1a273"],
  "Move with it": ["#4b3b6c", "#ca7d72"],
  "After hours": ["#204b50", "#a1bb98"]
};

async function request(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(url, {
    headers: options.headers || (isFormData ? {} : { "Content-Type": "application/json" }),
    ...options
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

function pauseAudio() {
  if (!previewAudio.paused) {
    ignoredAudioPauseEvents += 1;
    previewAudio.pause();
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} min${remainingSeconds ? ` ${remainingSeconds} sec` : ""}`;
}

function renderPlaylists() {
  elements.sidebar.innerHTML = state.playlists.map((playlist) => `
    <a class="side-playlist" href="#library" data-playlist="${playlist.id}">
      <span class="playlist-swatch" style="background:${playlist.color}">♫</span>
      <span>${escapeHtml(playlist.name)}</span>
    </a>
  `).join("");
  elements.playlistGrid.innerHTML = state.playlists.map((playlist, index) => {
    const colors = palettes[playlist.name] || [playlist.color, "#47584c"];
    return `
      <article class="playlist-card" data-playlist="${playlist.id}">
        <div class="cover-art" style="background:radial-gradient(circle at 50% 45%,${colors[1]},${colors[0]} 73%)">
          <span class="cover-letter">RIFF / ${String(index + 1).padStart(2, "0")}</span>
          <span class="cover-shape"></span><span class="cover-stamp">${playlist.mood === "Focus" ? "◌" : playlist.mood === "Energy" ? "✳" : "☾"}</span>
          <button class="card-play" data-playlist-play="${playlist.id}" aria-label="Play ${escapeHtml(playlist.name)}">▶</button>
        </div>
        <div class="playlist-card-body">
          <strong class="playlist-card-title">${playlist.favorite ? '<span class="fav-indicator">♥</span>' : ""}${escapeHtml(playlist.name)}</strong>
          <div class="playlist-card-meta"><span class="mood-tag">${escapeHtml(playlist.mood)} mix</span><span>${playlist.track_count} tracks · ${formatDuration(playlist.duration_seconds || 0)}</span></div>
        </div>
      </article>
    `;
  }).join("");
}

function renderTracks() {
  const search = elements.search.value.trim().toLowerCase();
  const visibleTracks = state.tracks.filter((track) =>
    `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(search)
  );
  if (!visibleTracks.length) {
    elements.trackList.className = "track-table";
    elements.trackList.innerHTML = '<div class="empty-state">No tracks match your search. Try another artist or title.</div>';
    return;
  }
  elements.trackList.className = state.listView ? "track-table" : "track-table track-list-grid";
  elements.trackList.innerHTML = visibleTracks.map((track) => `
    <div class="track-row" data-track="${track.id}">
      <div class="track-info"><div class="track-cover" style="background:${track.cover}">♫</div><div><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist)}</span></div></div>
      <span class="track-album">${escapeHtml(track.album)}</span>
      <span class="track-bpm">${track.bpm} BPM</span>
      <span class="track-time">${escapeHtml(track.duration)}</span>
      <button class="track-more" aria-label="Play ${escapeHtml(track.title)}">···</button>
    </div>
  `).join("");
}

function renderLibrary() {
  document.querySelectorAll("[data-library-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.libraryView === state.libraryView);
  });
  document.querySelector("#library-sort").value = state.sort;
  const allSongs = state.libraryTracks;
  const downloaded = allSongs.filter((track) => track.downloaded);
  document.querySelector("#library-count").textContent = state.libraryView === "downloads"
    ? `${downloaded.length} downloaded`
    : `${allSongs.length} songs`;
  const note = document.querySelector("#library-note");
  note.hidden = state.libraryView !== "downloads" || downloaded.length > 0;

  if (state.libraryView === "playlists") {
    renderLibraryPlaylists();
    return;
  }
  if (state.libraryView === "artists") {
    renderLibraryArtists();
    return;
  }
  const source = state.libraryView === "downloads" ? downloaded : allSongs;
  const query = elements.search.value.trim().toLowerCase();
  const visible = source.filter((track) =>
    (!state.selectedArtist || track.artist.toLowerCase() === state.selectedArtist.toLowerCase()) &&
    `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query)
  );
  if (!visible.length) {
    elements.libraryContent.innerHTML = `<div class="library-empty"><span>${state.libraryView === "downloads" ? "⇧" : "♫"}</span><strong>${state.libraryView === "downloads" ? "Your downloaded songs will live here." : "No songs match this view yet."}</strong><p>${state.libraryView === "downloads" ? "Choose audio files already on your device to add them to your private library." : "Try another search, or add downloaded audio to your library."}</p></div>`;
    return;
  }
  elements.libraryContent.innerHTML = `
    ${state.libraryView === "downloads" ? `<div class="download-library-banner"><div><span class="download-banner-kicker">YOUR OFFLINE MUSIC</span><strong>Take your sound anywhere.</strong><p>Keep songs and their paired videos saved in your private library.</p></div><span class="download-banner-count">${downloaded.length}<small>TRACKS</small></span></div>` : ""}
    <div class="library-list-head"><span>SONG</span><span>ALBUM</span><span>ARTIST</span><span>PLAYS</span><span></span></div>
    <div class="library-song-list">${visible.map((track, index) => `
      <article class="library-song-row" data-library-track="${track.id}">
        <span class="library-song-index">${String(index + 1).padStart(2, "0")}</span>
        <button class="library-artwork" type="button" data-play-track="${track.id}" style="--art-color:${track.downloaded ? "linear-gradient(145deg,#fb5946,#442854)" : paletteForTrack(track)}" aria-label="Play ${escapeHtml(track.title)}">♫<span>▶</span></button>
        <button class="library-song-title" type="button" data-play-track="${track.id}"><strong>${escapeHtml(track.title)}</strong><small>${track.downloaded ? track.has_video ? "OFFLINE AUDIO + VIDEO" : "DOWNLOADED TO YOUR LIBRARY" : escapeHtml(track.mood || "RIFF CURATION")}</small></button>
        <span class="library-album">${escapeHtml(track.album || "Single")}</span>
        <button class="library-artist" type="button" data-artist="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</button>
        <span class="library-play-count">${track.play_count || 0}</span>
        <div class="library-song-actions">
          <select data-playlist-select="${track.id}" aria-label="Choose playlist for ${escapeHtml(track.title)}">
            <option value="">Add to playlist</option>
            ${state.playlists.map((playlist) => `<option value="${playlist.id}">${escapeHtml(playlist.name)}</option>`).join("")}
          </select>
          ${track.downloaded ? `<button class="video-song-button" data-add-video="${track.id}" type="button">${track.has_video ? "Replace video" : "Add video"}</button>${track.has_video ? `<button class="remove-video-button" data-remove-video="${track.id}" type="button" aria-label="Remove video from ${escapeHtml(track.title)}">−</button>` : ""}` : ""}
          ${track.downloaded ? `<button class="remove-song-button" data-remove-track="${track.id}" type="button" aria-label="Remove ${escapeHtml(track.title)} from your library">×</button>` : ""}
        </div>
      </article>
    `).join("")}</div>
  `;
}

function paletteForTrack(track) {
  const colors = ["linear-gradient(145deg,#db634c,#65435b)", "linear-gradient(145deg,#4b607c,#b18067)", "linear-gradient(145deg,#60775d,#c0a565)", "linear-gradient(145deg,#574670,#cb7860)"];
  return colors[(Number(track.id) - 1) % colors.length];
}

function renderLibraryPlaylists() {
  if (!state.playlists.length) {
    elements.libraryContent.innerHTML = '<div class="library-empty"><span>＋</span><strong>Create your first playlist.</strong><p>Start a collection for any mood, moment, or album.</p></div>';
    return;
  }
  elements.libraryContent.innerHTML = `<div class="library-playlist-cards">${state.playlists.map((playlist, index) => `
    <button class="library-playlist-card" data-library-playlist="${playlist.id}" type="button">
      <span class="library-playlist-cover" style="--cover-color:${playlist.color}"><i></i><b>${String(index + 1).padStart(2, "0")}</b><em>♫</em></span>
      <strong>${escapeHtml(playlist.name)}</strong><small>${playlist.track_count} songs · ${escapeHtml(playlist.mood)} mix</small>
    </button>
  `).join("")}</div>`;
}

function renderLibraryArtists() {
  const query = elements.search.value.trim().toLowerCase();
  const artists = state.artists.filter((artist) => artist.artist.toLowerCase().includes(query));
  if (!artists.length) {
    elements.libraryContent.innerHTML = '<div class="library-empty"><span>◉</span><strong>No artists found.</strong><p>Artists appear here as songs are added to your library.</p></div>';
    return;
  }
  elements.libraryContent.innerHTML = `<div class="library-artist-grid">${artists.map((artist, index) => `
    <button class="artist-card" data-artist="${escapeHtml(artist.artist)}" type="button">
      <span class="artist-avatar" style="--artist-color:${paletteForTrack({ id: index + 1 })}"><i>${escapeHtml(artist.artist.slice(0, 1).toUpperCase())}</i></span>
      <strong>${escapeHtml(artist.artist)}</strong><small>${artist.track_count} ${artist.track_count === 1 ? "song" : "songs"}${artist.downloaded_count ? ` · ${artist.downloaded_count} downloaded` : ""}</small>
      <span class="artist-card-play">View songs ↗</span>
    </button>
  `).join("")}</div>`;
}

async function showPlaylistContents(playlistId) {
  state.selectedPlaylistId = Number(playlistId);
  state.libraryView = "playlists";
  state.selectedArtist = null;
  const tracks = await request(`/api/playlists/${playlistId}/tracks`);
  state.selectedPlaylistTracks = tracks;
  const playlist = state.playlists.find((item) => item.id === Number(playlistId));
  document.querySelector("#library-count").textContent = `${tracks.length} songs`;
  document.querySelector("#library-note").hidden = true;
  document.querySelectorAll("[data-library-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.libraryView === "playlists");
  });
  elements.libraryContent.innerHTML = `
    <div class="playlist-detail-heading"><button class="back-to-playlists" data-back-playlists type="button">← All playlists</button><div><strong>${escapeHtml(playlist?.name || "Playlist")}</strong><span>${tracks.length} songs · ${escapeHtml(playlist?.mood || "Mix")}</span></div></div>
    ${tracks.length ? `<div class="library-list-head"><span>SONG</span><span>ALBUM</span><span>ARTIST</span><span>PLAYS</span><span></span></div><div class="library-song-list">${tracks.map((track, index) => `
      <article class="library-song-row" data-library-track="${track.id}">
        <span class="library-song-index">${String(index + 1).padStart(2, "0")}</span>
        <button class="library-artwork" type="button" data-play-track="${track.id}" style="--art-color:${track.downloaded ? "linear-gradient(145deg,#fb5946,#442854)" : paletteForTrack(track)}" aria-label="Play ${escapeHtml(track.title)}">♫<span>▶</span></button>
        <button class="library-song-title" type="button" data-play-track="${track.id}"><strong>${escapeHtml(track.title)}</strong><small>${track.downloaded ? "DOWNLOADED TO YOUR LIBRARY" : escapeHtml(track.mood || "RIFF CURATION")}</small></button>
        <span class="library-album">${escapeHtml(track.album || "Single")}</span>
        <button class="library-artist" type="button" data-artist="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</button>
        <span class="library-play-count">${track.play_count || 0}</span>
        <button class="remove-song-button" data-remove-from-playlist="${track.id}" type="button" aria-label="Remove ${escapeHtml(track.title)} from playlist">×</button>
      </article>
    `).join("")}</div>` : '<div class="library-empty"><span>♫</span><strong>This playlist is waiting for its first song.</strong><p>Choose a song from the Songs tab and add it to this playlist.</p></div>'}
    <div class="add-to-playlist-footer"><button class="back-to-songs" data-back-songs type="button">＋ Add songs from your library</button></div>
  `;
}

function switchLibraryView(view, { resetFilters = true } = {}) {
  state.libraryView = view;
  state.selectedPlaylistId = null;
  if (resetFilters) state.selectedArtist = null;
  renderLibrary();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function loadDashboard() {
  const [dashboard, library, artistData] = await Promise.all([
    request("/api/dashboard"),
    request(`/api/library?sort=${encodeURIComponent(state.sort)}`),
    request("/api/library/artists")
  ]);
  state.playlists = dashboard.playlists;
  state.tracks = dashboard.tracks;
  state.libraryTracks = library.tracks;
  state.artists = artistData.artists;
  state.user = dashboard.user;
  renderPlaylists();
  renderTracks();
  renderLibrary();
  const initialTrack = dashboard.tracks.find((track) => track.title === "Weightless") || dashboard.tracks[0];
  if (initialTrack && !state.activeTrack) setActiveTrack(initialTrack);
}

function setActiveTrack(track) {
  state.activeTrack = track;
  pauseAudio();
  elements.video.pause();
  elements.video.removeAttribute("src");
  elements.video.hidden = !track.video_url;
  elements.nowArt.hidden = Boolean(track.video_url);
  if (track.video_url) {
    elements.video.src = track.video_url;
    elements.video.load();
  }
  previewAudio.removeAttribute("src");
  if (track.audio_url) previewAudio.src = track.audio_url;
  document.querySelector("#now-title").textContent = track.title;
  document.querySelector("#now-artist").textContent = track.artist;
  document.querySelector("#duration-time").textContent = track.duration;
  document.querySelector("#current-time").textContent = "0:00";
  document.querySelector("#now-art").style.background = track.downloaded
    ? "radial-gradient(ellipse at 51% 43%,#e45b48 0%,#36253c 46%,#11192a 85%)"
    : `radial-gradient(ellipse at 51% 43%,${track.cover.match(/#[0-9a-f]{3,8}/i)?.[0] || "#415559"} 0%,#232e31 44%,#182021 85%)`;
  document.querySelector("#progress-fill").style.width = "0%";
  state.playing = false;
  document.querySelector("#play-button").textContent = "▶";
  document.querySelector("#play-button").setAttribute("aria-label", "Play preview");
}

async function selectPlaylist(playlistId) {
  const tracks = await request(`/api/playlists/${playlistId}/tracks`);
  const playlist = state.playlists.find((item) => item.id === Number(playlistId));
  state.activePlaylist = playlistId;
  await showPlaylistContents(playlistId);
  if (tracks.length) {
    setActiveTrack(tracks[0]);
    showToast(`${playlist?.name || "Playlist"} · ${tracks.length} songs`);
  }
}

function playTrack(track) {
  setActiveTrack(track);
  if (!track.downloaded) {
    showToast(`${track.title} is a demo track. Add your own downloaded audio to play it here.`);
    return;
  }
  startPlayback();
}

function startPlayback() {
  previewAudio.play().catch((error) => showToast(`Couldn't play this audio file: ${error.message}`));
}

async function generatePlaylist(prompt, mood) {
  const button = document.querySelector("#generate-button");
  button.disabled = true;
  button.innerHTML = "Finding your sound…";
  const settings = Object.fromEntries([...document.querySelectorAll("[data-setting]")].map((slider) => [slider.dataset.setting, Number(slider.value)]));
  try {
    const result = await request("/api/playlists/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, mood, ...settings })
    });
    await loadDashboard();
    await selectPlaylist(result.playlist.id);
    showToast(`Your new mix “${result.playlist.name}” is ready.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Make me a mix <span>↗</span>';
  }
}

elements.promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = elements.promptInput.value.trim();
  if (!prompt) {
    elements.promptInput.focus();
    showToast("Tell us what kind of music you're in the mood for.");
    return;
  }
  const mood = /workout|energy|run|dance/i.test(prompt) ? "Energy" : /rain|chill|calm|night|mellow|relax/i.test(prompt) ? "Chill" : "Focus";
  generatePlaylist(prompt, mood);
});

elements.videoInput.addEventListener("change", async () => {
  const file = elements.videoInput.files[0];
  const trackId = pendingVideoTrackId;
  pendingVideoTrackId = null;
  if (!file || !trackId) return;
  const body = new FormData();
  body.append("video", file);
  try {
    await request(`/api/library/${trackId}/video`, { method: "POST", body });
    await loadDashboard();
    if (state.activeTrack?.id === trackId) {
      setActiveTrack(state.libraryTracks.find((track) => track.id === trackId));
    }
    showToast(`Video paired with ${state.libraryTracks.find((track) => track.id === trackId)?.title || "your song"}.`);
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll(".preset-pill").forEach((button) => button.addEventListener("click", () => {
  elements.promptInput.value = button.dataset.prompt;
  generatePlaylist(button.dataset.prompt, button.dataset.mood);
}));

elements.search.addEventListener("input", () => {
  renderTracks();
  renderLibrary();
});
document.querySelectorAll("[data-setting]").forEach((slider) => slider.addEventListener("input", () => {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const progress = ((Number(slider.value) - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(90deg,var(--lime) 0 ${progress}%,#414644 ${progress}% 100%)`;
  if (slider.dataset.setting === "bpm") document.querySelector("#bpm-value").textContent = `${slider.value} BPM`;
}));

document.querySelector("#sidebar-playlists").addEventListener("click", async (event) => {
  const link = event.target.closest("[data-playlist]");
  if (link) {
    event.preventDefault();
    await selectPlaylist(link.dataset.playlist);
  }
});

elements.playlistGrid.addEventListener("click", async (event) => {
  const playButton = event.target.closest("[data-playlist-play]");
  const card = event.target.closest(".playlist-card");
  const playlistId = playButton?.dataset.playlistPlay || card?.dataset.playlist;
  if (playlistId) await selectPlaylist(playlistId);
});

elements.trackList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-track]");
  if (!row) return;
  const track = state.tracks.find((item) => item.id === Number(row.dataset.track));
  if (track) {
    playTrack(track);
  }
});

document.querySelector("#play-button").addEventListener("click", () => {
  if (state.activeTrack?.downloaded) {
    if (previewAudio.paused) {
      previewAudio.play().catch((error) => showToast(`Couldn't play this audio file: ${error.message}`));
    } else {
      previewAudio.pause();
    }
    return;
  }
  state.playing = !state.playing;
  document.querySelector("#play-button").textContent = state.playing ? "Ⅱ" : "▶";
  document.querySelector("#play-button").setAttribute("aria-label", state.playing ? "Pause preview" : "Play preview");
  showToast(state.playing ? "Demo track selected. Add a downloaded song to hear audio." : "Demo playback paused.");
});

document.querySelectorAll(".view-button").forEach((button) => button.addEventListener("click", () => {
  state.listView = button.dataset.view === "list";
  document.querySelectorAll(".view-button").forEach((item) => item.classList.toggle("active", item === button));
  renderTracks();
}));

function openPlaylistDialog() {
  if (!state.user) {
    window.location.href = "/login?next=%2F";
    return;
  }
  elements.playlistDialog.showModal();
}

document.querySelector("#new-playlist").addEventListener("click", openPlaylistDialog);
document.querySelector("#new-playlist-inline").addEventListener("click", openPlaylistDialog);
document.querySelector("#close-playlist-dialog").addEventListener("click", () => elements.playlistDialog.close());

document.querySelector("#playlist-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await request("/api/playlists", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#playlist-name").value.trim(),
        description: document.querySelector("#playlist-description").value.trim(),
        mood: document.querySelector("#playlist-mood").value
      })
    });
    elements.playlistDialog.close();
    event.currentTarget.reset();
    await loadDashboard();
    switchLibraryView("playlists");
    showToast(`Playlist “${result.playlist.name}” created. Add songs from your library.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll("[data-library-tab]").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  const view = button.dataset.libraryTab;
  switchLibraryView(view);
  document.querySelector("#music-library").scrollIntoView({ behavior: "smooth", block: "start" });
}));

document.querySelectorAll("[data-library-view]").forEach((button) => button.addEventListener("click", () => {
  switchLibraryView(button.dataset.libraryView);
}));

document.querySelector("#library-sort").addEventListener("change", async (event) => {
  state.sort = event.currentTarget.value;
  try {
    await loadDashboard();
  } catch (error) { showToast(error.message); }
});

elements.libraryContent.addEventListener("click", async (event) => {
  const playButton = event.target.closest("[data-play-track]");
  if (playButton) {
    const track = state.libraryTracks.find((item) => item.id === Number(playButton.dataset.playTrack))
      || state.selectedPlaylistTracks.find((item) => item.id === Number(playButton.dataset.playTrack));
    if (track) {
      playTrack(track);
    }
    return;
  }
  const artistButton = event.target.closest("[data-artist]");
  if (artistButton) {
    state.selectedArtist = artistButton.dataset.artist;
    state.libraryView = "songs";
    renderLibrary();
    document.querySelector("#music-library").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const playlistCard = event.target.closest("[data-library-playlist]");
  if (playlistCard) {
    await showPlaylistContents(playlistCard.dataset.libraryPlaylist);
    return;
  }
  if (event.target.closest("[data-back-playlists]")) {
    state.selectedPlaylistId = null;
    renderLibraryPlaylists();
    return;
  }
  if (event.target.closest("[data-back-songs]")) {
    switchLibraryView("songs");
    return;
  }
  const removeFromPlaylist = event.target.closest("[data-remove-from-playlist]");
  if (removeFromPlaylist && state.selectedPlaylistId) {
    try {
      await request(`/api/playlists/${state.selectedPlaylistId}/tracks/${removeFromPlaylist.dataset.removeFromPlaylist}`, { method: "DELETE" });
      await loadDashboard();
      await showPlaylistContents(state.selectedPlaylistId);
      showToast("Song removed from playlist.");
    } catch (error) { showToast(error.message); }
    return;
  }
  const removeTrack = event.target.closest("[data-remove-track]");
  if (removeTrack && window.confirm("Remove this song and its audio file from your library?")) {
    try {
      await request(`/api/library/${removeTrack.dataset.removeTrack}`, { method: "DELETE" });
      if (state.activeTrack?.id === Number(removeTrack.dataset.removeTrack)) {
        setActiveTrack(state.tracks.find((track) => !track.downloaded) || state.tracks[0]);
      }
      await loadDashboard();
      showToast("Song removed from your library.");
    } catch (error) { showToast(error.message); }
    return;
  }
  const addVideo = event.target.closest("[data-add-video]");
  if (addVideo) {
    if (!state.user) {
      window.location.href = "/login?next=%2F";
      return;
    }
    pendingVideoTrackId = Number(addVideo.dataset.addVideo);
    elements.videoInput.value = "";
    elements.videoInput.click();
    return;
  }
  const removeVideo = event.target.closest("[data-remove-video]");
  if (removeVideo && window.confirm("Remove the paired video from this song?")) {
    const trackId = Number(removeVideo.dataset.removeVideo);
    try {
      await request(`/api/library/${trackId}/video`, { method: "DELETE" });
      await loadDashboard();
      if (state.activeTrack?.id === trackId) {
        setActiveTrack(state.libraryTracks.find((track) => track.id === trackId));
      }
      showToast("Paired video removed.");
    } catch (error) { showToast(error.message); }
  }
});

elements.libraryContent.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-playlist-select]");
  if (!select || !select.value) return;
  if (!state.user) {
    window.location.href = "/login?next=%2F";
    return;
  }
  try {
    await request(`/api/playlists/${select.value}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId: Number(select.dataset.playlistSelect) })
    });
    await loadDashboard();
    showToast("Song added to playlist.");
  } catch (error) {
    showToast(error.message);
  } finally {
    select.value = "";
  }
});

document.querySelector("#upload-songs").addEventListener("click", () => {
  if (!state.user) {
    window.location.href = "/login?next=%2F";
    return;
  }
  switchLibraryView("downloads");
  elements.uploadForm.hidden = false;
  elements.uploadForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  elements.uploadInput.click();
});

elements.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user) {
    window.location.href = "/login?next=%2F";
    return;
  }
  const files = elements.uploadInput.files;
  if (!files.length) {
    showToast("Choose one or more audio files from your device first.");
    return;
  }
  const submit = elements.uploadForm.querySelector('[type="submit"]');
  const body = new FormData(elements.uploadForm);
  submit.disabled = true;
  submit.textContent = "Adding songs…";
  try {
    const result = await request("/api/library/upload", { method: "POST", body });
    elements.uploadForm.reset();
    elements.uploadForm.hidden = true;
    await loadDashboard();
    switchLibraryView("downloads");
    showToast(`${result.count} ${result.count === 1 ? "song" : "songs"} added to your library.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Add to my library <span>↗</span>';
  }
});

previewAudio.addEventListener("loadedmetadata", () => {
  const minutes = Math.floor(previewAudio.duration / 60);
  const seconds = Math.floor(previewAudio.duration % 60).toString().padStart(2, "0");
  document.querySelector("#duration-time").textContent = `${minutes}:${seconds}`;
});

previewAudio.addEventListener("timeupdate", () => {
  const current = previewAudio.currentTime;
  const minutes = Math.floor(current / 60);
  const seconds = Math.floor(current % 60).toString().padStart(2, "0");
  document.querySelector("#current-time").textContent = `${minutes}:${seconds}`;
  const progress = previewAudio.duration ? current / previewAudio.duration * 100 : 0;
  document.querySelector("#progress-fill").style.width = `${progress}%`;
  if (!elements.video.hidden && !elements.video.paused && Number.isFinite(elements.video.duration) && elements.video.duration > 0 && Math.abs(elements.video.currentTime - current) > 1) {
    elements.video.currentTime = current % elements.video.duration;
  }
});

elements.video.addEventListener("loadedmetadata", () => {
  if (!previewAudio.paused) {
    elements.video.play().catch((error) => showToast(`Couldn't play the paired video: ${error.message}`));
  }
});

elements.video.addEventListener("error", () => {
  if (!elements.video.hidden) showToast("Couldn't read this video file. Try adding it to your library again.");
});

previewAudio.addEventListener("play", async () => {
  state.playing = true;
  document.querySelector("#play-button").textContent = "Ⅱ";
  document.querySelector("#play-button").setAttribute("aria-label", "Pause audio");
  if (!elements.video.hidden && elements.video.paused) {
    elements.video.play().catch((error) => showToast(`Couldn't play the paired video: ${error.message}`));
  }
  if (!state.user || !state.activeTrack?.downloaded) return;
  try {
    const result = await request(`/api/library/${state.activeTrack.id}/play`, { method: "POST", body: "{}" });
    state.activeTrack.play_count = result.play_count;
    const libraryTrack = state.libraryTracks.find((track) => track.id === state.activeTrack.id);
    if (libraryTrack) libraryTrack.play_count = result.play_count;
    renderLibrary();
  } catch (error) {
    showToast(error.message);
  }
});

previewAudio.addEventListener("pause", () => {
  if (ignoredAudioPauseEvents) {
    ignoredAudioPauseEvents -= 1;
    return;
  }
  if (!previewAudio.paused) return;
  state.playing = false;
  if (!elements.video.paused) elements.video.pause();
  document.querySelector("#play-button").textContent = "▶";
  document.querySelector("#play-button").setAttribute("aria-label", "Play audio");
});

previewAudio.addEventListener("ended", () => {
  elements.video.pause();
  document.querySelector("#progress-fill").style.width = "0%";
  document.querySelector("#current-time").textContent = "0:00";
});

previewAudio.addEventListener("error", () => {
  if (state.activeTrack?.downloaded) showToast("Couldn't read this audio file. Try adding it to your library again.");
});

document.querySelector("#refresh-button").addEventListener("click", () => {
  document.querySelectorAll("[data-setting]").forEach((slider) => {
    slider.value = slider.dataset.setting === "energy" ? 64 : slider.dataset.setting === "bpm" ? 110 : slider.dataset.setting === "valence" ? 58 : 42;
    slider.dispatchEvent(new Event("input"));
  });
  showToast("Your mood controls are back to today's picks.");
});

document.querySelector("#now-favorite").addEventListener("click", async (event) => {
  const playlist = state.playlists.find((item) => item.name === "Deep Focus");
  if (!playlist) return;
  try {
    const result = await request(`/api/playlists/${playlist.id}/favorite`, { method: "PATCH" });
    event.currentTarget.textContent = result.favorite ? "♥" : "♡";
    await loadDashboard();
    showToast(result.favorite ? "Added Deep Focus to favorites." : "Removed Deep Focus from favorites.");
  } catch (error) { showToast(error.message); }
});

for (const [buttonId, platform] of [["spotify-sync", "Spotify"], ["apple-sync", "Apple Music"]]) {
  document.querySelector(`#${buttonId}`).addEventListener("click", async () => {
    const playlist = state.playlists.find((item) => item.name === "Deep Focus") || state.playlists[0];
    if (!playlist) return;
    try {
      await request(`/api/playlists/${playlist.id}/sync`, {
        method: "POST",
        body: JSON.stringify({ platform })
      });
      showToast(`${playlist.name} is ready to export to ${platform}. Demo mode — connect an account to sync.`);
    } catch (error) { showToast(error.message); }
  });
}

document.querySelectorAll(".service-row").forEach((button) => button.addEventListener("click", () => {
  showToast(`${button.dataset.platform} is in demo mode. Real account connection isn't enabled yet.`);
}));

async function syncAccountNavigation() {
  const response = await fetch("/api/auth/me");
  const result = await response.json();
  if (!result.user) return;
  const accountLink = document.querySelector("#account-link");
  const signupLink = document.querySelector("#signup-link");
  const profileAction = document.querySelector("#profile-action");
  if (result.user) {
    accountLink.textContent = "Log out";
    accountLink.href = "#logout";
    signupLink.hidden = true;
  } else {
    profileAction.addEventListener("click", () => { window.location.href = "/login"; });
  }
  if (!result.user) return;
  document.querySelector("#profile-name").textContent = result.user.name;
  document.querySelector("#profile-caption").textContent = "Your Riff account";
  document.querySelector("#profile-avatar").textContent = result.user.name.slice(0, 1).toUpperCase();
  profileAction.textContent = "↗";
  profileAction.setAttribute("aria-label", "Log out");
  const logout = async (event) => {
    event.preventDefault();
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    window.location.reload();
  };
  accountLink.addEventListener("click", logout);
  profileAction.addEventListener("click", logout);
}

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
});

loadDashboard().catch((error) => showToast(error.message));
syncAccountNavigation().catch((error) => showToast(`Couldn't load account details: ${error.message}`));
