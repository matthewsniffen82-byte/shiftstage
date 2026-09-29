# Customer notification delivery

Customers manage notification preferences in **Dashboard → Alerts**. Changes are saved on their account. The master follow-alert switch pauses the four follow event types without replacing individual choices. Each type gates new in-app alerts and its email/push copies. Existing inbox items remain visible. Email and push are separate, explicit opt-ins; transactional account-security email remains independent.

## Provider configuration

The customer profile endpoint reports delivery availability from server configuration. Unavailable channels explain their status and cannot be newly enabled. No provider keys belong in browser code.

- Email: configure `RESEND_API_KEY` and `EMAIL_FROM` in Vercel. Verify the sending domain in Resend.
- Push: configure `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_VAPID_SUBJECT` in Vercel. Generate a pair once using `web-push.generateVAPIDKeys()` in a trusted local process; store the private key only in server environment settings. Use an HTTPS contact URL or mailto address for the subject. No OneSignal account is needed. Apply `20260929070000_direct_web_push.sql` before deploying.
- Redeploy after environment changes. Browser permission and a confirmed subscription are required before the push preference saves as enabled.

The direct worker is served at `/push/web/worker.js` with scope `/push/web/`, separate from the application’s root service worker. Enrollment starts only from a user tap. The old OneSignal worker is retired and existing devices must enroll again.

## Contextual invitations

A shared, dismissible card offers **Enable notifications** and **Not now** after successful actions:

- Customers: following a dancer or club, requesting pickup, and entering their active pickup conversation. Phone-only pickup receipts explain that the club follows up by phone; they do not promise chat push updates.
- Dancers: submitting their profile for review and posting an upcoming shift.
- Venues: opening their connected dashboard, publishing their venue page, enabling pickup, and opening or sending a message in a customer pickup chat.

No browser permission is requested until **Enable notifications** is tapped. Each reason is shown once per account and browser. Dismissal suppresses other ordinary invitations for 24 hours; a new pickup/chat reason may appear after 10 minutes. Blocked permissions, existing subscriptions, unsupported browsers, and unconfigured push suppress automatic invitations. Home Screen installation guidance is shown on iOS where needed. Manual notification settings remain available after dismissal. A shared enrollment guard prevents duplicate permission and subscription attempts between contextual invitations and dashboard preferences.

Pickup chat, inbox, and dashboard controls check server availability before offering enrollment. When push is unavailable, they explain that users should check Pickup chats for messages; a failed availability check offers a retry. Manual settings omit the Enable button when the provider is unavailable, while an existing device subscription can still be turned off. These states do not claim alerts will arrive while the user is away.

Customer enrollment saves only the push delivery preference, after confirming the device subscription. Other alert choices are preserved. Venue/dancer enrollment stores a native browser subscription for the verified caller. Guest pickup chats remain account-free and receive updates in the open chat; they do not enroll the browser under another signed-in account.

After authorized pickup creation, messages, and status changes, the server forwards newly persisted pickup notices to the existing push delivery service. This includes venue notices from guest pickup requests. Customer opt-in preferences still apply. Provider calls run after the successful response, use the notice UUID for deduplication, and contain generic copy and an authenticated conversation link. Chat text, guest contact information, and private guest-return keys are excluded. This is best-effort delivery, not a durable retry queue; provider configuration and a live opted-in subscription are still required.

The authenticated `/api/push/subscriptions` endpoint derives the account from the verified session, validates browser-service endpoints and encryption keys, and caps each account at 12 devices. Subscription URLs, encryption keys and per-device acceptance receipts are service-role-only database records. The browser receives only its own subscription hashes and the public VAPID key. Rotating the VAPID pair requires re-enrollment. Signing out unsubscribes this browser and clears its worker account without changing preferences on other devices. The worker rejects another account’s payloads, expired alerts and repeat message IDs; notification links stay on the app origin.

Android browsers with web push support can enable notifications directly from the signed-in app. iPhone/iPad requires iOS/iPadOS 16.4 or later: in Safari, use Share → Add to Home Screen, open that icon, sign in, and tap Enable notifications. The interface explains these steps before enrollment. Desktop-mode iPads and Safari's standalone indicator are recognized. Guest chats do not enroll for push.

The manifest supplies PNG icons at 192px and 512px; both the discovery shell and Next pages use a 180px Apple touch icon. Run `node scripts/generate-app-icons.mjs` after changing the existing SVG artwork, then regenerate the static asset versions. Push payloads are encrypted with the browser subscription keys and signed with VAPID before delivery to the browser’s push service. Accepted device deliveries are recorded for retry deduplication; 404/410 subscriptions and their receipts are deleted. Receipts for active subscriptions may be pruned after seven days using `delete from public.web_push_receipts where delivered_at < now() - interval '7 days'` (service role only).

## Verification

Automated tests mock provider requests and browser permission; they do not send real email or push. After configuring delivery, verify receipt with an explicitly authorized test recipient. Environment availability alone does not verify a provider's domain, subscription, credentials, or delivery outcome.

References: [Web Push library](https://github.com/web-push-libs/web-push), [Push subscriptions](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe), [Apple Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
