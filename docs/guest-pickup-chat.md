# Guest pickup chat

Customers can request and use pickup chat without signing in. At a club with pickup chat enabled, **Request pickup** sends the request and opens chat for guests and signed-in customers. Phone follow-up remains available through **Request by phone instead** and at clubs without pickup chat enabled.

The compact form shows pickup location and party size first. **Add pickup details (optional)** expands the meeting spot and note fields. A short notice explains message storage and review beside the required consent checkbox; **Pickup & chat terms** expands the full existing transport and chat notices, plus admission rules when entry is included. The form states that the club still needs to confirm the ride.

## Guest experience

- The request records the chat notice consent and opens the conversation immediately. Guests can message the club, receive replies, cancel, report, and confirm arrival through customer actions.
- A cryptographically random private link identifies one conversation. It is saved on the device and can be copied from the chat. `/pickups` lists the guest links saved on that device. A copied link works on another device without an account.
- Requests close after the existing 12-hour coordination window. Private guest access expires 30 days after creation. Clearing device storage requires reopening the saved private link; blocked storage still allows the current page to display and copy its link.
- Guest conversations check for replies every five seconds while visible and refresh when connectivity or page visibility returns. Keep the page open for replies. Account conversations retain their existing realtime subscription.

## Access and data

Migration `20260915180000_guest_pickup_chat.sql` adds a private capability table and permits guest identities on existing pickup requests, messages, and reports. No account is created. Existing staff inboxes, consent, authorization, audit records, notifications, and status controls handle guest requests.

Only SHA-256 capability hashes are stored in the database. The browser sends the random key in `x-pickup-guest-key`; return URLs carry it in a fragment, which HTTP requests and referrers omit. Responses are private and uncached. Anyone possessing the link can act as that conversation's guest.

Guest service RPCs accept only fixed, scoped operations and check the key and expiration on every call. No anonymous table access, public pickup RLS policy, account impersonation, or general service write grant is introduced. Account requests with failed authentication never fall back to guest access. Signed-in retry checks explicitly reject NULL guest customer IDs.

Creation limits use a server-generated HMAC of the client address and an atomic five-requests-per-hour limit. Retries retain their request ID and key. Messages retain UUID retry semantics and the existing twelve-per-minute limit. Guest reports and arrival evidence are recorded once, and guests cannot accept, dispatch, complete, or write admin notes. Guest arrival remains reported evidence; this change does not create automatic NFC attribution for anonymous customers.

## Validation

- PostgreSQL integration tests cover guest isolation, account/venue access, consent, retries, spoofing, disabled venues, limits, messages, replies, reporting, transitions, closure, and expired keys.
- API tests cover bounded validation, hashed credentials, scoped RPC arguments, invalid-auth rejection, and browser link persistence with blocked storage.
- Existing pickup authorization, attribution, entry-point, and phone-inbox regression tests run alongside the guest tests.
- Android and iPhone component browser checks cover guest request/chat/reload/link recovery, replies, private-key rejection, optional phone requests, staff inboxes, and mobile layout at 320/393/1280px.
- Focused TypeScript, ESLint, migration-history validation, and a rollback rehearsal against the production schema precede deployment. The public smoke script verifies signed-out pages and access denial without submitting a real request.
