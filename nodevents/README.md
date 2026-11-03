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
- The site navigation links to My Events and, for planners with events, the event's Guest Management, Catering Management, and Budget Planner sections.
- The Clients workspace stores contact details and planner notes, tracks event requests, linked events, vendor bookings, messages, and manual payment records. Planners can invite a client to a role-scoped portal account using the same `users` account table; invitations expire after seven days and can only claim the matching client email. Clients can request events, view progress/bookings/payments, update their name and phone, and message their planner. In demo mode invitation URLs are shown to the planner because email is not delivered. Client payment records are bookkeeping only and are not processed or gateway-verified by Nodevents.
- Planner and client roles use the shared account login. Existing vendor sign-in remains on the legacy vendor-account flow, and attendee ticket registration does not create portal accounts.
- Event workspaces also provide Event Logistics, Registration & Tickets, Event-day Operations, and Reports pages.
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
- Ticket registration supports custom questions, ticket categories, capacities, attendee records, digital QR tickets, and one-time check-in. Free tickets confirm immediately; external paid tickets stay pending until the organizer independently verifies payment.
- Event-day Operations tracks ticket and guest check-ins, vendor arrival/setup, meals served, incidents, and email announcements to confirmed attendees. Reports include attendance, confirmed ticket value, expenses, paid invoices, catering counts, and attendee feedback, with CSV export.
- M-Pesa Daraja STK Push is supported in Sandbox for paid KES tickets. Configure all the values below and use a publicly reachable HTTPS callback URL; localhost alone cannot receive Daraja callbacks. A callback is not treated as proof by itself: Nodevents checks the matching STK Push request with Daraja before issuing a ticket. Other payment methods still require independent organizer verification. Automated refunds and staff sign-in/accounts are not integrated.
- The Plans page describes monthly/annual subscriptions and planned M-Pesa, card, and bank-transfer methods. Billing is not connected, no payment details are collected, and no charges can be made from the app.

Guest names, email addresses, RSVP links, check-in codes, and budget estimates are private to the planner account; they are not included in vendor invitations or read-only host links. RSVP links and QR codes are bearer credentials: share them only with the intended guest. Catering amounts are planner-defined estimates, not standardized recipes or dietary guidance.

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
