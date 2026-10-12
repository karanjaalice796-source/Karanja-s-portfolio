const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const multer = require("multer");
const { DatabaseSync } = require("node:sqlite");
const { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");

const app = express();
const port = process.env.PORT || 3000;
const dataDirectory = path.join(__dirname, "data");
const audioDirectory = path.join(dataDirectory, "audio");
const videoDirectory = path.join(dataDirectory, "video");
const scryptAsync = promisify(scrypt);
const sessionCookieName = "riff_session";
const sessionDurationSeconds = 60 * 60 * 24 * 30;
const databasePath = process.env.MUSIC_MANAGER_DB || path.join(dataDirectory, "music-manager.db");

fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(audioDirectory, { recursive: true });
fs.mkdirSync(videoDirectory, { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    duration TEXT NOT NULL,
    bpm INTEGER NOT NULL,
    musical_key TEXT NOT NULL,
    energy INTEGER NOT NULL,
    mood TEXT NOT NULL,
    cover TEXT NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    audio_path TEXT,
    audio_filename TEXT,
    audio_mime TEXT,
    file_size INTEGER,
    play_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    mood TEXT NOT NULL DEFAULT 'Focus',
    color TEXT NOT NULL DEFAULT '#6d70f5',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    favorite INTEGER NOT NULL DEFAULT 0,
    synced_to TEXT,
    owner_user_id INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id),
    position INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    duration TEXT NOT NULL,
    content TEXT NOT NULL,
    takeaway TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lesson_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, lesson_id)
  );
