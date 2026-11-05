# Empower Hope Learning Portal

## Run locally

Install dependencies and start the app:

```powershell
npm install
npm run dev
```

Open the URL printed by the server (usually `http://localhost:5173`). Create an account with a name, role, email address, and password of at least 8 characters, or use the Log in tab after signing up. No Supabase project or environment variables are required.

## Account database

Accounts are stored in `data/accounts.sqlite`. Passwords are hashed before they are stored; the database file is excluded from Git. Set `DATABASE_PATH` to use a different local database file. The built-in SQLite database is intended for this local app and is not a hosted, multi-user production service. Deploying publicly requires a secured production database, HTTPS, and operational backups.

## Production

Run `npm run build`, then start the app with `npm start` and `NODE_ENV=production`. The app serves the built frontend and account API from the same origin. `PORT` can be set to change the listening port.
