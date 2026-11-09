# Empower Hope Learning Portal

## Run locally

Use Node.js 22.5 or later and PostgreSQL 15 or later. Create a dedicated application role and database (use a private password):

```sql
CREATE ROLE empower_app LOGIN PASSWORD 'use-a-private-password';
CREATE DATABASE empower_hope OWNER empower_app;
```

Add the connection string to `CSR Project/.env.database`:

```text
DATABASE_URL=postgresql://empower_app:your-url-encoded-password@127.0.0.1:5432/empower_hope
```

Install dependencies and start the app:

```powershell
npm install
npm run dev
```

Open the URL printed by the server (usually `http://localhost:5173`). On first signup, enter the school name; that account becomes its school administrator. Admins can create email-specific teacher or bursar invitations from **School & team** and share the generated link with that person. Invitations expire after seven days. The invited person must use the matching email address.

Teachers can maintain a student roster and take a daily attendance register. School administrators and bursars can record fee payments. Payments are manual records only: the app does not initiate or verify M-Pesa transactions.

## Data isolation and roles

School memberships use `school_admin`, `teacher`, and `bursar` roles. API authorization checks membership roles, every school record is scoped to the authenticated school, and PostgreSQL row-level security is forced for student, attendance, payment, and invitation data. The server refuses PostgreSQL superuser or `BYPASSRLS` credentials. Use the dedicated, least-privilege app role above.

The existing local SQLite account file is not migrated automatically. Existing accounts must be recreated in the PostgreSQL-backed app. Resource-library customizations and other browser-local preferences are not part of this school-data migration.

## Pilot boundaries

This pilot does not include offline attendance synchronization, fee balances or invoices, outbound email, automated M-Pesa callbacks, or per-school database provisioning. Invitation links must be shared privately. Before public deployment, configure HTTPS, database backups, rate limits, monitored migrations, and an approved school onboarding process. Review data-handling and retention with qualified local counsel.

## Production

Set `DATABASE_URL` in the deployment environment, run `npm run build`, then start with `NODE_ENV=production npm start`. The app serves the built frontend and API on the same origin. `PORT` can be set to change the listening port. Do not commit `.env.local` or production database credentials.
