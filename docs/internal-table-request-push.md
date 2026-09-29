# Internal table request push

A customer opens a table QR link and chooses **Request at our table** for an available dancer. The existing request transaction also queues push jobs for that club's active owner, managers and staff (hosts use staff accounts). No alert is sent to the dancer or customer, and scanning without submitting a request does not notify staff.

The notification is **MyDancr Internal — Table 12 wants Aster.** It uses the saved table label and dancer stage name. It opens `/dashboard/venue#table-requests`, which requires the recipient's venue login and opens the roster section at its request inbox. QR tokens, guest information and private profile links never appear in the provider payload. The authenticated inbox remains the source of truth.

Staff enable **Phone alerts → Enable table alerts** inside the internal request inbox (also embedded in Dancers & tables on the club dashboard). Enrollment needs both browser permission and a confirmed device subscription before saving `pushEnabled` and `tableRequests`. The venue master alert switch is respected. Turning off table alerts preserves other notification categories. The setting applies to the staff member's account; every receiving device must be separately enrolled. Customer QR pages never offer enrollment.

- iPhone/iPad: iOS/iPadOS 16.4+, add MyDancr to the Home Screen, open that icon, sign in and tap Enable table alerts. Permission must follow a user tap.
- Android: use a browser supporting web push over HTTPS, sign in and enable alerts. Browser/OS notification settings must allow them.
- Unavailable configuration, denied permissions, failed subscriptions and failed preference saves are shown without claiming delivery is enabled.

## Delivery and operations

Apply `20260928190000_internal_table_request_push.sql` before deploying the route. It adds only the private queue, insert trigger and service-role-only claim/finish functions. It does not backfill old requests. Queue creation and request creation commit together. Also apply `20260929070000_direct_web_push.sql` for the private browser subscription registry. A stable message UUID, per-device acceptance receipts and worker deduplication protect retries from repeated alerts.

Next.js `after` starts an immediate delivery attempt. An authenticated Vercel cron at `/api/cron/internal-request-push` runs every minute to recover interrupted or failed attempts. Claims use `FOR UPDATE SKIP LOCKED`, 90-second leases, up to five attempts and bounded backoff. Each claim rechecks current staff access, active table link, dancer availability, pending status and the ten-minute request deadline. Seen/completed/cancelled requests and revoked access are skipped. Fresh account preferences gate each send. Provider notifications have a 60-second offline TTL so delayed delivery is limited. Already accepted phone notifications cannot be recalled when a request changes.

Required production environment: `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`, and the existing `CRON_SECRET`. The direct worker uses `/push/web/worker.js`, scope `/push/web/`. Keep the VAPID private key server-side. No OneSignal account or SDK is required. See [customer notification configuration](customer-notifications.md) for enrollment, key generation and rotation.

The queue records `pending`, `sending`, `sent`, `skipped`, or `failed`. Here `sent` means at least one browser push service accepted the encrypted notification, with no remaining transient device failures; it does not prove a phone displayed or a person read it. The cron returns 503 for missing configuration or a worker failure. Inspect only queue counts/state for routine monitoring; tokens and provider response bodies are not logged. For a launch acceptance test, enroll an authorized manager/host on an actual iPhone Home Screen app and Android browser, submit a test table request, confirm the table/name notification with the app backgrounded, and confirm its link opens the authenticated inbox. Automated browser/API/database tests do not substitute for physical device receipt.

References: [Apple Web Push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Web Push encryption and VAPID](https://github.com/web-push-libs/web-push).
