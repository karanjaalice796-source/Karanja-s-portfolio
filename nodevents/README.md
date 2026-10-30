# Nodevents

Nodevents helps planners discover participating event-service vendors and coordinate their events.

## Run locally

Use Node.js 22.5 or later:

```powershell
npm start
```

The app is available at `http://localhost:3100`. SQLite creates or upgrades `data.db` when the server starts.

## Planner tools

- The public home page introduces Nodevents; Browse Events uses the built-in event templates, and Find Vendors searches profiles published by vendor accounts.
- Vendors can publish and edit their own searchable directory profile from Vendor Profile. A planner can invite a directory vendor to an event; this creates a private vendor invitation and links the invitation to the vendor account.
- The site navigation links to My Events and, for planners with events, the event's Guest Management, Catering Management, and Budget Planner sections.
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
- Ticket registration supports custom questions, ticket categories, capacities, attendee records, digital QR tickets, and one-time check-in. Free tickets confirm immediately; paid tickets stay pending until the organizer independently verifies an external payment reference.
- Event-day Operations tracks ticket and guest check-ins, vendor arrival/setup, meals served, incidents, and email announcements to confirmed attendees. Reports include attendance, confirmed ticket value, expenses, paid invoices, catering counts, and attendee feedback, with CSV export.
- Paid ticket processing, M-Pesa/bank checkout, automated refunds, staff accounts, and payment-provider callbacks are not integrated. Never confirm a paid ticket unless payment has been independently verified; cancellation does not issue an external refund.
- The Plans page describes monthly/annual subscriptions and planned M-Pesa, card, and bank-transfer methods. Billing is not connected, no payment details are collected, and no charges can be made from the app.

Guest names, email addresses, RSVP links, check-in codes, and budget estimates are private to the planner account; they are not included in vendor invitations or read-only host links. RSVP links and QR codes are bearer credentials: share them only with the intended guest. Catering amounts are planner-defined estimates, not standardized recipes or dietary guidance.

## Admin access

Register the planner account first, then promote it from the server's `nodevents` directory:

```powershell
node make-admin.js planner@example.com
```

Reload the app page to see the Admin link. The Admin page shows platform totals and lets admins suspend or restore planner accounts. Admin accounts cannot be suspended from that page.