`);

function ensureColumn(table, column, definition) {
  const exists = database.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
  if (!exists) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("tracks", "uploaded_by", "INTEGER REFERENCES users(id)");
ensureColumn("tracks", "audio_path", "TEXT");
ensureColumn("tracks", "audio_filename", "TEXT");
ensureColumn("tracks", "audio_mime", "TEXT");
ensureColumn("tracks", "file_size", "INTEGER");
ensureColumn("tracks", "video_path", "TEXT");
ensureColumn("tracks", "video_filename", "TEXT");
ensureColumn("tracks", "video_mime", "TEXT");
ensureColumn("tracks", "video_size", "INTEGER");
ensureColumn("tracks", "play_count", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("tracks", "last_played_at", "TEXT");
ensureColumn("playlists", "owner_user_id", "INTEGER REFERENCES users(id)");

const supportedAudioTypes = new Map([
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".flac", "audio/flac"]
]);

const supportedVideoTypes = new Map([
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"]
]);

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, audioDirectory),
    filename: (_request, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 10, fields: 3 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!supportedAudioTypes.has(extension) || (file.mimetype && !file.mimetype.startsWith("audio/") && file.mimetype !== "application/octet-stream")) {
      const error = new Error("Choose MP3, M4A, AAC, WAV, OGG, or FLAC audio files.");
      error.code = "UNSUPPORTED_AUDIO";
      callback(error);
      return;
    }
    callback(null, true);
  }
});

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, videoDirectory),
    filename: (_request, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 250 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!supportedVideoTypes.has(extension) || (file.mimetype && !file.mimetype.startsWith("video/") && file.mimetype !== "application/octet-stream")) {
      const error = new Error("Choose an MP4, M4V, WebM, or MOV video file.");
      error.code = "UNSUPPORTED_VIDEO";
      callback(error);
      return;
    }
    callback(null, true);
  }
});

const lessonCount = database.prepare("SELECT COUNT(*) AS count FROM lessons").get().count;
if (lessonCount === 0) {
  const addLesson = database.prepare(`
    INSERT INTO lessons (category, title, description, duration, content, takeaway, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const lessons = [
    ["THE BASICS", "Build your first playlist", "Turn a feeling, moment, or idea into a mix that sounds like you.", "4 min",
      "A great playlist starts with a feeling, not a genre. Pick one clear idea: a slow Sunday morning, the last mile of a run, or a quiet hour of focus.\n\nStart with three anchor tracks you already love. Listen for what connects them: pace, warmth, energy, or the space between notes. Add new songs that share those qualities, then sequence them so one track naturally leads into the next.\n\nKeep the first version short. Ten songs with a point of view are more memorable than a hundred songs without one.", "Choose one feeling, then let your first three tracks set the direction.", 1],
    ["THE BASICS", "Read the energy of a song", "Learn how energy, tempo, and mood work together.", "5 min",
      "Energy describes how intense a song feels. Tempo is its measured speed in beats per minute (BPM). They often move together, but not always: a slow song can feel huge, and a fast song can feel gentle.\n\nMood is the emotional color. In Riff, the mood control moves from mellow to upbeat. Use it alongside energy instead of treating the two as the same thing.\n\nTry setting a low energy and higher tempo for a curious, light mix. Then reverse it: slower tempo with higher energy can create something spacious and cinematic.", "Energy is intensity; tempo is speed; mood is emotional color.", 2],
    ["MAKE IT YOURS", "Shape a smooth transition", "Arrange tracks so a playlist feels like one continuous journey.", "6 min",
      "Think of your playlist as a small journey. Give it an opening, a middle, and a landing. Begin with an inviting track, find your momentum in the middle, and leave room for a softer finish.\n\nWhen two songs feel abrupt back-to-back, compare their tempo and energy. A small change is usually easier to follow than a sudden leap. You can also use a familiar track as a bridge between different sounds.\n\nThere is no single correct order. If a transition makes you want to hear the next song, it is working.", "Use gradual changes in energy to give a playlist a beginning, middle, and end.", 3],
    ["SMART MIXES", "Make a mix with a prompt", "Describe the moment and let the playlist builder find a starting point.", "3 min",
      "The prompt builder works best when you describe both the activity and the feeling. Try “warm instrumental music for reading on a rainy afternoon” or “upbeat, focused tracks for a morning run.”\n\nChoose one of the quick presets for a faster start, then adjust the energy, tempo, mood, and acousticness sliders to refine your direction. Your generated mix is a starting point: explore the tracks and make it your own.", "Combine a moment with a feeling for a more useful playlist prompt.", 4],
    ["MAKE IT YOURS", "Explore acousticness", "Find the balance between electronic production and organic sound.", "4 min",
      "Acousticness is a measure of how acoustic a recording sounds. A higher setting tends to favor more organic-sounding tracks; a lower setting leans toward electronic production.\n\nIt is a flavor, not a quality score. Acoustic guitar can feel energetic, and synthesizers can feel calm. Try moving the slider while keeping your other settings steady to hear how this dimension changes the mix.", "Acousticness describes the sound palette, not the mood or energy.", 5],
    ["SMART MIXES", "Keep your library feeling fresh", "Revisit, refine, and save playlists for the moments they fit.", "4 min",
      "Your library should be easy to return to. Give playlists clear names, save favorites you reach for often, and create a fresh mix when your routine or mood changes.\n\nA playlist does not need to be finished forever. Remove tracks that no longer fit, reorder the ones you love, and let a new discovery shift its direction. Sign in to keep your learning progress tied to your account.", "A playlist can evolve as your moments and tastes change.", 6]
  ];
  for (const lesson of lessons) addLesson.run(...lesson);
}

