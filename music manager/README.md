# Riff — Smart Music Playlist Manager

A responsive, dark-mode music dashboard built with Node.js, Express, plain JavaScript, HTML, CSS, and SQLite. The local database is stored at `data/music-manager.db` and is created and seeded automatically on first launch.

## Requirements

- Node.js 22.5 or newer (`node:sqlite` is used for the database)
- npm

## Run locally

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). For automatic server restarts while developing, run `npm run dev`.

## What works

- Mood, energy, tempo, and acousticness controls, plus prompt- and preset-based playlist generation.
- Searchable track list, list/grid view toggle, playlist selection, and preview player controls.
- Favorites and playlist-export demo endpoints.
- Persistent playlists and track data in a local SQLite database.
- Private local audio uploads, with optional paired offline videos that play alongside each song.
- A downloaded-music library with artist browsing, playlist assignment, and playback history.
- A learning room with six short lessons, category filters, and completion tracking.
- Email/password sign-up and login, with hashed passwords and persistent, HTTP-only sessions.

Streaming service controls are intentionally labelled as demo mode. OAuth, account linking, audio previews, and actual Spotify/Apple Music exports require provider credentials and are not configured.

## Offline audio and video

Sign in, open **Downloaded songs**, and add audio files from your device. Supported audio formats are MP3, M4A, AAC, WAV, OGG, and FLAC; each file can be up to 50 MB, with 10 files per upload. After adding a song, use **Add video** beside it to pair an MP4, M4V, WebM, or MOV file (up to 250 MB). The player starts the song and its video together; both media files are stored privately under `data/audio` and `data/video`, and are removed when their song or paired video is deleted.

The audio and video library APIs require a signed-in account:

- `POST /api/library/upload` accepts `songs` audio files.
- `POST /api/library/:id/video` accepts one `video` file for a song you own.
- `GET /api/library/:id/file` and `GET /api/library/:id/video` stream the corresponding private media.
- `DELETE /api/library/:id/video` removes a song's paired video.

## Accounts and learning

Visit `/signup` to create an account, `/login` to sign in, and `/learn` to browse the learning room. Lessons are available without an account; sign in to save completion progress. Account passwords are hashed with Node.js `scrypt`, and sessions use random HTTP-only cookies. Use HTTPS in production so session cookies are sent securely.

The account API provides `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`. Lessons are served by `GET /api/lessons`; signed-in users can save or undo a lesson using `POST /api/lessons/:id/complete`.

Set `MUSIC_MANAGER_DB` to use a separate SQLite file, or `PORT` to change the server port. This is useful for isolated development and testing.
