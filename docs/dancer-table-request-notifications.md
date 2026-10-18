# Dancer table request notifications

New Internal table requests atomically create one dancer inbox notification and separate email/push jobs in `dancer_table_request_deliveries`. The requested dancer is resolved from the stored profile owner, never a client-supplied recipient. Existing staff notifications and staff request management are unchanged. Historical requests are not backfilled.

- Messages include the table label and club name, with a link to `/dashboard/dancer#dancer-notifications`. No guest contact details or table capability token is included.
- Email uses the active account's stored `app_users.email` and the existing `RESEND_API_KEY` / `EMAIL_FROM` configuration. Push uses existing registered devices and VAPID configuration. Missing push configuration does not block email.
- The request API starts delivery after responding. The existing minute-based `internal-request-push` cron recovers failures. Each channel has its own receipt, five-attempt cap, expiring lease and exponential retry delay. Dancer email retries use a stable Resend idempotency key.
- Claiming rechecks active dancer ownership, the table link and internal roster membership. Pending and staff-acknowledged requests remain eligible for ten minutes. Completed, cancelled, expired and revoked requests are not delivered late. Completion/cancellation updates an existing inbox item without restoring a cleared item.
- Table requests are operational alerts, independent of optional activity preferences. Push still requires the dancer to explicitly enable it on each device. Dashboard entry offers setup once per account/device, including during onboarding. The prompt and notification settings explain that email-app notifications must be enabled in the phone's own settings; the site cannot change those settings.
- The dancer inbox refreshes every 15 seconds while the page is visible and on focus. No background browser permission prompt is used.

## Deployment And Verification

Migration `20261018043831_dancer_table_request_notifications.sql` was applied to the existing Dancr project (`hfmzwadzabmgxkjzmqun`). The local filename matches the version assigned by the migration service. Queue access and claim/finish functions are service-only; RLS is enabled and browser roles have no grants. The trigger function is not directly executable by API roles.

Focused PGlite, worker, email, API, invitation and component tests use synthetic data only. No live test notifications or E2E browser journeys are used. The security advisor's new `rls_enabled_no_policy` informational item is intentional for this service-only queue; all existing warning counts are unchanged. See the [Supabase RLS advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
