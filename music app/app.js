/* ReelTune: create offline video-and-song mixes and play demo tracks. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const audio = $('#a');
  const video = $('#v');
  const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const formatTime = seconds => Number.isFinite(seconds) && seconds > 0
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
    : '0:00';
  const formatSize = bytes => bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB`
      : bytes >= 1e3 ? `${Math.round(bytes / 1e3)} KB` : `${Math.max(0, Math.round(bytes))} B`;

  const icons = {
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
    search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-3.5-3.5',
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    library: 'M4 6h16M4 12h16M4 18h10',
    plus: 'M12 5v14M5 12h14',
    down: 'M6 9l6 6 6-6',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
    check: 'M12 3a9 9 0 100 18 9 9 0 000-18zM8 12l3 3 5-6',
    repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3',
    heart: 'M12 20s-7.5-4.6-9.5-9.2C1.2 7.8 3 4.5 6.5 4.5c2 0 3.7 1.1 5.5 3 1.8-1.9 3.5-3 5.5-3 3.5 0 5.3 3.3 4 6.3C19.5 15.4 12 20 12 20z',
    play: 'M7 4.5v15L20 12z',
    pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
    prev: 'M18 5v14L8 12zM6 5h2v14H6z',
    next: 'M6 5v14l10-7zM16 5h2v14h-2z'
  };
  const icon = name => `<svg class="ic${['play', 'pause', 'prev', 'next'].includes(name) ? ' f' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.play}"/></svg>`;
  document.querySelectorAll('[data-ic]').forEach(el => { el.innerHTML = icon(el.dataset.ic); });

  let toastTimer;
  function toast(message) {
    const target = $('#toast');
    target.textContent = message;
    target.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => target.classList.remove('show'), 3200);
  }

  const memory = { files: new Map(), mixes: new Map() };
  let memoryMode = !window.indexedDB;
  let storageWarningShown = false;
  function warnMemoryStorage() {
    if (storageWarningShown) return;
    storageWarningShown = true;
    toast('Offline storage is unavailable. Changes will last only until this tab closes.');
  }
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('reeltune', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('mixes')) db.createObjectStore('mixes', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open offline storage.'));
    });
  }
  let databasePromise;
  async function dbOperation(store, mode, operation, fallback) {
    if (memoryMode) {
      warnMemoryStorage();
      return fallback(memory[store]);
    }
    try {
      databasePromise ||= openDatabase();
      const db = await databasePromise;
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = operation(transaction.objectStore(store));
        let result;
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => reject(request.error || new Error('Offline storage request failed.'));
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Offline storage transaction failed.'));
      });
    } catch (error) {
      memoryMode = true;
      databasePromise = undefined;
      warnMemoryStorage();
      if (fallback) return fallback(memory[store]);
      throw error;
    }
  }
  const db = {
    get temporary() { return memoryMode; },
    get: (store, key) => dbOperation(store, 'readonly', objectStore => objectStore.get(key), values => values.get(key)),
    all: store => dbOperation(store, 'readonly', objectStore => objectStore.getAll(), values => [...values.values()]),
    put: (store, value) => dbOperation(store, 'readwrite', objectStore => objectStore.put(value), values => values.set(value.id, value)),
    delete: (store, key) => dbOperation(store, 'readwrite', objectStore => objectStore.delete(key), values => values.delete(key))
  };

  function makeDemoAudio(frequency, seconds = 8) {
    const sampleRate = 16000;
    const samples = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const writeText = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    writeText(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, samples * 2, true);
    for (let index = 0; index < samples; index++) {
      const time = index / sampleRate;
      const note = Math.floor(time * 2) % 4;
      const tone = frequency * [1, 1.25, 1.5, 2][note];
      const envelope = Math.min(1, (time % 0.5) * 22) * Math.max(0.12, 1 - (time % 0.5));
      const sample = Math.sin(2 * Math.PI * tone * time) * envelope * 0.42;
      view.setInt16(44 + index * 2, sample * 32767, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }
  const demos = [
    { id: 'demo-sunrise', title: 'Sunrise Loop', artist: 'ReelTune Demo', hue: 34, blob: makeDemoAudio(220) },
    { id: 'demo-night', title: 'Night Drive', artist: 'ReelTune Demo', hue: 222, blob: makeDemoAudio(165) },
    { id: 'demo-tide', title: 'Slow Tide', artist: 'ReelTune Demo', hue: 174, blob: makeDemoAudio(196) }
  ].map(track => ({ ...track, demo: true, dur: 8, size: track.blob.size, downloaded: false }));

  function readJSON(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }
  const state = {
    items: [],
    tab: 'home',
    current: null,
    query: '',
    filter: 'foryou',
    loop: false,
    urls: [],
    favorites: new Set(Array.isArray(readJSON('rt:favs', [])) ? readJSON('rt:favs', []) : []),
    history: Array.isArray(readJSON('rt:hist', [])) ? readJSON('rt:hist', []) : []
  };
  function savePreferences() {
    try {
      localStorage.setItem('rt:favs', JSON.stringify([...state.favorites]));
      localStorage.setItem('rt:hist', JSON.stringify(state.history.slice(0, 20)));
    } catch {
      toast('Browser storage is unavailable; favorites may not be kept.');
    }
  }
  const findItem = id => state.items.find(track => track.id === id);
  function artStyle(track) {
    const color = track.hue ?? Math.abs([...track.title].reduce((total, char) => total * 31 + char.charCodeAt(0), 7)) % 360;
    return track.thumb
      ? `background-image:url("${track.thumb}")`
      : `background:linear-gradient(135deg,hsl(${color} 70% 52%),hsl(${(color + 65) % 360} 60% 22%))`;
  }
  async function loadItems() {
    const records = await db.all('mixes');
    const stored = new Map(records.map(record => [record.id, record]));
    const mixes = records.filter(record => !record.demo).sort((first, second) => (second.created || 0) - (first.created || 0));
    state.items = [...mixes, ...demos.map(track => stored.get(track.id) || track)];
  }
  const downloaded = () => state.items.filter(track => track.downloaded);

  function row(track, allowDelete = false) {
    const favorite = state.favorites.has(track.id);
    const info = `${escapeHTML(track.artist || 'You')} · ${formatTime(track.dur)}`;
    const status = track.downloaded ? `<span class="off">${icon('check')}Offline</span>` : '';
    const videoStatus = track.videoId ? `<span>${icon('film')}Video</span>` : '';
    const downloadControl = allowDelete
      ? `<button class="ibtn" data-act="del" data-id="${escapeHTML(track.id)}" aria-label="Remove ${escapeHTML(track.title)} from downloads">${icon('trash')}</button>`
      : track.downloaded
        ? `<span class="ibtn on" aria-hidden="true">${icon('check')}</span>`
        : `<button class="ibtn" data-act="dl" data-id="${escapeHTML(track.id)}" aria-label="Save ${escapeHTML(track.title)} offline">${icon('download')}</button>`;
    return `<div class="row ${state.current === track.id ? 'cur' : ''}">
      <button class="art" style="${artStyle(track)}" data-act="play" data-id="${escapeHTML(track.id)}" aria-label="Play ${escapeHTML(track.title)}"></button>
      <button class="meta" data-act="play" data-id="${escapeHTML(track.id)}"><span class="t">${escapeHTML(track.title)}</span><span class="a">${info} ${status} ${videoStatus}</span></button>
      <div class="acts"><button class="ibtn ${favorite ? 'on' : ''}" data-act="fav" data-id="${escapeHTML(track.id)}" aria-pressed="${favorite}" aria-label="${favorite ? 'Remove' : 'Add'} ${escapeHTML(track.title)} ${favorite ? 'from' : 'to'} favorites">${icon('heart')}</button>${downloadControl}</div>
    </div>`;
  }
  function poster(track) {
    return `<button class="poster" data-act="play" data-id="${escapeHTML(track.id)}"><div class="art" style="${artStyle(track)}">${track.videoId ? `<span class="tagv">${icon('film')}Video</span>` : ''}</div><b>${escapeHTML(track.title)}</b><span class="a">${escapeHTML(track.artist || 'You')}</span></button>`;
  }

  function renderHome() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const mixes = state.items.filter(track => !track.demo);
    const recent = state.history.map(findItem).find(Boolean);
    const featured = recent || mixes[0] || state.items[0];
    const filters = [['foryou', 'For you'], ['mixes', 'Video mixes'], ['demos', 'Demos'], ['offline', 'Offline']];
    let picks = state.items;
    if (state.filter === 'mixes') picks = mixes;
    if (state.filter === 'demos') picks = state.items.filter(track => track.demo);
    if (state.filter === 'offline') picks = downloaded();
    const savedBytes = downloaded().reduce((sum, track) => sum + (track.size || 0), 0);
    $('#v-home').innerHTML = `
      <div class="top"><div class="logo">Reel<i>Tune</i></div><div class="top-r"><button class="ibtn" data-act="create" aria-label="Create a new video mix">${icon('plus')}</button><div class="avatar" aria-hidden="true">R</div></div></div>
      <div class="chips" role="group" aria-label="Filter tracks">${filters.map(([key, label]) => `<button class="chip" data-act="chip" data-chip="${key}" aria-pressed="${state.filter === key}">${label}</button>`).join('')}</div>
      <h1 class="greet">${greeting}</h1>
      ${featured ? `<button class="hero" data-act="play" data-id="${escapeHTML(featured.id)}" aria-label="Play ${escapeHTML(featured.title)}"><div class="art" style="${artStyle(featured)}"></div><div class="over"><div><small>${recent ? 'Continue listening' : 'Start here'}</small><b>${escapeHTML(featured.title)}</b><span class="a">${escapeHTML(featured.artist || 'You')}</span></div><span class="playfab">${icon('play')}</span></div></button>` : ''}
      <div class="sec"><h2>Your video mixes</h2><button data-act="create">New mix</button></div>
      ${mixes.length ? `<div class="rail">${mixes.map(poster).join('')}</div>` : `<div class="empty"><b>No video mixes yet</b>Add a video and a song to play them together, even offline.<button class="btn wide" data-act="create">Create your first mix</button></div>`}
      <div class="sec"><h2>Quick picks</h2></div>
      <div class="quick">${picks.slice(0, 6).map(track => `<button class="q" data-act="play" data-id="${escapeHTML(track.id)}"><span class="art" style="${artStyle(track)}"></span><b>${escapeHTML(track.title)}</b></button>`).join('') || '<p class="empty">Nothing here yet.</p>'}</div>
      <div class="sec"><h2>Trending demos</h2></div><div class="rows">${state.items.filter(track => track.demo).map(track => row(track)).join('')}</div>
      <div class="sec"><h2>On this device</h2></div><div class="stats"><div class="stat"><b>${mixes.length}</b><span>Video mixes</span></div><div class="stat"><b>${downloaded().length}</b><span>Offline</span></div><div class="stat"><b>${formatSize(savedBytes)}</b><span>Used</span></div></div>`;
  }
  function renderSearch() {
    const query = state.query.trim().toLowerCase();
    const results = query ? state.items.filter(track => `${track.title} ${track.artist || ''}`.toLowerCase().includes(query)) : [];
    $('#v-search').innerHTML = `<div class="searchbox"><input id="q" type="search" placeholder="Search songs and mixes" value="${escapeHTML(state.query)}" aria-label="Search songs and mixes"></div>` +
      (query
        ? results.length ? `<div class="rows">${results.map(track => row(track)).join('')}</div>` : '<div class="empty"><b>No results</b>Try another title.</div>'
        : '<div class="tiles"><button class="tile" style="background:#ffa200;color:#111" data-act="chipgo" data-chip="mixes">Video mixes</button><button class="tile" style="background:#2d6cdf" data-act="chipgo" data-chip="demos">Demos</button><button class="tile" style="background:#16a085" data-act="tab" data-tab="downloads">Offline</button><button class="tile" style="background:#8e44ad" data-act="tab" data-tab="library">Favorites</button></div>');
  }
  async function renderDownloads() {
    const tracks = downloaded();
    const bytes = tracks.reduce((sum, track) => sum + (track.size || 0), 0);
    let quota = 0;
    try {
      const estimate = await navigator.storage?.estimate();
      quota = estimate?.quota || 0;
    } catch {
      // Storage estimates are optional; the offline list still works without them.
    }
    $('#v-downloads').innerHTML = `<div class="dl-head"><h1>Downloads</h1><p>${tracks.length} item${tracks.length === 1 ? '' : 's'} · ${formatSize(bytes)} saved on this device${db.temporary ? ' (temporary)' : ''}</p>
      ${quota ? `<div class="meter" role="img" aria-label="Storage used"><i style="width:${Math.max(1, Math.min(100, bytes / quota * 100))}%"></i></div><p style="font-size:12px">${formatSize(bytes)} of ${formatSize(quota)} app storage</p>` : ''}</div>
      <button class="btn wide" data-act="create">Add video mix</button>
      ${tracks.length ? `<div class="rows">${tracks.map(track => row(track, true)).join('')}</div>` : '<div class="empty"><b>Nothing downloaded yet</b>Save a demo song or create a video mix. Downloads are available offline.</div>'}`;
  }
  function renderLibrary() {
    const favorites = state.items.filter(track => state.favorites.has(track.id));
    const history = state.history.map(findItem).filter(Boolean);
    $('#v-library').innerHTML = `<div class="dl-head"><h1>Library</h1></div>
      <div class="sec" style="margin-top:6px"><h2>Favorites</h2></div>${favorites.length ? `<div class="rows">${favorites.map(track => row(track)).join('')}</div>` : '<p class="empty">Tap the heart on any track to keep it here.</p>'}
      <div class="sec"><h2>Recently played</h2></div>${history.length ? `<div class="rows">${history.slice(0, 8).map(track => row(track)).join('')}</div>` : '<p class="empty">Songs you play will show up here.</p>'}`;
  }
  function render() {
    const renderers = { home: renderHome, search: renderSearch, downloads: renderDownloads, library: renderLibrary };
    renderers[state.tab]();
    document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== `v-${state.tab}`; });
    document.querySelectorAll('.tabs [data-tab]').forEach(button => {
      if (button.dataset.tab === state.tab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (state.tab === 'search') {
      const searchInput = $('#q');
      if (searchInput && document.activeElement !== searchInput && !state.query) searchInput.focus({ preventScroll: true });
    }
  }
  async function refresh() {
    await loadItems();
    render();
    renderPlayer();
  }

  function updatePlayButtons() {
    const playing = !audio.paused;
    $('#npPlay').innerHTML = icon(playing ? 'pause' : 'play');
    $('#npPlay').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('#miniPlay').innerHTML = icon(playing ? 'pause' : 'play');
    $('#miniPlay').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  function renderPlayer() {
    const track = findItem(state.current);
    $('#mini').hidden = !track;
    if (!track) return;
    $('#miniTitle').textContent = $('#npTitle').textContent = track.title;
    $('#miniArtist').textContent = $('#npArtist').textContent = track.artist || 'You';
    $('#miniArt').setAttribute('style', `${artStyle(track)};background-size:cover`);
    $('#npBadge').textContent = track.videoId ? (track.ownAudio ? 'Video with its own sound' : 'Video + song, in sync') : 'Audio only';
    const favoriteButton = $('#npFav');
    favoriteButton.innerHTML = icon('heart');
    favoriteButton.classList.toggle('fill-on', state.favorites.has(track.id));
    favoriteButton.setAttribute('aria-pressed', state.favorites.has(track.id));
    $('#npDl').hidden = !!track.downloaded;
    updatePlayButtons();
  }
  function openPlayer() {
    $('#np').classList.add('open');
    $('#np').setAttribute('aria-hidden', 'false');
  }
  function closePlayer() {
    $('#np').classList.remove('open');
    $('#np').setAttribute('aria-hidden', 'true');
  }
  function releaseObjectURLs() {
    state.urls.forEach(url => URL.revokeObjectURL(url));
    state.urls = [];
  }
  function objectURL(blob) {
    const url = URL.createObjectURL(blob);
    state.urls.push(url);
    return url;
  }
  async function playTrack(id) {
    const track = findItem(id);
    if (!track) return;
    if (state.current === id && audio.src) {
      togglePlayback();
      return;
    }
    try {
      releaseObjectURLs();
      let audioSource;
      let videoSource = null;
      if (track.demo) {
        if (track.downloaded && track.audioId) {
          const storedAudio = await db.get('files', track.audioId);
          if (!storedAudio) throw new Error('The saved demo audio file is missing.');
          audioSource = objectURL(storedAudio.blob);
        } else {
          audioSource = objectURL(track.blob);
        }
      } else {
        const audioFile = track.audioId ? await db.get('files', track.audioId) : null;
        const videoFile = track.videoId ? await db.get('files', track.videoId) : null;
        audioSource = audioFile ? objectURL(audioFile.blob) : (videoFile && track.ownAudio ? objectURL(videoFile.blob) : null);
        videoSource = videoFile ? objectURL(videoFile.blob) : null;
      }
      if (!audioSource) throw new Error('This item is missing its audio file.');
      state.current = id;
      state.history = [id, ...state.history.filter(itemId => itemId !== id)].slice(0, 20);
      savePreferences();
      audio.src = audioSource;
      audio.loop = state.loop;
      if (videoSource) {
        video.src = videoSource;
        video.hidden = false;
      } else {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.hidden = true;
      }
      $('#viz').hidden = !!videoSource;
      renderPlayer();
      openPlayer();
      render();
      try {
        await audio.play();
      } catch {
        toast('Tap Play to start audio in this browser.');
      }
    } catch (error) {
      toast(error.message || 'Could not play this item.');
    }
  }
  function togglePlayback() {
    if (!audio.src) {
      if (state.items[0]) playTrack(state.items[0].id);
      return;
    }
    if (audio.paused) audio.play().catch(() => toast('Could not start audio playback.'));
    else audio.pause();
  }
  function stepTrack(direction) {
    if (!state.items.length) return;
    const index = state.items.findIndex(track => track.id === state.current);
    const next = (index + direction + state.items.length) % state.items.length;
    playTrack(state.items[next].id);
  }
  function syncVideo(force = false) {
    if (!video.src || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const target = audio.currentTime % video.duration;
    let difference = Math.abs(video.currentTime - target);
    difference = Math.min(difference, video.duration - difference);
    if (force || difference > 0.35) video.currentTime = target;
  }
  audio.addEventListener('play', () => {
    if (video.src) video.play().catch(() => {});
    updatePlayButtons();
  });
  audio.addEventListener('playing', () => { if (video.src) video.play().catch(() => {}); });
  audio.addEventListener('pause', () => { video.pause(); updatePlayButtons(); });
  audio.addEventListener('waiting', () => video.pause());
  audio.addEventListener('seeked', () => syncVideo(true));
  audio.addEventListener('loadedmetadata', () => { $('#tDur').textContent = formatTime(audio.duration); });
  audio.addEventListener('ended', () => { if (!state.loop) stepTrack(1); });
  audio.addEventListener('timeupdate', () => {
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    const seek = $('#seek');
    if (!seek.matches(':active')) {
      seek.value = String(progress * 1000);
      seek.style.setProperty('--p', `${progress * 100}%`);
    }
    $('#tCur').textContent = formatTime(audio.currentTime);
    $('#miniBar').style.width = `${progress * 100}%`;
    syncVideo();
  });
  $('#seek').addEventListener('input', event => {
    if (audio.duration) audio.currentTime = Number(event.currentTarget.value) / 1000 * audio.duration;
    event.currentTarget.style.setProperty('--p', `${event.currentTarget.value / 10}%`);
  });

  async function getVideoPoster(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const element = document.createElement('video');
      let finished = false;
      const done = value => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(value);
      };
      const timer = setTimeout(() => done(null), 7000);
      element.muted = true;
      element.playsInline = true;
      element.preload = 'metadata';
      element.onloadeddata = () => { element.currentTime = Math.min(1, (element.duration || 2) / 2); };
      element.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 360;
          canvas.height = Math.round(360 * (element.videoHeight / element.videoWidth || 1.25));
          canvas.getContext('2d')?.drawImage(element, 0, 0, canvas.width, canvas.height);
          done(canvas.toDataURL('image/jpeg', 0.72));
        } catch {
          done(null);
        }
      };
      element.onerror = () => done(null);
      element.src = url;
    });
  }
  function getDuration(blob, type) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const element = document.createElement(type);
      const finish = (error, duration) => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        element.removeAttribute('src');
        if (error) reject(error);
        else resolve(duration);
      };
      const timer = setTimeout(() => finish(new Error('Could not read the selected media duration.'), 0), 10000);
      element.preload = 'metadata';
      element.onloadedmetadata = () => finish(null, Number.isFinite(element.duration) ? element.duration : 0);
      element.onerror = () => finish(new Error('The selected file is not a supported media format.'), 0);
      element.src = url;
    });
  }

  function openCreateDialog() {
    $('#createForm').reset();
    $('#cErr').hidden = true;
    $('#cAudioWrap').hidden = false;
    $('#cSave').disabled = false;
    $('#cSave').textContent = 'Save mix';
    const dialog = $('#create');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  $('#cOwn').addEventListener('change', event => {
    $('#cAudioWrap').hidden = event.currentTarget.checked;
  });
  $('#cCancel').addEventListener('click', () => {
    const dialog = $('#create');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  });
  $('#createForm').addEventListener('submit', async event => {
    event.preventDefault();
    const videoFile = $('#cVideo').files[0];
    const audioFile = $('#cAudio').files[0];
    const useVideoAudio = $('#cOwn').checked;
    const errorMessage = $('#cErr');
    const fail = message => {
      errorMessage.textContent = message;
      errorMessage.hidden = false;
    };
    errorMessage.hidden = true;
    if (!videoFile) return fail('Choose a video file.');
    if (!useVideoAudio && !audioFile) return fail('Choose a song, or select the video’s own sound.');
    if (useVideoAudio && !videoFile.type.startsWith('video/')) return fail('Choose a valid video file.');
    if (!useVideoAudio && (!videoFile.type.startsWith('video/') || !audioFile.type.startsWith('audio/'))) {
      return fail('Choose a valid video and audio file.');
    }
    const saveButton = $('#cSave');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    const id = `mix-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const title = $('#cTitle').value.trim() || videoFile.name.replace(/\.[^.]+$/, '');
    try {
      const durationBlob = useVideoAudio ? videoFile : audioFile;
      const durationType = useVideoAudio ? 'video' : 'audio';
      const [duration, thumbnail] = await Promise.all([
        getDuration(durationBlob, durationType),
        getVideoPoster(videoFile)
      ]);
      const videoId = `${id}-video`;
      const audioId = useVideoAudio ? null : `${id}-audio`;
      await db.put('files', { id: videoId, blob: videoFile, name: videoFile.name, type: videoFile.type, size: videoFile.size });
      if (audioFile && !useVideoAudio) {
        await db.put('files', { id: audioId, blob: audioFile, name: audioFile.name, type: audioFile.type, size: audioFile.size });
      }
      await db.put('mixes', {
        id,
        title,
        artist: audioFile && !useVideoAudio ? audioFile.name.replace(/\.[^.]+$/, '') : 'Original sound',
        videoId,
        audioId,
        ownAudio: useVideoAudio,
        thumb: thumbnail,
        dur: duration,
        size: videoFile.size + (audioFile && !useVideoAudio ? audioFile.size : 0),
        downloaded: true,
        created: Date.now()
      });
      const dialog = $('#create');
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      await refresh();
      toast(`Saved for offline: ${title}`);
    } catch (error) {
      fail(error.message || 'Could not save this mix. Check available storage and try again.');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Save mix';
    }
  });

  async function downloadDemo(id) {
    const track = findItem(id);
    if (!track?.demo || track.downloaded) return;
    const fileId = `file-${track.id}`;
    await db.put('files', { id: fileId, blob: track.blob, name: `${track.title}.wav`, type: 'audio/wav', size: track.size });
    await db.put('mixes', {
      id: track.id, demo: true, downloaded: true, title: track.title, artist: track.artist,
      audioId: fileId, dur: track.dur, size: track.size, created: Date.now(), hue: track.hue
    });
    await refresh();
    toast(`Saved for offline: ${track.title}`);
  }
  async function removeDownload(id) {
    const track = findItem(id);
    if (!track) return;
    if (state.current === id) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      video.pause();
      video.removeAttribute('src');
      video.load();
      releaseObjectURLs();
      state.current = null;
      closePlayer();
    }
    if (track.audioId) await db.delete('files', track.audioId);
    if (track.videoId) await db.delete('files', track.videoId);
    await db.delete('mixes', id);
    state.favorites.delete(id);
    state.history = state.history.filter(itemId => itemId !== id);
    savePreferences();
    await refresh();
    toast(`Removed ${track.title}`);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const { act, id } = button.dataset;
    if (act === 'play') playTrack(id);
    else if (act === 'toggle') togglePlayback();
    else if (act === 'open-np') openPlayer();
    else if (act === 'close-np') closePlayer();
    else if (act === 'prev') {
      if (audio.currentTime > 3) audio.currentTime = 0;
      else stepTrack(-1);
    } else if (act === 'next') stepTrack(1);
    else if (act === 'loop') {
      state.loop = !state.loop;
      audio.loop = state.loop;
      button.setAttribute('aria-pressed', state.loop);
      button.setAttribute('aria-label', `Repeat ${state.loop ? 'on' : 'off'}`);
    } else if (act === 'fav' || act === 'fav-cur') {
      const targetId = act === 'fav-cur' ? state.current : id;
      if (!targetId) return;
      if (state.favorites.has(targetId)) state.favorites.delete(targetId);
      else state.favorites.add(targetId);
      savePreferences();
      render();
      renderPlayer();
    } else if (act === 'dl' || act === 'dl-cur') {
      const targetId = act === 'dl-cur' ? state.current : id;
      downloadDemo(targetId).catch(error => toast(error.message || 'Could not save this download.'));
    } else if (act === 'del') {
      removeDownload(id).catch(error => toast(error.message || 'Could not remove this download.'));
    } else if (act === 'create') openCreateDialog();
    else if (act === 'chip') {
      state.filter = button.dataset.chip;
      render();
    } else if (act === 'chipgo') {
      state.filter = button.dataset.chip;
      state.tab = 'home';
      render();
    } else if (act === 'tab') {
      state.tab = button.dataset.tab;
      render();
      $('#views').scrollTop = 0;
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id !== 'q') return;
    state.query = event.target.value;
    const position = event.target.selectionStart;
    renderSearch();
    const input = $('#q');
    input.focus();
    input.setSelectionRange(position, position);
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches('input, textarea, button')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      togglePlayback();
    } else if (event.code === 'ArrowRight' && audio.src) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    else if (event.code === 'ArrowLeft' && audio.src) audio.currentTime = Math.max(0, audio.currentTime - 5);
    else if (event.key === 'Escape') closePlayer();
  });
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', togglePlayback);
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => stepTrack(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => stepTrack(-1));
    } catch {
      // Media-session actions vary by browser.
    }
  }

  $('#create').addEventListener('click', event => {
    if (event.target === $('#create')) {
      const dialog = $('#create');
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  });
  $('#seek').style.setProperty('--p', '0%');
  $('#npPlay').innerHTML = icon('play');
  $('#miniPlay').innerHTML = icon('play');
  refresh().catch(error => toast(error.message || 'Could not load your library.'));
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => toast('Offline app shell could not be installed.'));
  }
})();
