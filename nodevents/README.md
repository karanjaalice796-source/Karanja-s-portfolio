# Nodevents

Nodevents helps planners discover participating event-service vendors and coordinate their events.

## Run locally

Use Node.js 22.5 or later:

```powershell
npm start
```

The app is available at `http://localhost:3100`. SQLite creates or upgrades `data.db` when the server starts.

## Planner tools

- Create, edit, and permanently delete events from the planner workspace. Deleting an event removes its related records and uploaded invoice files.
- The public home page introduces Nodevents; Browse Events uses the built-in event templates, and Find Vendors searches profiles published by vendor accounts.
- Vendors can publish and edit their own searchable directory profile from Vendor Profile. A planner can invite a directory vendor to an event; this creates a private vendor invitation and links the invitation to the vendor account.
- Vendor profiles support a public service gallery of up to 12 JPG, PNG, or WebP images. Vendors can manage gallery images from Vendor Profile; image uploads are limited to 5 MB each.
- Client and planner accounts use separate registration and sign-in pages. Clients see only their own request and approved-event data in the client dashboard; attempts to use planner routes return to the client portal rather than showing planner data.
- The planner dashboard links to dedicated Client Event Requests and My Events pages, plus separate workspace Analytics and Reports pages. Planners can send a quotation to a client, approve requests (creating a linked event and starter tasks), reject them with a reason, or request changes. Decisions and quotations appear in the client's dashboard, with in-app notifications and email when delivery is configured.
- The planner Notifications center stores incoming client event requests and resubmissions, client messages, vendor-booking requests, and private-link approvals, change requests, and comments. Planners can follow each alert to its relevant request/event and mark notifications read. Clients also receive in-app notifications for planner messages and replies.
- The Clients workspace stores contact details and planner notes, tracks event requests, linked events, vendor bookings, communication, and manual payment records. Private event-specific links are also available as an optional sharing method for schedules and vendor statuses, aggregate budget totals, RSVP progress, timeline/vendor approvals or change requests, and comments. Approvals are tied to the current plan; later timeline/vendor changes make the prior approval appear outdated. Links can optionally require a 4–12 digit PIN and have an expiry; replacing or revoking a link invalidates the previous one. Approval names are self-reported and are not identity-verified. Client payment records are bookkeeping only and are not processed or gateway-verified by Nodevents.
- Planner, client, and vendor accounts have separate sign-in and create-account flows with role-scoped dashboards. Vendors can create their own account and publish a service profile; planners can also send vendor invitations that connect to an existing or newly created account. Attendee ticket registration does not create portal accounts.
- Event workspaces provide separate Event Registration, Tickets, Event-day Operations, and Reports pages alongside logistics and budgeting.
- Set an event budget and three-letter currency code on the event page.
- Add each vendor's fixed estimate and per-guest cost. Estimates use the RSVP headcount; invoices and paid amounts are shown alongside them.
- Add guests individually or as groups and record each RSVP as attending, declined, or awaiting. Until a guest list exists, per-guest estimates use the event's expected guest count.
- Keep budget, guest management, and catering management in separate sections on the event page; use its tool navigation to jump between them.
- Record each vendor's services for the event. The planner and that vendor can see the service description on their event pages.
- Vendor confirmations indicate availability for that event date. A decline indicates unavailable; a change request needs follow-up.
- Email guests a private RSVP link and an individual check-in QR code. A planner can scan the code from the event page or enter it manually; scanning requires browser camera support and permission.
- Catering quantities use attending RSVPs plus an adjustable extra allowance. Set recipe quantities and units per portion, adjust final quantities, download a CSV shopping list, or email requirements to an event caterer.
- Vendor accounts can request a password reset from the vendor sign-in page; reset links expire after one hour and can only be used once.
- Event Logistics records venue-map areas, team assignments, prioritized tasks, vendor contract terms/deadlines, and estimated versus actual expenses. Contract documents themselves should be kept in approved secure storage.
- Event Logistics can estimate driving distance and duration with the Google Routes API. Configure `GOOGLE_MAPS_ROUTES_API_KEY` in the ignored `nodevents/.env` file and enable the Routes API for the key. Origin and destination text entered for a lookup is sent from the server to Google; the API key is never sent to the browser or included in `.env.example`.
- Authenticated planner and client accounts can submit one 1–5 star Nodevents platform rating each. They can update their rating, and the public homepage displays the average and number of ratings. Ratings are about the platform, not individual events or vendors.
- Ticket registration supports custom questions, ticket categories, capacities, attendee records, emailed digital QR tickets, PDF download/printing, and one-time server-validated check-in. Tickets can use an event accent color and optional logo. Free tickets confirm immediately; external paid tickets stay pending until the organizer independently verifies payment. Clients see tickets in My Tickets when they register while signed in using the matching account email; attendee private ticket URLs remain available without an account.
- Event-day Operations tracks ticket and guest check-ins, vendor arrival/setup, meals served, incidents, and email announcements to confirmed attendees. Reports include attendance, confirmed ticket value, expenses, paid invoices, catering counts, and attendee feedback, with CSV export.
- M-Pesa Daraja STK Push is supported in Sandbox for paid KES tickets. Configure all the values below and use a publicly reachable HTTPS callback URL; localhost alone cannot receive Daraja callbacks. A callback is not treated as proof by itself: Nodevents checks the matching STK Push request with Daraja before issuing a ticket. Other payment methods still require independent organizer verification. Automated refunds and staff sign-in/accounts are not integrated.
- The Plans page describes monthly/annual subscriptions and planned M-Pesa, card, and bank-transfer methods. Billing is not connected, no payment details are collected, and no charges can be made from the app.