const trackCount = database.prepare("SELECT COUNT(*) AS count FROM tracks").get().count;
if (trackCount === 0) {
  const insertTrack = database.prepare(`
    INSERT INTO tracks (title, artist, album, duration, bpm, musical_key, energy, mood, cover)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tracks = [
    ["Weightless", "Marconi Union", "Ambient Transmissions Vol. 2", "8:09", 60, "D", 18, "Focus", "linear-gradient(140deg,#1c7184,#8fd5ca)"],
    ["Intro", "The xx", "xx", "2:07", 75, "A", 31, "Chill", "linear-gradient(140deg,#19234b,#ec837d)"],
    ["Open Eye Signal", "Jon Hopkins", "Immunity", "7:48", 126, "F#", 83, "Energy", "linear-gradient(140deg,#ff704d,#5c2c66)"],
    ["A Walk", "Tycho", "Dive", "5:16", 95, "C", 56, "Chill", "linear-gradient(140deg,#e1b55d,#2a8994)"],
    ["Sunset Lover", "Petit Biscuit", "Presence", "3:57", 91, "G#", 62, "Chill", "linear-gradient(140deg,#f08852,#75406c)"],
    ["Kerala", "Bonobo", "Migration", "3:57", 150, "E", 78, "Energy", "linear-gradient(140deg,#d04f36,#f6b660)"],
    ["Night Owl", "Galimatias", "Renaissance Boy", "3:25", 104, "B", 49, "Chill", "linear-gradient(140deg,#314d71,#ec9d86)"],
    ["Awake", "Tycho", "Awake", "4:44", 117, "D", 74, "Energy", "linear-gradient(140deg,#49a69c,#e1cb6d)"],
    ["Holocene", "Bon Iver", "Bon Iver, Bon Iver", "5:36", 148, "E", 28, "Focus", "linear-gradient(140deg,#648695,#b3c3a1)"],
    ["A Moment Apart", "ODESZA", "A Moment Apart", "3:54", 98, "F", 67, "Energy", "linear-gradient(140deg,#35478d,#e29d6e)"],
    ["Your Hand in Mine", "Explosions in the Sky", "The Earth Is Not a Cold Dead Place", "8:17", 134, "C", 42, "Focus", "linear-gradient(140deg,#a96d4f,#e3c386)"],
    ["Tadow", "Masego, FKJ", "Lady Lady", "5:02",  attachBpm(), "F", 70, "Energy", "linear-gradient(140deg,#753d78,#df8e5d)"]
  ];
  for (const track of tracks) insertTrack.run(...track);
}

function attachBpm() {
  return 98;
}

const playlistCount = database.prepare("SELECT COUNT(*) AS count FROM playlists").get().count;
if (playlistCount === 0) {
  const addPlaylist = database.prepare("INSERT INTO playlists (name, description, mood, color, favorite) VALUES (?, ?, ?, ?, ?)");
  const addPlaylistTrack = database.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)");
  const playlists = [
    { name: "Deep Focus", description: "A little space to think clearly.", mood: "Focus", color: "#7d8bfa", favorite: 1, tracks: [1, 9, 11, 2] },
    { name: "Slow mornings", description: "Soft edges, slow starts.", mood: "Chill", color: "#e4a17f", favorite: 0, tracks: [4, 5, 7, 2] },
    { name: "Move with it", description: "Find your rhythm and go.", mood: "Energy", color: "#b39af2", favorite: 0, tracks: [3, 6, 8, 10, 12] },
    { name: "After hours", description: "For the ride home, and then some.", mood: "Chill", color: "#59b5a7", favorite: 0, tracks: [7, 2, 5, 4] }
  ];
  for (const playlist of playlists) {
    const result = addPlaylist.run(playlist.name, playlist.description, playlist.mood, playlist.color, playlist.favorite);
    playlist.tracks.forEach((trackId, index) => addPlaylistTrack.run(result.lastInsertRowid, trackId, index));
  }
}

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionToken(request) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));
  return cookie ? cookie.slice(sessionCookieName.length + 1) : null;
}

function getCurrentUser(request) {
  const token = getSessionToken(request);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = database.prepare(`
    SELECT u.id, u.email, u.display_name
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, Date.now());
  if (!session) {
    database.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return { id: session.id, email: session.email, name: session.display_name };
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${sessionCookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDurationSeconds}${secure}`);
}

async function createUserSession(userId, response) {
  const token = randomBytes(32).toString("base64url");
  database.prepare("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), userId, Date.now() + sessionDurationSeconds * 1000);
  setSessionCookie(response, token);
}

function requireUser(request, response, next) {
  request.user = getCurrentUser(request);
  if (!request.user) return response.status(401).json({ error: "Please log in to save your progress." });
  next();
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

app.get("/learn", (_request, response) => response.sendFile(path.join(__dirname, "public", "learn.html")));
app.get("/login", (_request, response) => response.sendFile(path.join(__dirname, "public", "auth.html")));
app.get("/signup", (_request, response) => response.sendFile(path.join(__dirname, "public", "auth.html")));

app.get("/api/auth/me", (request, response) => {
  const user = getCurrentUser(request);
  response.json({ user: user ? publicUser(user) : null });
});

app.post("/api/auth/signup", async (request, response) => {
  const name = String(request.body?.name || "").trim();
  const email = String(request.body?.email || "").trim().toLowerCase();
  const password = String(request.body?.password || "");
  if (name.length < 2 || name.length > 50) {
    return response.status(400).json({ error: "Your name must be between 2 and 50 characters." });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 8 || password.length > 128) {
    return response.status(400).json({ error: "Your password must be between 8 and 128 characters." });
  }
  if (database.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email)) {
    return response.status(409).json({ error: "An account with that email already exists. Try logging in." });
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await scryptAsync(password, salt, 64);
  let result;
  try {
    result = database.prepare("INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)")
      .run(email, name, `${salt}:${passwordHash.toString("hex")}`);
  } catch (error) {
    if (String(error.message).includes("UNIQUE constraint failed: users.email")) {
      return response.status(409).json({ error: "An account with that email already exists. Try logging in." });
    }
    throw error;
  }
  const user = { id: Number(result.lastInsertRowid), email, name };
  await createUserSession(user.id, response);
  response.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", async (request, response) => {
  const email = String(request.body?.email || "").trim().toLowerCase();
  const password = String(request.body?.password || "");
  const account = database.prepare("SELECT id, email, display_name, password_hash FROM users WHERE email = ? COLLATE NOCASE").get(email);
  if (!account || password.length > 128) {
    return response.status(401).json({ error: "Email or password is incorrect." });
  }
  const [salt, storedHash] = account.password_hash.split(":");
  const submittedHash = await scryptAsync(password, salt, 64);
  const expectedHash = Buffer.from(storedHash, "hex");
  if (submittedHash.length !== expectedHash.length || !timingSafeEqual(submittedHash, expectedHash)) {
    return response.status(401).json({ error: "Email or password is incorrect." });
  }
  const user = { id: account.id, email: account.email, name: account.display_name };
  await createUserSession(user.id, response);
  response.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (request, response) => {
  const token = getSessionToken(request);
  if (token) database.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hashToken(token));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
  response.json({ success: true });
});

app.get("/api/lessons", (request, response) => {
  const user = getCurrentUser(request);
  const lessons = database.prepare(`
    SELECT l.id, l.category, l.title, l.description, l.duration, l.content, l.takeaway, l.position,
      CASE WHEN p.lesson_id IS NULL THEN 0 ELSE 1 END AS completed
    FROM lessons l
    LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = ?
    ORDER BY l.position
  `).all(user?.id ?? -1);
  response.json({
    lessons,
    user: user ? publicUser(user) : null,
    completedCount: lessons.filter((lesson) => lesson.completed).length
  });
});

app.post("/api/lessons/:id/complete", requireUser, (request, response) => {
  const lessonId = Number(request.params.id);
  if (!Number.isInteger(lessonId) || !database.prepare("SELECT id FROM lessons WHERE id = ?").get(lessonId)) {
    return response.status(404).json({ error: "Lesson not found." });
  }
  const completed = request.body?.completed !== false;
  if (completed) {
    database.prepare("INSERT INTO lesson_progress (user_id, lesson_id) VALUES (?, ?) ON CONFLICT(user_id, lesson_id) DO NOTHING")
      .run(request.user.id, lessonId);
  } else {
    database.prepare("DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?").run(request.user.id, lessonId);
  }
  const completedCount = database.prepare("SELECT COUNT(*) AS count FROM lesson_progress WHERE user_id = ?").get(request.user.id).count;
  response.json({ lessonId, completed, completedCount });
});

function visibleTracksForUser(userId, orderBy = "added") {
  const order = {
    added: "CASE WHEN t.audio_path IS NULL THEN 1 ELSE 0 END, t.id DESC",
    played: "t.last_played_at DESC NULLS LAST, t.id DESC",
    popular: "t.play_count DESC, t.title COLLATE NOCASE",
    title: "t.title COLLATE NOCASE",
    artist: "t.artist COLLATE NOCASE, t.title COLLATE NOCASE"
  }[orderBy] || "CASE WHEN t.audio_path IS NULL THEN 1 ELSE 0 END, t.id DESC";
  return database.prepare(`
    SELECT t.id, t.title, t.artist, t.album, t.duration, t.bpm, t.musical_key, t.energy, t.mood,
      t.cover, t.play_count, t.last_played_at, (t.audio_path IS NOT NULL) AS downloaded,
      t.audio_filename, t.file_size,
      CASE WHEN t.audio_path IS NOT NULL THEN '/api/library/' || t.id || '/file' ELSE NULL END AS audio_url,
      (t.video_path IS NOT NULL) AS has_video, t.video_filename,
      CASE WHEN t.video_path IS NOT NULL THEN '/api/library/' || t.id || '/video' ELSE NULL END AS video_url
    FROM tracks t
    WHERE t.uploaded_by IS NULL OR t.uploaded_by = ?
    ORDER BY ${order}
  `).all(userId ?? -1);
}

function visiblePlaylistsForUser(userId) {
  const playlists = database.prepare(`
    SELECT p.*, COUNT(pt.track_id) AS track_count,
      COALESCE(SUM(CAST(substr(t.duration, 1, instr(t.duration, ':') - 1) AS INTEGER) * 60
        + CAST(substr(t.duration, instr(t.duration, ':') + 1) AS INTEGER)), 0) AS duration_seconds
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    LEFT JOIN tracks t ON t.id = pt.track_id
    WHERE p.owner_user_id IS NULL OR p.owner_user_id = ?
    GROUP BY p.id
    ORDER BY p.created_at DESC, p.id DESC
  `).all(userId ?? -1);
  return playlists;
}

app.get("/api/dashboard", (request, response) => {
  const user = getCurrentUser(request);
  response.json({
    playlists: visiblePlaylistsForUser(user?.id),
    tracks: visibleTracksForUser(user?.id, "title"),
    user: user ? publicUser(user) : null
  });
});

app.get("/api/library/artists", (request, response) => {
  const userId = getCurrentUser(request)?.id ?? -1;
  const artists = database.prepare(`
    SELECT artist, COUNT(*) AS track_count,
      SUM(CASE WHEN audio_path IS NOT NULL THEN 1 ELSE 0 END) AS downloaded_count,
      MAX(play_count) AS plays,
      (SELECT t2.id FROM tracks t2
        WHERE t2.artist = t.artist AND (t2.uploaded_by IS NULL OR t2.uploaded_by = ?)
        ORDER BY t2.play_count DESC, t2.id DESC LIMIT 1) AS featured_track_id
    FROM tracks t
    WHERE t.uploaded_by IS NULL OR t.uploaded_by = ?
    GROUP BY artist COLLATE NOCASE
    ORDER BY artist COLLATE NOCASE
  `).all(userId, userId);
  response.json({ artists });
});

app.get("/api/library", (request, response) => {
  const user = getCurrentUser(request);
  const orderBy = String(request.query.sort || "added");
  const downloadedOnly = request.query.downloaded === "true";
  const tracks = visibleTracksForUser(user?.id, orderBy)
    .filter((track) => !downloadedOnly || track.downloaded);
  response.json({ tracks, user: user ? publicUser(user) : null });
});

app.post("/api/library/upload", requireUser, (request, response, next) => {
  audioUpload.array("songs", 10)(request, response, (error) => {
    if (error) return next(error);
    const files = request.files || [];
    if (!files.length) return response.status(400).json({ error: "Choose at least one audio file to add." });

    const artist = String(request.body?.artist || "").trim().slice(0, 100) || "Unknown artist";
    const album = String(request.body?.album || "").trim().slice(0, 100) || "Local library";
    const insert = database.prepare(`
      INSERT INTO tracks (title, artist, album, duration, bpm, musical_key, energy, mood, cover,
        uploaded_by, audio_path, audio_filename, audio_mime, file_size)
      VALUES (?, ?, ?, '0:00', 0, '', 50, 'Library', 'linear-gradient(140deg,#fb5946,#442854)',
        ?, ?, ?, ?, ?)
    `);
    const tracks = files.map((file) => {
      const title = path.basename(file.originalname, path.extname(file.originalname)).trim().slice(0, 120) || "Untitled audio";
      const result = insert.run(title, artist, album, request.user.id, file.path, file.originalname.slice(0, 255), supportedAudioTypes.get(path.extname(file.originalname).toLowerCase()), file.size);
      return { id: Number(result.lastInsertRowid), title, artist, album, audio_filename: file.originalname, downloaded: 1 };
    });
    response.status(201).json({ tracks, count: tracks.length });
  });
});

app.get("/api/library/:id/file", requireUser, (request, response) => {
  const trackId = Number(request.params.id);
  const track = database.prepare("SELECT audio_path, audio_mime, audio_filename FROM tracks WHERE id = ? AND uploaded_by = ?")
    .get(trackId, request.user.id);
  if (!track || !track.audio_path || !fs.existsSync(track.audio_path)) {
    return response.status(404).json({ error: "Downloaded audio file not found." });
  }
  response.type(track.audio_mime || "application/octet-stream");
  response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(track.audio_filename)}`);
  response.sendFile(track.audio_path);
});

