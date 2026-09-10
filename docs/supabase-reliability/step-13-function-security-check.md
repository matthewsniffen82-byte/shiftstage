# Step 13 — read-only function security release check

The fresh catalog contains 131 public-schema functions: 99 definers and 32 invokers. Four interfaces are intentionally anonymous and seven are authenticated. Most privileged RPCs, including dancer NFC registration, deferred activation, sticker administration and paid-payout recovery, remain service-only. API roles cannot create objects in the public or auth schema. All current definers have explicit search paths.

The gap addressed here is repeatable release verification: the earlier catalog export recorded privileges, but did not provide a reusable check that fails on an unexpected browser grant, inherited privilege, new PUBLIC-executable function or changed approved browser interface. PostgreSQL's function defaults make an omitted explicit revoke a relevant future migration risk.

Plan: add `scripts/check-supabase-function-security.sql`, a metadata-only check inside a repeatable-read, read-only transaction with a twenty-second timeout. Inspect effective function privileges and role memberships, schema CREATE rights, API-role capabilities and the currently reviewed search-path settings. Pin the exact signatures and definition fingerprints of the seven existing browser interfaces. Fail if a function is exposed unexpectedly, an intentional interface disappears or changes, a browser can assume a privileged owner, or the relevant permissions/settings drift. New service-only functions with reviewed search paths require no browser allowlist entry. Preserve all existing grants, function bodies, data and migration history.

The intentional interfaces are:

| Interface | Access and existing responsibility |
| --- | --- |
| `current_user_role()` | Anonymous/authenticated identity helper scoped by `auth.uid()`. |
| `is_admin()` | Anonymous/authenticated helper requiring the current active database administrator. |
| `has_active_club_deal(venues)` | Anonymous/authenticated public offer predicate. |
| `mydancr_placeholder_venue_address(text,text)` | Anonymous/authenticated pure display helper. |
| `club_deal_is_liquor_related(text,text,text,text)` | Authenticated pure validation helper. |
| `settle_deal_revenue_event(uuid,text,text)` | Authenticated entry with internal active-admin authorization; remains unavailable to anonymous and service roles. |
| `void_generated_deal_redemption(uuid,text)` | Authenticated entry with internal admin authorization; remains unavailable to anonymous and service roles. |

The fresh seven-function fixture preserves actual definitions and access metadata. Native checker tests project only supporting table/types, disable creation-time body validation and never invoke these application functions. Separate existing RLS/admin tests exercise authorization behavior. The release checker protects the reviewed interface from silent changes; it does not establish business correctness for all 131 bodies or replace the outstanding caller, trigger and lifecycle review.

Definition comparison confirms the current `is_admin`, `current_user_role`, settlement and void functions match `tests/fixtures/database-admin-functions.sql`, which is exercised by `database-browser-privileges.test.mjs`. The allowlist therefore retains the definitions already covered by native active-admin, disabled-admin and ordinary-role checks.

All 27 focused tests pass. They exercise direct, PUBLIC and inherited grants; overloaded names; future default exposure; owner/service membership; schema writes; API-role escalation; unreviewed paths; changed/missing browser interfaces; and read-only transaction enforcement. Failures preserve the synthetic starting records and metadata. Production verification at 19:25:02 UTC passed for all 131 functions, with no application RPC invocation or mutation.

The check explicitly places `pg_temp` after trusted schemas, preventing a temporary catalog table from masking an unexpected grant. All 28 final focused cases pass, including that additional fault case, and the final SQL also passes against production. The initial full suite passed 6,131 cases with lint/build/standalone TypeScript. A separately delivered finance error-handling correction at `fcd8e58e53b5565abe3c6a19c190ff0028987b79` was then integrated; combined final validation and delivery remain required.

Run from the linked repository using the existing authenticated Supabase CLI:

```powershell
supabase db query --linked --project-ref hfmzwadzabmgxkjzmqun --file scripts/check-supabase-function-security.sql --output json
```

Run this check when verifying future function/grant migrations and during the final database regression. A failure requires review of the reported interface or permission; do not automatically update the allowlist to suppress it. No new application credentials, public RPC, paid service or automatic repair is introduced. No migration is needed because this correction only adds a release check and its tests. Full suite, lint, build, standalone TypeScript, exact push/Vercel and deployed preservation/health gates remain required.

## Remaining inspection notes

The current sticker provisioning function takes a compatible venue key-share lock, and rotation/status changes lock tag rows. The inspected activation functions do not request a conflicting venue row lock; this review did not identify a second tag/venue wait cycle in these specific paths. The three sticker administration functions remain service-only and validate the active administrator, while their HTTP entry derives that administrator from the authenticated request.

The provisioning function checks a maximum of 25 active stickers without serializing the count. Status reactivation and rotation of a disabled sticker do not enforce that limit. This is a separate existing capacity-validation gap, assigned to Step 15 for one consistent correction across state transitions; no live tag is altered here.

The retired venue ownership review also locks an individual claim before its venue and can then update other pending claims. Concurrent reviews could form a claim/venue wait cycle. Confirm its retired caller boundaries before considering a narrowly scoped correction; do not reactivate retired routes. Venue-team redemption has a database unique index for one active team per user, in addition to its guarded upsert and locked invitation.

DMCA takedown/restoration are transactional service-only functions. Cross-case uploader serialization, preservation of later manual suspension/hide decisions, acknowledgments and notification delivery remain explicit Step 17/19 lifecycle work. The sole dynamic-SQL public function found is the managed RLS event trigger; it formats trusted DDL command identity and restricts its schema. Its failure behavior belongs in Step 14's trigger review. These findings keep the remaining Step 13 review open.

Final combined validation passed all 6,166 tests with zero failures or skips, lint, production build, standalone TypeScript after the build, the migration guard and thirty read-only readiness checks. The final full run includes all 28 checker cases. No production definition, permission or application record was modified. Exact commit/push, Vercel success and independent deployed preservation/health checks remain required.
