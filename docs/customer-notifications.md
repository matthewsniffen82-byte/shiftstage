# Customer notification delivery

Customers manage notification preferences in **Dashboard → Alerts**. Changes are saved on their account. The master follow-alert switch pauses the four follow event types without replacing individual choices. Each type gates new in-app alerts and its email/push copies. Existing inbox items remain visible. Email and push are separate, explicit opt-ins; transactional account-security email remains independent.

## Provider configuration

The customer profile endpoint reports delivery availability from server configuration. Unavailable channels explain their status and cannot be newly enabled. No provider keys belong in browser code.

- Email: configure `RESEND_API_KEY` and `EMAIL_FROM` in Vercel. Verify the sending domain in Resend.
- Push: configure `NEXT_PUBLIC_ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` in Vercel. Configure the matching HTTPS site origin in OneSignal and enable web push.
- Redeploy after environment changes. Browser permission and a confirmed subscription are required before the push preference saves as enabled.

The OneSignal worker is served at `/push/onesignal/OneSignalSDKWorker.js` with scope `/push/onesignal/`. It must remain separate from the application's root service worker. Keep OneSignal's dashboard service-worker settings aligned with these paths. Automatic prompts are disabled; enrollment starts only from the customer's action.

## Contextual invitations

A shared, dismissible card offers **Enable notifications** and **Not now** after successful actions:

- Customers: following a dancer or club, requesting pickup, and entering their active pickup conversation. Phone-only pickup receipts explain that the club follows up by phone; they do not promise chat push updates.
- Dancers: submitting their profile for review and posting an upcoming shift.
- Venues: opening their connected dashboard, publishing their venue page, enabling pickup, and opening or sending a message in a customer pickup chat.

No browser permission is requested until **Enable notifications** is tapped. Each reason is shown once per account and browser. Dismissal suppresses other ordinary invitations for 24 hours; a new pickup/chat reason may appear after 10 minutes. Blocked permissions, existing subscriptions, unsupported browsers, and unconfigured push suppress automatic invitations. Home Screen installation guidance is shown on iOS where needed. Manual notification settings remain available after dismissal. The shared SDK state prevents duplicate initialization between a contextual invitation and dashboard preferences.

Customer enrollment saves only the push delivery preference, after confirming the device subscription. Other alert choices are preserved. Venue/dancer enrollment uses the verified caller's existing opaque push alias. Guest pickup chats remain account-free and receive updates in the open chat; they do not enroll the browser under another signed-in account.

After authorized pickup creation, messages, and status changes, the server forwards newly persisted pickup notices to the existing push delivery service. This includes venue notices from guest pickup requests. Customer opt-in preferences still apply. Provider calls run after the successful response, use the notice UUID for deduplication, and contain generic copy and an authenticated conversation link. Chat text, guest contact information, and private guest-return keys are excluded. This is best-effort delivery, not a durable retry queue; provider configuration and a live opted-in subscription are still required.

Customer external IDs are account-specific HMAC aliases derived on the server, not public customer UUIDs. Rotating the OneSignal REST key changes these aliases; customers must enable push again on their devices afterward. Signing out unsubscribes this browser without changing the account's preference on other devices.

On iOS/iPadOS, customers may need to add MyDancr to the Home Screen and open the installed app before enabling web push. Browser/site permission blocks are explained in the interface.

## Verification

Automated tests mock provider requests and browser permission; they do not send real email or push. After connecting provider accounts, verify delivery with an explicitly authorized test recipient. Environment availability alone does not verify a provider's domain, subscription, credentials, or delivery outcome.

References: [OneSignal web setup](https://documentation.onesignal.com/docs/en/web-sdk-setup), [Web SDK reference](https://documentation.onesignal.com/docs/en/web-sdk-reference).