app.post("/api/library/:id/video", requireUser, (request, response, next) => {
  videoUpload.single("video")(request, response, (error) => {
    if (error) return next(error);
    const file = request.file;
    if (!file) return response.status(400).json({ error: "Choose a video file to pair with this song." });
    const trackId = Number(request.params.id);
    const track = database.prepare("SELECT video_path FROM tracks WHERE id = ? AND uploaded_by = ?")
      .get(trackId, request.user.id);
    if (!track) {
      fs.promises.unlink(file.path).catch((error) => console.error("Could not remove an unowned video upload:", error));
      return response.status(404).json({ error: "Downloaded song not found." });
    }
    database.prepare("UPDATE tracks SET video_path = ?, video_filename = ?, video_mime = ?, video_size = ? WHERE id = ? AND uploaded_by = ?")
      .run(file.path, file.originalname.slice(0, 255), supportedVideoTypes.get(path.extname(file.originalname).toLowerCase()), file.size, trackId, request.user.id);
    if (track.video_path && fs.existsSync(track.video_path)) {
      fs.promises.unlink(track.video_path).catch((error) => console.error("Could not remove the replaced video:", error));
    }
    response.status(201).json({ trackId, has_video: true, video_filename: file.originalname });
  });
});

app.get("/api/library/:id/video", requireUser, (request, response) => {
  const trackId = Number(request.params.id);
  const track = database.prepare("SELECT video_path, video_mime, video_filename FROM tracks WHERE id = ? AND uploaded_by = ?")
    .get(trackId, request.user.id);
  if (!track || !track.video_path || !fs.existsSync(track.video_path)) {
    return response.status(404).json({ error: "Downloaded video file not found." });
  }
  response.type(track.video_mime || "application/octet-stream");
  response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(track.video_filename)}`);
  response.sendFile(track.video_path);
});

app.delete("/api/library/:id/video", requireUser, async (request, response) => {
  const trackId = Number(request.params.id);
  const track = database.prepare("SELECT video_path FROM tracks WHERE id = ? AND uploaded_by = ?")
    .get(trackId, request.user.id);
  if (!track) return response.status(404).json({ error: "Downloaded song not found." });
  database.prepare("UPDATE tracks SET video_path = NULL, video_filename = NULL, video_mime = NULL, video_size = NULL WHERE id = ? AND uploaded_by = ?")
    .run(trackId, request.user.id);
  if (track.video_path && fs.existsSync(track.video_path)) await fs.promises.unlink(track.video_path);
  response.json({ success: true });
});

app.post("/api/library/:id/play", requireUser, (request, response) => {
  const trackId = Number(request.params.id);
  const result = database.prepare("UPDATE tracks SET play_count = play_count + 1, last_played_at = CURRENT_TIMESTAMP WHERE id = ? AND uploaded_by = ?")
    .run(trackId, request.user.id);
  if (!result.changes) return response.status(404).json({ error: "Downloaded song not found." });
  response.json({ play_count: database.prepare("SELECT play_count FROM tracks WHERE id = ?").get(trackId).play_count });
});

app.delete("/api/library/:id", requireUser, async (request, response) => {
  const trackId = Number(request.params.id);
  const track = database.prepare("SELECT audio_path, video_path FROM tracks WHERE id = ? AND uploaded_by = ?").get(trackId, request.user.id);
  if (!track) return response.status(404).json({ error: "Downloaded song not found." });
  database.prepare("DELETE FROM playlist_tracks WHERE track_id = ?").run(trackId);
  database.prepare("DELETE FROM tracks WHERE id = ? AND uploaded_by = ?").run(trackId, request.user.id);
  if (track.audio_path && fs.existsSync(track.audio_path)) await fs.promises.unlink(track.audio_path);
  if (track.video_path && fs.existsSync(track.video_path)) await fs.promises.unlink(track.video_path);
  response.json({ success: true });
});

app.post("/api/playlists", requireUser, (request, response) => {
  const name = String(request.body?.name || "").trim();
  const description = String(request.body?.description || "").trim().slice(0, 250);
  const mood = ["Focus", "Chill", "Energy"].includes(request.body?.mood) ? request.body.mood : "Focus";
  if (name.length < 1 || name.length > 48) {
    return response.status(400).json({ error: "Playlist name must be between 1 and 48 characters." });
  }
  const colors = { Focus: "#7481e6", Chill: "#e29c76", Energy: "#c25755" };
  const result = database.prepare(`
    INSERT INTO playlists (name, description, mood, color, owner_user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description, mood, colors[mood], request.user.id);
  const playlist = database.prepare("SELECT * FROM playlists WHERE id = ?").get(Number(result.lastInsertRowid));
  response.status(201).json({ playlist });
});

