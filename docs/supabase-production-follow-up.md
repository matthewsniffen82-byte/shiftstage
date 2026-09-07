# Supabase production follow-up

The code and targeted SQL repairs are separate from operational certification. The audit did not redesign MyDancr, delete production records, replay historical migrations, change existing passwords, or revoke all working sessions. See `supabase-production-audit.md` for original findings and `supabase-remediation-record.md` for stage evidence.

## Finding disposition

| Findings | Disposition |
| --- | --- |
| C1/C2, H1/H2/H9/H10/H11 | Targeted live policy, column, view and direct-write repairs applied in Stage 4 |
| H3 | Missing recovery/bookmark schema repaired; read-only release check added. Historical migration reconciliation remains below |
| H4/H7/H8, M3 | Exact passwords, safe recovery/auth errors and truthful partial-success handling repaired in Stage 2 |
| H5, M1, public-key validation | Session races and client/configuration boundaries repaired in Stage 3 |
| H6/H14, M7 | Bounded transport, consistent rotation delivery and Auth/database health added in Stage 6 |
| H12/H13, M5/M8/M11 | Transactional provisioning/publication/support, preserved metadata, compatible draft creation and bounded ranking queries added in Stage 5 |
| M4 | Future verified email changes mirror automatically; historical email values were not backfilled |
| M2 | Current `.ConfirmationURL` implicit/token-hash callbacks remain supported. A PKCE code-only flow without its browser verifier is not a supported cross-device recovery path |
| M6/M9/M10 and remaining low-priority operational items | Follow the explicit actions below; do not consider these verified by unit tests |

## Dashboard and operational actions

1. **Authentication → URL Configuration.** Confirm Site URL remains `https://www.mydancr.com` and the production redirect allowlist contains `https://www.mydancr.com/auth/callback`. Use a separate staging project's exact callback URL for test accounts. Do not add a broad production wildcard or guess a missing redirect. Verify the actual generated recovery URL, including its intended destination.
2. **Authentication → Email → Reset password template.** Preserve the current `.ConfirmationURL` flow. Do not substitute a code-only callback while verifier persistence is absent. With a disposable staging account, follow the delivered link on a second browser/device and confirm it opens the new-password form before navigating to the dashboard.
3. **Authentication email SMTP and Resend domain settings.** Current inspected values were `smtp.resend.com`, port 465, sender `no-reply@mydancr.com`, minimum per-user interval 60 seconds. Keep credentials private. In Resend, verify the sending domain's current SPF/DKIM records and delivery logs; use the domain's published DMARC policy rather than inventing DNS values. Check bounced/suppressed messages and rate limits with a designated test address. No SMTP credential rotation or duplicate provider password-alert switch is required by this release.
4. **Authentication → Sessions.** Inspected time-box/inactivity values were 2160/720 hours; JWT expiry 3600 seconds; refresh reuse 10 seconds; single-session enforcement off. No audit change is requested. Preserve these unless the product deliberately chooses a different session policy; changing them can invalidate working sessions.
5. **Database → Backups.** Record the latest successful backup, retention and whether point-in-time recovery is available/enabled for this project. Restore to an isolated project and verify schema, RLS, Auth configuration dependencies and representative data there. Never test restoration over production. Separately verify storage-object backup/export and restoration; database backup alone does not establish recovery of stored files. Actual restore testing remains outstanding.
6. **SQL Editor / migration ledger.** Use the read-only catalog inventory to match historical versions to actual object definitions. Duplicate version numbers cannot be safely fixed by renaming files or marking every version applied. The four new audit migrations are already recorded; do not reapply them blindly. Record a historical migration only after its exact effects are confirmed.
7. **Storage → dancer-photos.** The bucket remains public to preserve existing URLs. A copied public URL can remain accessible after a profile goes private. Before changing the bucket to private, deploy an authorized media route, migrate all client/derivative URLs, test owner/public/incognito access and cache invalidation, then change bucket visibility and retire old public URLs. That separate compatibility migration is not included in this audit.
8. **Existing unvalidated constraints.** Review legacy exceptions for `mydancr_tv_duration_check` and `club_deals_liquor_free_check` through the existing moderation workflow. Only after exceptions are resolved, validate the exact constraints with bounded lock/statement timeouts. Do not delete records or weaken checks to force validation.
9. **Venue-team staging fixtures.** Test one active member of venue A against records in A and B, plus an unaffiliated account and admin. Production had no active venue-team fixture for that representative positive/negative test. The repaired policies' outer venue correlation and unaffiliated denial were checked live.
10. **Monitoring.** Point the existing monitor at `/api/health/supabase` and alert on sustained non-200 responses. Keep `/api/health` as application liveness. Run the read-only readiness script in a server/CI environment before future database-dependent releases. It performs no migrations and prints only check names and pass/fail results. Monitoring credentials and destinations are not configured by this audit.

Use the lifecycle matrix in `supabase-remediation-record.md` for signup/verification, recovery expiry/reuse, multiple requests, real delivery, password update/login, refresh outages, and browser navigation. Repository mocks and rollback SQL tests establish specific boundaries; they do not establish email inbox delivery or backup restoration.

## Reference behavior

- [Next.js 15 middleware request/response headers](https://nextjs.org/docs/15/pages/api-reference/file-conventions/middleware)
- [Supabase session behavior](https://supabase.com/docs/guides/auth/sessions)
- [Supabase custom transport](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js) — this application deliberately uses one attempt for mutations and token rotation.
