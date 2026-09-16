# Guest pickup chat

Customers can request and use pickup chat without signing in. At a club with pickup chat enabled, **Request pickup** sends the request and opens chat for guests and signed-in customers. Phone follow-up remains available through **Request by phone instead** and at clubs without pickup chat enabled.

The compact form shows pickup location and party size first. **Add pickup details (optional)** expands the meeting spot and note fields. A short notice explains message storage and review beside the required consent checkbox; **Pickup & chat terms** expands the full existing transport and chat notices, plus admission rules when entry is included. The form states that the club still needs to confirm the ride.

## Guest experience

- The request records the chat notice consent and opens the conversation immediately. Guests can message the club, receive replies, cancel, report, and confirm arrival through customer actions.
- Conversations focus on messages and pickup details without a ride-progress tracker. Optional status controls are collapsed below chat for both customers and venues. Closed chats explain why messaging ended and keep their history available for review.
- A cryptographically random private link identifies one conversation. It is saved automatically in the browser. `/pickups` lists the guest links saved on that device; customers return through the homepage navigation without a save-link box inside the conversation. A private URL copied from the browser address bar still works on another device without an account.
- Signed-out visitors with a saved guest chat see **Your Pickup chats** beside **Login / Join** in the homepage header (**Pickup chats** on mobile). It opens `/pickups` and refreshes when returning to the homepage or when saved chats change in another tab. The shortcut stays hidden if no valid, unexpired links are saved in this browser.
- A numeric badge totals unread venue replies across those saved chats. It checks every 15 seconds while the homepage is visible and refreshes when another tab records a successful read. Opening the homepage or pickup inbox does not mark messages read. The badge hides at zero (or if its count cannot be refreshed); the chat shortcut remains available. Totals above 99 display **99+**, with the exact total in the accessible label and tooltip.
- Requests close after the existing 12-hour coordination window. Private guest access expires 30 days after creation. Clearing device storage requires reopening the private link; blocked storage still allows the current page to use the link in its address bar.
- Guest conversations check for replies every five seconds while visible and refresh when connectivity or page visibility returns. Keep the page open for replies. Account conversations retain their existing realtime subscription.
- Active customer chats remind users to watch for club replies and arrange confirmation in the chat. For signed-out guests whose chat was saved, the reminder explains that **Pickup chats** in the homepage's top navigation displays the number of new club messages and reopens their chats. Blocked storage keeps the existing bookmark/open-page fallback; signed-in guests receive the direct pickup-chat link without promising a signed-out navigation badge.

## Access and data

Migration `20260915180000_guest_pickup_chat.sql` adds a private capability table and permits guest identities on existing pickup requests, messages, and reports. No account is created. Existing staff inboxes, consent, authorization, audit records, notifications, and status controls handle guest requests.

Only SHA-256 capability hashes are stored in the database. The browser sends the random key in `x-pickup-guest-key`; return URLs carry it in a fragment, which HTTP requests and referrers omit. Responses are private and uncached. Anyone possessing the link can act as that conversation's guest.

Guest service RPCs accept only fixed, scoped operations and check the key and expiration on every call. No anonymous table access, public pickup RLS policy, account impersonation, or general service write grant is introduced. Account requests with failed authentication never fall back to guest access. Signed-in retry checks explicitly reject NULL guest customer IDs.

Migration `20260916010000_guest_pickup_unread_count.sql` adds a read-only, service-only counter. `/api/pickups/guest-unread` accepts at most 50 private capabilities in a bounded POST body, hashes keys before database access, and returns only the combined count with `private, no-store`. It excludes expired or mismatched capabilities, customer messages, and system messages; it does not change read receipts or conversation status.

Creation limits use a server-generated HMAC of the client address and an atomic five-requests-per-hour limit. Retries retain their request ID and key. Messages retain UUID retry semantics and the existing twelve-per-minute limit. Guest reports and arrival evidence are recorded once, and guests cannot accept, dispatch, complete, or write admin notes. Guest arrival remains reported evidence; this change does not create automatic NFC attribution for anonymous customers.

## Validation

- PostgreSQL integration tests cover guest isolation, account/venue access, consent, retries, spoofing, disabled venues, limits, messages, replies, reporting, transitions, closure, and expired keys.
- API tests cover bounded validation, hashed credentials, scoped RPC arguments, invalid-auth rejection, and browser link persistence with blocked storage.
- Existing pickup authorization, attribution, entry-point, and phone-inbox regression tests run alongside the guest tests.
- Android and iPhone component browser checks cover guest request/chat/reload/link recovery, replies, private-key rejection, optional phone requests, staff inboxes, and mobile layout at 320/393/1280px.
- Focused TypeScript, ESLint, migration-history validation, and a rollback rehearsal against the production schema precede deployment. The public smoke script verifies signed-out pages and access denial without submitting a real request.
