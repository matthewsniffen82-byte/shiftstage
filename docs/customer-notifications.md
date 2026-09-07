# Customer notification delivery

Customers manage notification preferences in **Dashboard → Alerts**. Changes are saved on their account. The master follow-alert switch pauses the four follow event types without replacing individual choices. Each type gates new in-app alerts and its email/push copies. Existing inbox items remain visible. Email and push are separate, explicit opt-ins; transactional account-security email remains independent.

## Provider configuration

The customer profile endpoint reports delivery availability from server configuration. Unavailable channels explain their status and cannot be newly enabled. No provider keys belong in browser code.

- Email: configure `RESEND_API_KEY` and `EMAIL_FROM` in Vercel. Verify the sending domain in Resend.
- Push: configure `NEXT_PUBLIC_ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` in Vercel. Configure the matching HTTPS site origin in OneSignal and enable web push.
- Redeploy after environment changes. Browser permission and a confirmed subscription are required before the push preference saves as enabled.

The OneSignal worker is served at `/push/onesignal/OneSignalSDKWorker.js` with scope `/push/onesignal/`. It must remain separate from the application's root service worker. Keep OneSignal's dashboard service-worker settings aligned with these paths. Automatic prompts are disabled; enrollment starts only from the customer's action.

Customer external IDs are account-specific HMAC aliases derived on the server, not public customer UUIDs. Rotating the OneSignal REST key changes these aliases; customers must enable push again on their devices afterward. Signing out unsubscribes this browser without changing the account's preference on other devices.

On iOS/iPadOS, customers may need to add MyDancr to the Home Screen and open the installed app before enabling web push. Browser/site permission blocks are explained in the interface.

## Verification

Automated tests mock provider requests and browser permission; they do not send real email or push. After connecting provider accounts, verify delivery with an explicitly authorized test recipient. Environment availability alone does not verify a provider's domain, subscription, credentials, or delivery outcome.

References: [OneSignal web setup](https://documentation.onesignal.com/docs/en/web-sdk-setup), [Web SDK reference](https://documentation.onesignal.com/docs/en/web-sdk-reference).
