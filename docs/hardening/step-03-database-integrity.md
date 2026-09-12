# Step 3 — database integrity and account provisioning

Resumed from clean D: source after the original task's delivery was interrupted.
The first candidate baseline is `87863f2dda46db18c58c859eb0be9e96adb9722c`.
The unrelated upcoming-dancer release is preserved. This task does not import or
access either historical repository's files.

## Reconciliation of the unpublished work

The original task's records identify a four-file commit: the Step 3 report,
`20260909153500_preserve_existing_profile_provisioning.sql`,
`tests/account-provisioning-database.test.mjs` and
`tests/fixtures/provisioning-live-predecessor.sql`. The commit was repeatedly
rebased as main advanced; the reported `e7aaf26c` was one unpublished candidate.
The final historical run passed 3,028 tests, TypeScript and lint, but its build
was deliberately stopped under C: disk pressure. It was never a completed
deployment, and the old migration was explicitly unapplied.

Its database defect was repeated dancer provisioning: inserting a candidate
profile can run its BEFORE INSERT link trigger before ON CONFLICT resolves an
existing owner, rejecting a former link already reserved by that profile.
The current checkout contains the newer Supabase Step 7 implementation:

- `20260910014900_preserve_existing_account_profiles.sql` skips an existing
  child under the account row lock, preserves inactive accounts, uses an empty
  search path and bounds lock waits to three seconds.
- `tests/account-provisioning-postgres.test.mjs` reproduces the predecessor's
  reserved-link failure and verifies the corrected behavior, bootstrap rollback,
  role preservation and denied browser execution.
- `account-profile-recovery.ts` repairs confirmed missing public-account setup
  on verified login/session/account entry. It distinguishes query failure from
  absence and requires an acknowledged operation and fresh owned-record reads.

The Supabase ledger records release
`043d8d83e5cb878cf58f18bc913fb7065f6393fd` and its successful
[Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/hpaLd2413GtpwA7Gw87Hvg8AN57g).
This is independently supported by fresh production catalog evidence captured by
the coordinating Supabase task at **2026-09-12 04:16:27 UTC**:

| Check | Observed result |
| --- | --- |
| Installed function | `provision_app_account_safely(uuid,text,text,text,text)` |
| Function definition MD5 | `4976257073739281a44a64f8a33324f7` |
| Execution | postgres/service_role only; anon and authenticated denied |
| Security settings | SECURITY DEFINER; empty search path; three-second lock timeout |
| Applied ledger entry | `20260910014900`, `preserve_existing_account_profiles` |
| Ledger SQL MD5 | `ae01896dcbe1f3b5bb7730e40a578d63` |

The metadata capture is retained outside source in
`D:\Codex\MyDancr-validation-2026-09-11\supabase-hardening\catalog.json`.
It contains definitions/access metadata, not an invocation of the provisioner.
The current frozen migration and the local normalized function definition match
this deployed fingerprint. **The unpublished older migration is superseded and
must not be replayed.** No SQL or historical migration ledger change is needed.

## Remaining caller correction

Signup, callback and new venue-manager creation share `provisionAppAccount`.
That helper still fell back to separate account/profile table writes when the
atomic function was reported missing. Those writes cannot preserve the database
transaction's account lock, lifecycle checks and all-or-nothing behavior.
The production function and its replacement are already installed and verified;
there is no remaining deployment need for this compatibility path.

The helper now exclusively calls the existing atomic RPC and requires literal
boolean `true`. Every returned or thrown error propagates without a table-write
fallback or automatic retry. Its input semantics are retained, including the
generic dancer display name and exact supplied city. It is explicitly server-only
and covered by the privileged import-graph test. Unused fallback logging options
are removed from its signup/callback callers.

Existing venue-manager creation, trusted-role reconciliation and request recovery
remain in place. Their tests cover denial of existing-email creation, preservation
of a request whose insert response was lost, and email-delivery failure. This
change does not claim that Auth and venue-request writes form one cross-provider
transaction; review of compensating cleanup belongs to reconstructed Step 10.

## Validation and evidence limits

The new runtime regression failed on the baseline because a missing RPC attempted
non-atomic table access. After the draft change, all **170 focused checks passed**,
including **26 new caller cases**. These execute the actual TypeScript helper
against the current native PostgreSQL fixture where applicable. They cover
strict acknowledgment, missing function, permission/conflict/timeout errors,
thrown transport errors, private initial dancer values, preserved customer data,
approved renamed profiles and aliases, inactive-account preservation and a lost
success response followed by an explicit retry. Older source assertions now check
delegation to the atomic boundary; the runtime tests verify the moved invariants.

Local fixture SQL is normalized only in memory for the fingerprint comparison;
the frozen migration file is unchanged. Fixtures use synthetic identities and
execute real PostgreSQL functions, but do not run hosted GoTrue, send emails,
prove independent-connection concurrency or exercise a full production signup.
No live repair or production record mutation is used as a test.

Final validation on `994bd0adc9f01e9e8f88e58abb7085f7ac061b6c` plus this step
passed all **6,225 tests**, with zero failures, skips, cancellations or todo,
standalone TypeScript, full zero-warning lint and the production build. The
independent moderation release `7c8f5be2` and review report `994bd0ad` are
preserved. The pretest/prebuild generators ran; postbuild reported
`LAYOUT_REVIEW_POPULATION_SKIPPED`. The complete suite ran with three workers;
TypeScript was run separately to avoid repeating the same full suite inside the
package's combined typecheck command. Build compilation/type checks remained
enabled; only its duplicate lint pass was omitted after full standalone lint.

Exact commit push/Vercel and post-release health are the remaining delivery
checks at publication. Local results and the final delivery receipt are under
`D:\Codex\MyDancr-validation-2026-09-11\arch-stability`.

The resumed task's 30 read-only Supabase readiness checks passed, including Auth,
the schema, bucket access, protected projections and provisioner availability.
The offline migration guard passed all 159 files, including 142 frozen files.
Its four historical version-collision groups remain explicitly quarantined;
`replayReady` is false. No historical SQL or ledger repair was attempted.

## Release and recovery

Deploy the application caller change with no database migration. If the atomic
RPC is missing in another environment, account setup fails visibly until that
environment's reviewed schema is restored; it does not partially provision.
The existing read-only readiness command checks RPC availability before release.
Application rollback may restore the previous commit without changing any data
or SQL history, although doing so restores the obsolete fallback. Prefer a
forward fix and preserve already created private accounts/profiles.

No dependency, service, provider setting, request frequency, paid capability or
production schema change is introduced. Successful provisioning uses the same
single RPC as before; unavailable provisioning performs fewer writes.
