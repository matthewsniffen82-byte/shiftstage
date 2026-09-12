# Step 10 — account mutation and partial-write boundaries

Reviewed on `590ffc24e7b183358821267b43a903dd8cd29325` at 2026-09-12.
The three existing account source/test files match the earlier regression
baseline. Only the bounded application corrections described here are applied.

The account email branch accepted the Auth update before reading the account
needed for its response. An accepted update followed by a database read failure
therefore returned 500, creating uncertainty and encouraging another submission.
The correction resolves that context first, matching the existing
password branch. A failed account read now makes no credential change. An
accepted email update returns the existing confirmation response without another
required database read or automatic replay.

The account object is response context read before mutation, not a receipt that
the new address has been confirmed. The existing `sync_verified_auth_email`
trigger mirrors an actual change of `auth.users.email` and ignores pending
`new_email`; that protected migration and the account reader remain unchanged.
This release preserves confirmation settings and the existing response message.
No disposable hosted account was designated, so inbox delivery and a live email
confirmation journey remain untested. No confirmation email is sent by these tests.

The earlier 15 actual-route regressions (2026-09-12 09:09 UTC) include two
predecessor failures and pass after correction. They use the real bounded JSON
reader, public URL policy and error resolver with synthetic Auth/account adapters.
That earlier 61-case focused group
also covers existing password, form and account-request behavior; lint passes.

## Existing copyright restriction guard

A trusted self-pause marker could permit self-reactivation while the existing
`dmca_suspended_at` restriction was present. The correction reads and rejects
that hold before mutation. The active-account UPDATE also requires the hold
column to remain NULL, preventing a hold applied after the initial read from
being bypassed by that write. This uses the existing schema and preserves the
own-account deletion path. No restriction field is added to the public response.

Twenty-eight actual-module cases cover four account roles, permitted and blocked
reactivation, deletion, and eight explicit interleavings. The initial twenty
cases had eight predecessor failures; the eight interleavings also failed the
intermediate read-only guard. The combined account/email group passes 71 tests;
five-file lint passes. These are synthetic adapter results, not hosted races
or proof of all administrator/lifecycle writers. In particular, later same-value
manual decisions and compensating writes still need ownership semantics. The
predicate guards the account write; it does not make subsequent venue, Auth
metadata and profile publication writes one transaction.

The first full gate passed 7,354 tests and found one older database adapter that
did not implement the new predicate. The adapter now applies `IS NULL` in its
actual isolated PostgreSQL UPDATE and retains every administrative-suspension
assertion. A new nested case applies the hold between the read and write; it
fails on committed `590ffc24` and passes with the correction. Its predecessor
run reports both the failed child and parent, representing one distinct new
regression. The expanded four-suite focused group passes all 79 tests. This is
an isolated database exercise, not a hosted concurrent-connection test.

## Other atomic and uncertain boundaries to reconcile

The additional `setAccountState` source observation is now reproduced against
the actual module on 19ca1b42 (2026-09-12 10:25 UTC), using synthetic stateful
provider/database responses. If disabling the account commits but its response
is lost, compensation restores the venue's public flag and removes the trusted
self-pause marker; a subsequent self-reactivation is forbidden. A second explicit
interleaving shows compensation overriding an independent venue retirement.
See `step10-account-compensation-reproduction.json`. This is not a hosted
concurrent-connection exercise. This bounded application correction does not
fix either case. A private atomic lifecycle candidate is being tested by the
Security task under its own scope; it has not been released at this boundary.

- Account provisioning requires the existing atomic RPC. No legacy multi-write
  account fallback or historical migration replay is restored.
- Newly created venue manager accounts can be compensated during setup. After
  uncertain request insertion, the service checks for a saved request and
  preserves it and its login when found; an unsuccessful reconciliation query
  does not authorize deleting the login. A successful empty read is still a
  point-in-time observation, not a cross-service transaction. The actual service
  regressions cover failed persistence, a committed insert with an interrupted
  response, and preservation of pre-existing accounts. They are included in the
  full gate; no hosted Auth/database fault injection is claimed.
- The already delivered gallery publication/retirement, NFC capacity and sales
  hierarchy corrections have their own transactional scopes and receipts. Their
  reviewed releases are retained: NFC `ad0208a5`, sales hierarchy `fce8a233`,
  gallery capacity `ef752f85`, and finite schedule/attribution `de1f3762`.
  The current caller release `e6f67506` verified that 133 functions, 62 triggers
  and 29 table fingerprints remained unchanged. These independent receipts do
  not make database and external storage/Auth/provider systems one transaction.
- Password mutation already separates other-session revocation and security
  email failures from the confirmed password change. Retain its truthful warning
  and no-replay behavior.

The release evidence below records the complete validation and deployment
boundary. No real-user account, communication, financial record or production
mutation is used for fault injection. Compensating account/venue writes remain
an explicitly open finding; a later independently authorized Security/Supabase
lifecycle correction must supply its own native and deployed evidence. The
final architecture audit will reconcile it instead of treating this bounded
application release as a cross-system transaction.

Final release validation:

On `590ffc24e7b183358821267b43a903dd8cd29325` plus this step, all **7,356 tests** passed
with no failures, skips, cancellations or todo. Standalone TypeScript, full
zero-warning lint and the production build passed on Node v24.21.0.
The repository's canonical release gate also passed dependency and registry
signature audits, native runtime checks and route type generation. Its normal
production build retained compilation, lint, type checks and lifecycle hooks.
Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 33
read-only readiness checks passed.

Published as `0ac237ee6a0d99f30a58b711d6fa802b9d8ee8f1`, with [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5k3A4LX4Rc3B6ck8g11rqjX4nA6N).
Post-release health passed at 2026-09-12T12:10:51.928Z. Local and remote main
matched and both unrelated screenshots were preserved. The complete receipt
is retained as `step10-delivery.json` in the external architecture evidence directory.