app.post("/api/playlists/:id/tracks", requireUser, (request, response) => {
  const playlistId = Number(request.params.id);
  const trackId = Number(request.body?.trackId);
  const playlist = database.prepare("SELECT id FROM playlists WHERE id = ? AND owner_user_id = ?").get(playlistId, request.user.id);
  const track = database.prepare("SELECT id FROM tracks WHERE id = ? AND (uploaded_by IS NULL OR uploaded_by = ?)")
    .get(trackId, request.user.id);
  if (!playlist) return response.status(404).json({ error: "Your playlist was not found." });
  if (!track) return response.status(404).json({ error: "Song was not found in your library." });
  if (database.prepare("SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?").get(playlistId, trackId)) {
    return response.status(409).json({ error: "This song is already in your playlist." });
  }
  const position = database.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?").get(playlistId).next;
  database.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)")
    .run(playlistId, trackId, position);
  response.status(201).json({ playlistId, trackId, position });
});

app.delete("/api/playlists/:id/tracks/:trackId", requireUser, (request, response) => {
  const playlistId = Number(request.params.id);
  const trackId = Number(request.params.trackId);
  const playlist = database.prepare("SELECT id FROM playlists WHERE id = ? AND owner_user_id = ?").get(playlistId, request.user.id);
  if (!playlist) return response.status(404).json({ error: "Your playlist was not found." });
  database.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?").run(playlistId, trackId);
  response.json({ success: true });
});

