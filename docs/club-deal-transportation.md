# Club Deal transportation

New Club Deals use free general admission. Guests must choose a private car outside of an Uber or taxi, or request the club's free shuttle. Both public deal interfaces and campaign links open the same transportation page. A transportation choice is saved before the existing physical cashier tap can proceed.

Every former “Get a Ride” control now says “Free ride” and opens `/rides/[venueId]` directly to the same pickup form. Standalone ride requests work independently of a Club Deal and do not create an admission selection. These controls no longer open Uber or record an Uber click. The shared service verifies that the selected venue is active and published for both entry points.

Shuttle requests require a name, pickup location, party size, contact phone number, and email address with explicit consent to share these details with the selected club. All five fields are included in the manager's request. The server resolves the venue from the active deal, restricts recipients to its active owner and managers, and writes private `support_message` notifications with `payload.kind = club_shuttle_request`. Existing private notification access applies. Same-origin JSON enforcement, bounded input, and atomic IP/phone rate limits protect this public endpoint. No guest contact details are stored in browser storage or URLs.

The club contacts the guest and handles availability, pickup and transportation. MyDancr sends the manager a notification headed “MyDancr: free shuttle requested,” with the guest's name, pickup location, party size, phone and email, and asks the club to arrange pickup. A submitted request is not a confirmed ride. The customer confirmation does not ask the guest to call the club.

The shuttle option is unavailable until the venue has an active linked owner account to receive requests. This is checked on the page and checked again at submission; unlinked demo venues do not collect pickup details. Eligible active managers on the venue team also receive the request.

OneSignal is not configured at this release. Requests reach the venue's MyDancr notification inbox. Push requires `NEXT_PUBLIC_ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY`, plus the manager's opted-in device subscription. Texts to the venue's existing `venues.phone` require those settings, a configured OneSignal SMS provider, and `ONESIGNAL_SMS_FROM`. The stored phone must support SMS. The endpoint reports provider acceptance separately from the durable inbox handoff; acceptance is not proof of delivery or pickup confirmation. API failures never fabricate acceptance.

Notification IDs and OneSignal idempotency keys are deterministic for each submitted request and recipient. Retries in the same form reuse the request and details. Delivery does not notify followers or unrelated venue staff.

The OneSignal integration follows its [SMS API](https://documentation.onesignal.com/reference/sms) and [idempotent request documentation](https://documentation.onesignal.com/reference/idempotent-notification-requests).

To update the existing live catalog, inspect with `node --env-file=.env.local scripts/update-club-deal-transportation.mjs`. Use `--apply --backup <new-private-local-file>` to apply the reviewed change. It retains venue rules, snapshots existing valid issued passes, preserves financial fields and deal IDs, and refuses to overwrite a concurrently changed deal. This does not replay or modify migration history.
