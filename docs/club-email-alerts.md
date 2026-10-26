# Club email alerts

Club accounts default to all operational alert categories and email enabled. Each team member can change their own settings; guest follow-email and marketing consent are separate.

## Events and recipients

- VIP requests, edits and withdrawals: club owner and active managers.
- Internal table requests and cancellations: existing authorized table recipients, through the dedicated table email worker.
- Guest-list entries and ride requests: owner and active managers.
- Dancer profile approval and media review: owner and active managers. Media is checked against the actual club review queue after NFC association and file validation. New items are grouped by dancer each worker run; the same content version is not announced twice.
- Dancer check-ins, check-outs and scheduled appearance changes: owner, managers and active staff. Demo check-ins do not generate email.
- Roster, Club Deal and team-access changes: owner and active managers.
- Page ready/live and claim decisions: the existing notification recipient.
- Support replies: the account that owns the support thread.
- Weekly summaries: owner and active managers, once per UTC week, covering the preceding Monday–Sunday check-ins, guest-list entries, VIP requests and table requests.
- Account confirmations, recovery and invitation emails retain their existing transactional senders.

## Delivery

`venue_notification_email` saves an email receipt in the same transaction as the club inbox notification. The `/api/cron/venue-emails` worker runs every minute, prepares grouped media/weekly notices, and drains the receipts. Existing inline notification delivery defers club emails to this worker when the migration is installed. Table emails retain their own independent queue.

Immediately before delivery, the worker rechecks active account status, verified current email, current club membership/access, and notification preferences. It uses a stable provider idempotency key, frozen message content and a frozen destination. Expired leases can be recovered. Transport failures, throttling and server errors retry with backoff. Permanent rejections are recorded as failed. Retries stop after eight attempts or 20 hours, within the provider’s 24-hour idempotency period.

`venue_email_deliveries` is service-only and records status, attempts, outcome, provider ID and finish time. `accepted` means the email provider accepted the message, not that a person opened it or that it avoided spam. Finished delivery details are retained for 30 days. Event deduplication keys contain no message bodies or guest contact details.

Required production configuration: `RESEND_API_KEY`, `EMAIL_FROM` with a verified sender, and `CRON_SECRET`. Missing provider configuration keeps jobs pending and returns an unhealthy worker response. No historical inbox messages are automatically replayed; a specific reported missed reply can be recovered separately.

No browser or end-to-end tests are used. Focused sender tests and Postgres component tests cover retries, duplicate prevention, transactional rollback, recipient access, preferences, and event generation.
