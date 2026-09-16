# Pickup contact forms

Pickup chat is retired. The public ride and free-entry pages use the existing contact form for every customer, without sign-in or push enrollment.

The form requires name, pickup location, guest count, phone, email, and permission to share the details with the selected club. `/api/venues/[venueId]/shuttle` and `/api/deals/[dealId]/shuttle` validate bounded input, origin, rate limits, current venue publication and active owner/manager recipients. The durable receipt and manager notification handoff must succeed before the customer sees confirmation. Retrying the same request does not send duplicate alerts.

Managers open **Pickup Requests** from their dashboard to see customer contact details, with call and email links. Current owner/manager authorization is checked before reading receipts; customers and ordinary staff cannot read the manager inbox. Admins can review contact submissions. Submitting the form does not confirm a ride; the club contacts the customer directly to arrange it. Push/SMS manager alerts are optional provider-dependent extras; the saved manager inbox is the delivery record.

## Retirement

- Removed conversation UI, guest recovery links, homepage unread badge/polling, chat settings, customer chat dashboard entries, and chat push invitations/delivery.
- Old conversation pages explain the replacement. Old chat creation, messaging, status, settings mutations and guest-unread APIs return `410` with `no-store`.
- Migration `20260916020000_retire_pickup_chat.sql` revokes all chat table/sequence access and chat RPC execution for public, anonymous, authenticated and service roles. Only the two read-only account/venue helpers used by the contact inbox remain callable by authenticated users.
- The migration disables venue chat flags, prevents re-enabling them, removes chat realtime publication and disconnects the chat arrival trigger. Existing chat history is retained, inaccessible through the site. No historical messages, consent, reports or audit records are purged.
- Historical migration files remain intact; their original SQL regression tests describe the pre-retirement schema. New retirement tests validate the final lockdown.

## Delivery order and verification

Deploy the application first, then apply the new migration and record its version in `supabase_migrations.schema_migrations`. Old builds select the now-unused computed chat availability field, so revoking that function before the application deploy could interrupt discovery.

Focused checks cover contact form delivery, authorization, replay protection, retired API responses and PostgreSQL permissions. `scripts/test-club-pickup-ui.mjs` exercises actual React components with synthetic responses in Android/Chromium and iPhone/WebKit, including narrow layouts, retries, manager pagination and logout. `scripts/verify-club-pickup-public.mjs` checks the deployed pages and retired endpoints without submitting real pickup requests or sending notifications.
