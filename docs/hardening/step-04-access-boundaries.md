# Step 4 — database and storage access boundaries

The current access rules remain intact. This step closes a verification gap: the
broad role matrix covered 79 public base tables while the deployed schema now has
81. `gallery_media_reference_history` and `gallery_storage_retirements` were
already protected by their migrations and focused tests, but were missing from
the current-schema matrix. No policy, grant, application record or migration is
changed by this release.

## Fresh evidence

The Supabase task exported metadata using
`docs/supabase-reliability/catalog-read-only.sql` at 2026-09-12 04:43:52 UTC.
A second read-only catalog query, retained as `catalog-access-dependencies.sql`,
captured explicit public column ACLs, API role
capabilities and role memberships at 04:57:57 UTC. The small committed
`step-04-access-evidence.json` records scope, counts and source-file hashes; the
full captures remain in the D: validation directory. No application rows were
read and no application function was invoked for these captures.

- All 81 public base tables have row security enabled. The two additional tables
  have no browser CRUD grants, no browser policies, and service-role SELECT only.
- The other 81 public relations, all 140 public policies and both public view
  definitions/options are unchanged from the September 10 access fixture.
- All eight captured Storage relations, fourteen Storage policies and ten bucket
  configurations match the earlier reviewed inventory. Six buckets remain
  private; four deliver processed public artwork. Every required bucket passes
  the existing size/type/visibility contract.
- All 82 explicit browser column grants remain SELECT-only, with no grant option.
  The two identity-policy helper definitions retain their reviewed fingerprints.
- `anon` and `authenticated` cannot log in directly, create databases/roles, act
  as superusers or bypass RLS. Neither belongs to another role. `service_role`
  retains intentional RLS bypass and has no direct role memberships. Supabase's
  authenticator may select API roles; this is not browser membership in that role.

The separately deployed `scripts/check-supabase-function-security.sql` checks
effective function access, privileged role membership, trusted schema writers,
role capabilities and function search paths. Its latest read-only run passed in
the coordinated Supabase release. This step also runs its native adversarial
regressions. It does not replay historical grant migrations.

## Changes and regression coverage

Refresh `tests/fixtures/rls-current-access.json` from the metadata and add the two
tables' schema columns to the isolated fixture. The matrix now runs private-row
CRUD denial for anonymous, customer, dancer and venue outsiders against all 81
tables: 1,296 decisions, each grounded by a real synthetic row visible to the
service role. New positive-read/negative-write cases confirm the service role
cannot forge or alter either internal receipt table. Existing ownership,
publication, protected-column and disabled-account cases remain.

The new offline `scripts/check-supabase-access.mjs` compares an operator-provided
metadata export with those reviewed fixtures. It rejects missing/new/duplicate
relations, changed CRUD grants or RLS/view options, changed policies/views/helper
fingerprints, and unsafe or unknown bucket settings. It reads no credentials,
connects to no provider, evaluates no SQL and reports only fixed check names.
It accepts stricter bucket limits/visibility through the existing bucket contract.

The new checker first failed against the former 79-table fixture using the fresh
export; the only failed check was the public relation inventory. The refreshed
fixture passes all nineteen comparison checks. Twenty-four checker regressions
exercise additions, removals, unsafe changes, duplicates, malformed input and
CLI export handling. The focused matrix/Storage/function/checker group passed
165 tests before shared release validation.

For the next review, export fresh metadata through the established read-only SQL
console and run:

```text
node scripts/check-supabase-access.mjs <catalog.json>
```

Inspect the reported capture time. A saved export is dated evidence, not a live
connection or freshness attestation. Review failures before updating fixtures;
do not regenerate a baseline simply to make the command pass. Column ACLs,
non-CRUD privileges, role memberships and broader function access require their
separate read-only queries/gate. This command does not claim to check them.

## Practical limits

The local matrix executes actual policy expressions in a synthetic PostgreSQL
fixture. It does not reproduce every production constraint/trigger, hosted JWT
issuance, Storage HTTP authorization, Realtime or independent connections.
No disposable hosted accounts/environment were designated, so this step does
not claim new hosted cross-account mutations or downloads.

Public artwork URLs remain public even if a profile later disappears from
discovery. Hiding a profile is not revocation of an already shared public URL;
private originals, proofs, moderation objects and video buckets remain private.
The existing publication/privacy work owns that product boundary. No bucket
visibility change is inferred or made here.

Final validation on `3e8106d781e578a982e2cbdcdaf210c19f988cd7` plus this step
passed all **6,359 tests**, with no failures, skips, cancellations or todo,
standalone TypeScript, full zero-warning lint and the production build. The
pretest/prebuild generators ran and postbuild confirmed
`LAYOUT_REVIEW_POPULATION_SKIPPED`. The suite used three workers; the build's
duplicate lint pass was omitted after full standalone lint. All thirty live
readiness checks and nineteen dated metadata comparisons passed.

Published as `5e04e6359671af0cbccbe8e1604aed71c306e00b` with
[exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/DTTKfvKxd1HgzKhH34K2U5VRjbJy).
At 2026-09-12 05:26:35 UTC, clean local HEAD and remote main matched; production
root returned 200, both health endpoints returned 200/ok, and anonymous administrative
monitoring returned 401. The final receipt is
`D:\Codex\MyDancr-validation-2026-09-11\arch-stability\step4-delivery.json`.
