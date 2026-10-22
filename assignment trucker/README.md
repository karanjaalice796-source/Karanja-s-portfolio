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

The `.env.example` file lists the available settings. Set `ALLOW_REGISTRATION=false` when student self-registration should be disabled. Trainers and admins are created by an administrator.

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

The public **Learning hub** at `/learn` offers a short assignment planning routine and links to student login and registration. Students can sign themselves up when `ALLOW_REGISTRATION=true`; successful registration signs them in and opens their student dashboard. Existing users log in at `/login` and sign out from the account menu. Trainers and admins are created by an administrator and use the same login page.

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

Hand-ins currently accept a link or note, not uploaded files. Reminders are in-app notifications; email and SMS delivery, password reset email, hosting, and billing are not included.