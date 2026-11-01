# Student Assignment Tracker

A Node.js and PostgreSQL app for training centres. Students track assignments and hand-ins, trainers publish coursework and follow class progress, and administrators manage accounts and courses.

## Requirements

- Node.js 18 or newer
- PostgreSQL 13 or newer, running locally or hosted

## Run Locally on Windows

1. Create a PostgreSQL database named `assignment_tracker`. In `psql`, run:

	```sql
	CREATE DATABASE assignment_tracker;
	```

2. Install the Node dependencies from this folder:

	```powershell
	npm install
	```

3. Open `.env` and replace `CHANGE_ME` in `DATABASE_URL` with your PostgreSQL password. The file is ignored by Git. If your password contains URL-reserved characters, URL-encode it. Set a long random `SESSION_SECRET` if you replace the generated local value.

4. Initialize and seed the database:

	```powershell
	npm run db:init
	npm run db:seed
	```

5. Start the app and open [http://localhost:3000](http://localhost:3000):

	```powershell
	npm start
	```

The `.env.example` file lists the available settings. Set `ALLOW_REGISTRATION=false` to disable public student and trainer registration.

## Daily Email Reminders

Students who have enabled email reminders receive a daily summary of their overdue assignments and assignments due within their selected reminder window. A student receives at most one reminder email per day. Email delivery is optional and requires SMTP configuration.

Set `SMTP_HOST` and `SMTP_FROM` in the private `.env` file to enable delivery. Configure `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASS` to match your email provider. When SMTP is not configured, reminders are disabled and the app reports this in the server terminal.

`EMAIL_REMINDER_HOUR` sets the hour, from `0` to `23`, when the app checks for reminders, using the server's local time. It defaults to `8`. The check runs once per minute during that hour. To test reminders, configure SMTP, enable email reminders on a student account, make sure that student has an overdue or soon-due unsubmitted assignment, set `EMAIL_REMINDER_HOUR` to the server's current local hour, and restart the app. Setting it to an earlier hour means the next check will be the following day. The `reminder_sent_on` field prevents duplicate reminders to the same student on the same day.

## Sign-in and Staff Accounts

Students, trainers, and administrators all sign in at `/login`. After signing in, each account is sent to its role's workspace. Students can create their own account at `/register`; trainers can request an account at `/register?role=teacher` when `ALLOW_REGISTRATION=true`. New trainer accounts remain inactive until an administrator approves them in **People**.

When no administrator account exists, the **Admin sign in** page offers **Create the first admin account**. This one-time public signup creates an active administrator; after it is created, the link is hidden and further trainer or administrator accounts must be created by an existing administrator through **People** → **Add a person**. Pending public trainer requests appear in the People list with an **Approve trainer** action. The protected shortcut is `/admin/users/new`; if you are not signed in as an administrator, you will be asked to sign in first.

For a new local database, run `npm run db:seed` during setup to create the initial demonstration administrator account. Use the local sample credentials in the section below to sign in, then create or update accounts for your centre. Replace demonstration credentials before sharing or deploying the app.

## Sample Accounts

The seed script creates these local demonstration accounts:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@example.com` | `Admin#12345` |
| Trainer | `teacher@example.com` | `Teacher#12345` |
| Student | `amina@example.com` | `Student#12345` |

Brian, Cynthia, and Dennis are additional sample students and use the same student password. These are public demo credentials. Change or remove them before exposing the app to other people. The seed script skips its work if the admin sample account already exists.

## Features

**Students** can see assignments from enrolled courses and personal tasks, track progress, hand in a link or note, see trainer feedback and marks, set their reminder window, filter and search their work, and export a CSV.

**Trainers** can post assignments to their courses, inspect each student's progress and hand-in, enter marks and feedback, notify students who have not handed in, manage course enrollment, and export a submission CSV.

**Administrators** can add people, enable or disable accounts, set a new password, create courses, assign trainers, and view centre-wide counts.

The public **Learning hub** at `/learn` offers a short assignment planning routine and links to account access. Students can sign themselves up when `ALLOW_REGISTRATION=true`; successful registration signs them in and opens their student dashboard. Trainers can request accounts, but must wait for admin approval before signing in. Existing users sign in at `/login` and sign out from the account menu. The first admin can self-register only while the database has no admin; an existing admin creates any additional admin accounts.

The interface supports light and dark themes, remembers the selected theme in the browser, and provides show/hide password controls on account forms. Student, trainer, and administrator dashboards group their sections into category links.

## Role Access

Students can access only the student side. Trainers can access the student and trainer sides, but not administration. Administrators can access all three sides; on the trainer side they can manage assignments and rosters across courses. Navigation links follow the same role rules, and direct URL access is checked by the server.

## Demo for Question 5

The original standalone HTML tracker is preserved at `public/demo/question-5.html`. The fuller browser-only version is at `public/demo/index.html`; both can be opened directly in a browser or through the running server at `/demo/` and `/demo/question-5.html`. They use browser local storage and are separate from the PostgreSQL app.

## Project Layout

```text
server.js                 Express server, sessions and middleware
config/db.js              PostgreSQL connection pool
db/schema.sql             Tables and indexes
db/init.js                Database initialization
db/seed.js                Demonstration accounts and sample assignments
routes/                   Authentication, student, teacher and admin routes
middleware/auth.js        Role checks, CSRF protection and flash messages
lib/                      Date, validation, CSV and query helpers
views/                    EJS pages for public and authenticated workflows
public/css/app.css        Main application styling
public/demo/              Standalone browser-only demos
```

## Security Notes

Passwords are hashed with bcrypt. Mutating forms use session CSRF tokens, database queries are parameterized, and output is escaped by EJS. Sessions are stored in PostgreSQL. This is a class project baseline, not a production security audit: before real deployment, use HTTPS, disable public registration if required, rotate demo credentials, configure database backups, and review rate limiting and account-recovery requirements.

Hand-ins currently accept a link or note, not uploaded files. Daily assignment email reminders are available when SMTP is configured; password reset email, SMS delivery, hosting, and billing are not included.