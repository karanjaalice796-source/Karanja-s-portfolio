# Nodevents OAuth setup

Nodevents supports Google and Apple sign-in using OpenID Connect authorization code flow with state, nonce, and PKCE. Email/password sign-in remains available. OAuth accounts are matched by the provider's stable subject ID; an existing email account is never linked automatically.

## 1. Configure the app

Use Node.js 22.5.0 or newer. From the `nodevents` directory, copy `.env.example` to `.env` and set:

- `APP_BASE_URL` to the exact public origin where Nodevents is served. For local testing, use `http://localhost:3100`.
- `SESSION_SECRET` to a long, random secret. For example, in PowerShell run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste the output.
- Provider credentials described below.

Install dependencies with `npm install`, then start Nodevents with `npm start`. `.env` is ignored by Git; never commit provider secrets or private keys.

## 2. Vendor email and reminders

When a planner adds a vendor with an email address, Nodevents sends the vendor their private event link. It also emails vendors about timeline changes and invoice updates. Pending vendors receive automatic reminders while the server is running.

To test without sending real email, leave `SMTP_HOST` empty. Nodevents prints the messages in the server console. To send real email, set these values in `.env` using the SMTP details from your email provider:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
MAIL_FROM="Nodevents <you@example.com>"
```

For implicit TLS, use the secure port supplied by your provider and set `SMTP_SECURE=true`. Keep SMTP credentials private. Set `APP_BASE_URL` to the public app origin so emailed links open the correct site.

Reminder defaults are 48 hours between emails and a maximum of 3 automatic reminders per vendor. Adjust these optional settings in `.env`:

```dotenv
REMINDER_HOURS=48
MAX_REMINDERS=3
REMINDER_CHECK_MINUTES=60
```

Reminders stop when a vendor responds, reaches the reminder limit, or the event date has passed. For a quick local demo, you can temporarily use `REMINDER_HOURS=0.02` and `REMINDER_CHECK_MINUTES=1`; restart the app after changing `.env`. Automatic reminders only run while Nodevents is running.

## 3. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create a project and configure the OAuth consent screen.
2. Create an OAuth client ID with application type **Web application**.
3. Add this exact authorized redirect URI (replace the origin if needed):

   `http://localhost:3100/auth/google/callback`

   For production, register `https://your-domain.example/auth/google/callback`.
4. Copy the client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Make sure the consent screen allows the email and profile scopes requested by Nodevents (`openid email profile`).

## 4. Apple sign-in

Apple sign-in requires an Apple Developer membership and a domain reachable over HTTPS.

1. In [Apple Developer](https://developer.apple.com/account/resources/identifiers/list), enable **Sign in with Apple** for a primary App ID.
2. Create a **Services ID** and enable Sign in with Apple for it. Configure the domain and return URL:

   `https://your-domain.example/auth/apple/callback`

   Apple requires HTTPS for web redirect URLs; localhost is not an Apple web callback.
3. Create a Sign in with Apple key for the App ID. Download the `.p8` private key once and record its Key ID and your Team ID.
4. Set `APPLE_CLIENT_ID` to the Services ID, `APPLE_TEAM_ID` to your Team ID, and `APPLE_KEY_ID` to the key's ID.
5. Set `APPLE_PRIVATE_KEY` to the complete `.p8` contents. In a local `.env` file, use a quoted value with literal `\n` between lines, for example:

   ```dotenv
   APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_CONTENT\n-----END PRIVATE KEY-----"
   ```

Apple may return the user's name only during the first authorization. Nodevents uses the verified email's local part as a fallback.

## 5. Verify configuration

Restart Nodevents after changing `.env`, then open `/auth`. A provider button is enabled only when its required environment values are present. Starting a configured provider should redirect to its official sign-in page and return to the callback URL above.

Provider credentials and callback URLs must match exactly. In production set `NODE_ENV=production`, use an HTTPS `APP_BASE_URL`, and serve Nodevents behind HTTPS. Without credentials, email/password sign-in and registration continue to work normally.