Guest names, email addresses, RSVP links, check-in codes, and detailed vendor financial/contact records are private to the planner account; they are not included in client event links or vendor invitations. Client event links expose only aggregate budget and RSVP totals, the event schedule, vendor names/statuses, and client-link approvals/comments. RSVP links, QR codes, and client event links are bearer credentials: share them only with the intended recipient. Catering amounts are planner-defined estimates, not standardized recipes or dietary guidance.

## M-Pesa Sandbox setup

1. Keep Daraja credentials in the ignored `nodevents/.env` file. Never put live keys in `.env.example` or commit them.
2. Set `MPESA_ENVIRONMENT=sandbox`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`, and `MPESA_SHORT_CODE`.
3. Generate a callback token with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set it as `MPESA_CALLBACK_TOKEN`.
4. Expose the local app through a trusted HTTPS tunnel or deploy it over HTTPS. Set `MPESA_CALLBACK_URL` to `https://<public-host>/payments/mpesa/callback/<MPESA_CALLBACK_TOKEN>` exactly; use the same path token in the URL.
5. Restart Nodevents. The public registration form offers STK Push only when all credentials and the HTTPS callback URL are valid and the event currency is KES. Daraja Sandbox simulation numbers do not charge a real account.

If a payment request times out, check the attendee's phone and Daraja status before resubmitting. A paid ticket is issued only after a successful STK Push query and matching amount/receipt callback. M-Pesa cancellation does not issue an external refund.

Production deployments must set a random `SESSION_SECRET` of at least 32 characters and serve the app over HTTPS. Sessions are stored in the local SQLite database; keep that database private and backed up securely. Planner and vendor sign-ins are limited to 10 failed attempts per IP per 15 minutes per app process; deployments with multiple instances should also apply rate limiting at the trusted proxy.

## Tests

```powershell
npm test
```

## Admin access

Register the planner account first, then promote it from the server's `nodevents` directory:

```powershell
node make-admin.js planner@example.com
```

Reload the app page to see the Admin link. The Admin page shows platform totals and lets admins suspend or restore planner accounts. Admin accounts cannot be suspended from that page.
