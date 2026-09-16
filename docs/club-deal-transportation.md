# Club Deal transportation

> Pickup now uses the contact form for all customers. The chat flow described in earlier delivery notes below has been retired; see [Pickup contact forms](pickup-contact-forms.md).

New Club Deals use free general admission. Public offer buttons say “Free Entry,” and pickup buttons say “Free Ride + Entry.” On Clubs feed cards, these are the two leading actions, with Free Entry highlighted; Directions appears alongside Club Page, Share, and Favorite below them.

The venue detail offer card also shows both options side by side, with the private-car/club-transport eligibility rule directly underneath. Free Entry preserves the complete offer chooser; Free Ride + Entry opens the pickup form with that venue’s active deal attached. The bottom Location section has a full-width Directions button above Follow and Share, with no duplicate pickup action.

Free Entry opens the offer and then asks how the guest will arrive: private car, free club transport, or rideshare/taxi. Free admission applies only to arrival in a private car or club-provided transport. Uber, Lyft, all other rideshares, and taxis are explicitly excluded. Selecting rideshare/taxi cannot prepare admission and clears a previous pending admission selection for the same venue. Guests can switch to requesting club transport.

Free Ride + Entry opens `/rides/[venueId]` directly to the same pickup form with the venue’s active admission offer attached. A successful request saves the same cashier admission selection as the shuttle choice reached through Free Entry; the guest does not need to claim the offer separately. Dancer profile and feed ride links retain the exact deal and signed dancer attribution when available. Requested deals must belong to the active, published venue. If no active admission offer exists, the ride page explicitly explains that entry is unavailable and provides a ride-only fallback without creating admission. These controls do not open Uber or record an Uber click.

## Pickup chat from Free Ride + Entry

Both `/rides/[venueId]` and the club-transport choice under Free Entry use the existing Club Pickup request form when the venue's computed `club_pickup_available` is true. This requires venue opt-in, publication and an active venue owner. Owners/managers enable chat through **Pickup Requests → Club Pickup settings**. This integration does not enable venues automatically.

Customers sign in, supply their pickup location and party size, and accept the existing chat notice. Submitting creates or reuses the authorized request through `/api/pickups`, then opens `/pickups/[requestId]` for messages and live pickup status. Venue owners/managers receive the existing private pickup notifications and open the same conversation from their dashboard. The ride remains unconfirmed until the venue accepts. Sign-in returns directly to the ride form with the original deal and dancer attribution.

After successful request creation, the same 12-hour cashier admission selection is saved with the returned `pickupRequestId`, keeping deal and dancer attribution intact. Chat IDs are separate from legacy `shuttleRequestId` values. Failed requests do not save admission. If browser storage fails after a request succeeds, customers can retry saving without sending another request or open the conversation immediately. Ride-only requests create no admission selection.

Integration validation covers both entry points, authenticated consent and sign-in continuation, request retries, admission-storage recovery, ride-only behavior and the phone fallback. The mobile component runner exercises the actual ride form and chat in Android/Chromium and iPhone/WebKit emulation at 320, 393 and 1280 pixels, using synthetic requests rather than notifying real venues.

## Phone handoff for venues without pickup chat

Venues without chat enabled retain the existing phone handoff, explicitly identified on the request and confirmation screens. These shuttle requests require a name, pickup location, party size, contact phone number, and email address with explicit consent to share these details with the selected club. All five fields are included in the manager's request. The server resolves the venue from the active deal, restricts recipients to its active owner and managers, and writes private `support_message` notifications with `payload.kind = club_shuttle_request`. Existing private notification access applies. Same-origin JSON enforcement, bounded input, and atomic IP/phone rate limits protect this public endpoint. No guest contact details are stored in browser storage or URLs.

The club contacts the guest and handles availability, pickup and transportation. MyDancr sends the manager a notification headed “MyDancr: free shuttle requested,” with the guest's name, pickup location, party size, phone and email, and asks the club to arrange pickup. The customer sees “Pickup requested” and “Awaiting club confirmation,” with an explicit explanation that the ride is not booked yet. The customer confirmation does not ask the guest to call the club.

Admission selection is valid for 12 hours and still requires the physical cashier tap. Staff must verify actual arrival in a private car or club-provided transport before admitting the guest for free; the transportation and cashier screens display this requirement. Selecting a transportation method or sending a pickup request is not proof of actual arrival. Storage recovery after an accepted pickup request saves the admission selection without sending a duplicate request.

The shuttle option always opens the pickup-details form, including for unlinked demo venues. Guests can return to the transportation choices before submitting. The standalone Free ride page opens the same form directly. Without an active linked owner account, the form explains that requests cannot be sent and disables submission; details are not saved or transmitted. The server rechecks the active linked owner before accepting a request. Eligible active managers on the venue team also receive the request.

OneSignal is not configured at this release. Requests reach the venue's MyDancr notification inbox. Push requires `NEXT_PUBLIC_ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY`, plus the manager's opted-in device subscription. Texts to the venue's existing `venues.phone` require those settings, a configured OneSignal SMS provider, and `ONESIGNAL_SMS_FROM`. The stored phone must support SMS. The endpoint reports provider acceptance separately from the durable inbox handoff; acceptance is not proof of delivery or pickup confirmation. API failures never fabricate acceptance.

Notification IDs and OneSignal idempotency keys are deterministic for each submitted request and recipient. Retries in the same form reuse the request and details. Delivery does not notify followers or unrelated venue staff.

The OneSignal integration follows its [SMS API](https://documentation.onesignal.com/reference/sms) and [idempotent request documentation](https://documentation.onesignal.com/reference/idempotent-notification-requests).

To update the existing live catalog, inspect with `node --env-file=.env.local scripts/update-club-deal-transportation.mjs`. Use `--apply --backup <new-private-local-file>` to apply the reviewed change. It retains venue rules, snapshots existing valid issued passes, preserves financial fields and deal IDs, and refuses to overwrite a concurrently changed deal. This does not replay or modify migration history.
