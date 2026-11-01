# Hair-color analysis retired

The owner requested removal of hair-color AI analysis on October 31, 2026.
Club reports and demo data no longer include hair-color estimates or grouping.
The image-analysis implementation and minute-by-minute scheduled job are removed.
The old authenticated endpoint returns HTTP 410 without opening a database or
provider connection.

Migration `20261101030000_retire_hair_color_analysis.sql` removes the photo
capture triggers, disables the old refresh/claim/report RPCs, revokes service
inserts, cancels pending jobs and invalidates leases. This stops older deployments
from collecting new work during rollout. Open appearance periods are closed;
earlier closure dates remain unchanged. Historical migrations and private records
remain available for retention and audit obligations. Retirement is not proof of
historical provider erasure. Source photos and ordinary club performance metrics
are unaffected.

Focused coverage includes retirement, historical SQL compatibility, venue report
service/component fixtures, and site-lock/cron authorization tests. No E2E or
real-image provider requests are used for verification.