app.get("/api/playlists/:id/tracks", (request, response) => {
  const userId = getCurrentUser(request)?.id ?? -1;
  const tracks = database.prepare(`
    SELECT t.id, t.title, t.artist, t.album, t.duration, t.bpm, t.musical_key, t.energy, t.mood,
      t.cover, t.play_count, (t.audio_path IS NOT NULL) AS downloaded,
      t.audio_filename, t.file_size,
      CASE WHEN t.audio_path IS NOT NULL THEN '/api/library/' || t.id || '/file' ELSE NULL END AS audio_url,
      (t.video_path IS NOT NULL) AS has_video, t.video_filename,
      CASE WHEN t.video_path IS NOT NULL THEN '/api/library/' || t.id || '/video' ELSE NULL END AS video_url,
      pt.position
    FROM playlists p
    JOIN playlist_tracks pt ON pt.playlist_id = p.id
    JOIN tracks t ON t.id = pt.track_id
    WHERE p.id = ? AND (p.owner_user_id IS NULL OR p.owner_user_id = ?)
      AND (t.uploaded_by IS NULL OR t.uploaded_by = ?)
    ORDER BY pt.position
  `).all(Number(request.params.id), userId, userId);
  response.json(tracks);
});

app.post("/api/playlists/generate", (request, response) => {
  const { prompt = "", mood = "Focus", energy = 50, bpm = 110, valence = 50, acousticness = 50 } = request.body || {};
  const cleanPrompt = String(prompt).trim().slice(0, 100);
  const moodValue = ["Focus", "Chill", "Energy"].includes(mood) ? mood : "Focus";
  const targetEnergy = Math.max(0, Math.min(100, Number(energy) || 50));
  const targetBpm = Math.max(50, Math.min(200, Number(bpm) || 110));
  const targetValence = Math.max(0, Math.min(100, Number(valence) || 50));
  const targetAcousticness = Math.max(0, Math.min(100, Number(acousticness) || 50));
  const tracks = database.prepare(`
    SELECT id, title, artist, album, duration, bpm, musical_key, energy, mood, cover,
      play_count, (audio_path IS NOT NULL) AS downloaded, audio_filename, file_size,
      CASE WHEN audio_path IS NOT NULL THEN '/api/library/' || id || '/file' ELSE NULL END AS audio_url,
      (video_path IS NOT NULL) AS has_video, video_filename,
      CASE WHEN video_path IS NOT NULL THEN '/api/library/' || id || '/video' ELSE NULL END AS video_url
    FROM tracks
    WHERE uploaded_by IS NULL OR uploaded_by = ?
    ORDER BY ABS(energy - ?) + ABS(bpm - ?) * 0.35 + ABS(energy - ?) * 0.2
    LIMIT 6
  `).all(getCurrentUser(request)?.id ?? -1, targetEnergy, targetBpm, targetValence);
  const name = cleanPrompt
    ? cleanPrompt.replace(/^(create|make|build)\s+(me\s+)?(a\s+)?(playlist\s+)?(for\s+)?/i, "").replace(/[.!?]+$/, "").slice(0, 48)
    : `${moodValue} mix`;
  const palette = { Focus: "#7d8bfa", Chill: "#e4a17f", Energy: "#b39af2" };
  const playlistId = database.prepare(`
    INSERT INTO playlists (name, description, mood, color, owner_user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(name || `${moodValue} mix`, cleanPrompt || "Made for your current mood.", moodValue, palette[moodValue], getCurrentUser(request)?.id ?? null).lastInsertRowid;
  const addTrack = database.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)");
  tracks.forEach((track, index) => addTrack.run(playlistId, track.id, index));
  const playlist = database.prepare(`
    SELECT p.*, COUNT(pt.track_id) AS track_count
    FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    WHERE p.id = ? GROUP BY p.id
  `).get(playlistId);
  response.status(201).json({ playlist, tracks, settings: { valence: targetValence, acousticness: targetAcousticness } });
});

app.patch("/api/playlists/:id/favorite", (request, response) => {
  const playlistId = Number(request.params.id);
  const playlist = database.prepare("SELECT id, favorite FROM playlists WHERE id = ?").get(playlistId);
  if (!playlist) return response.status(404).json({ error: "Playlist not found." });
  const ownerUserId = database.prepare("SELECT owner_user_id FROM playlists WHERE id = ?").get(playlistId).owner_user_id;
  if (ownerUserId !== null && ownerUserId !== (getCurrentUser(request)?.id ?? -1)) {
    return response.status(404).json({ error: "Playlist not found." });
  }
  const favorite = playlist.favorite ? 0 : 1;
  database.prepare("UPDATE playlists SET favorite = ? WHERE id = ?").run(favorite, playlistId);
  response.json({ id: playlistId, favorite: Boolean(favorite) });
});

app.post("/api/playlists/:id/sync", (request, response) => {
  const platform = ["Spotify", "Apple Music"].includes(request.body?.platform) ? request.body.platform : null;
  if (!platform) return response.status(400).json({ error: "Choose Spotify or Apple Music." });
  const playlist = database.prepare("SELECT owner_user_id FROM playlists WHERE id = ?").get(Number(request.params.id));
  if (!playlist || (playlist.owner_user_id !== null && playlist.owner_user_id !== (getCurrentUser(request)?.id ?? -1))) {
    return response.status(404).json({ error: "Playlist not found." });
  }
  const result = database.prepare("UPDATE playlists SET synced_to = ? WHERE id = ?").run(platform, Number(request.params.id));
  if (!result.changes) return response.status(404).json({ error: "Playlist not found." });
  response.json({ syncedTo: platform, demo: true });
});

app.use((error, _request, response, next) => {
  if (error instanceof multer.MulterError) {
    let message = error.field === "video"
      ? "The video upload could not be processed."
      : "The audio upload could not be processed.";
    if (error.code === "LIMIT_FILE_SIZE") {
      message = error.field === "video"
        ? "Each video file must be 250 MB or smaller."
        : "Each audio file must be 50 MB or smaller.";
    } else if (error.code === "LIMIT_FILE_COUNT") {
      message = "Add up to 10 audio files at a time.";
    }
    return response.status(400).json({ error: message });
  }
  if (error.code === "UNSUPPORTED_AUDIO") {
    return response.status(400).json({ error: error.message });
  }
  if (error.code === "UNSUPPORTED_VIDEO") {
    return response.status(400).json({ error: error.message });
  }
  next(error);
});

app.get("/{*splat}", (_request, response) => response.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(port, () => {
  console.log(`Smart Music Playlist Manager is running at http://localhost:${port}`);
});
