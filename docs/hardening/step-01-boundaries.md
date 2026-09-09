# Step 1 — account service boundaries

Step 0 was delivered as `9421967012a04dccd24d99d14fa33dae29da43a1`.
[Its exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/3tDLqW1MZNxg9QmFCBqtX458VocX)
succeeded. The homepage and both health endpoints returned 200; anonymous admin
monitoring returned 401 at 2026-09-09 14:30 UTC. This step began only afterward.

## Inspection and change

The API routes already use `account-provisioning.ts` for signup/confirmation and
`auth.ts` for account lookup, profile preferences, venue-account checks and account
state transitions. Those transitions include privileged Auth metadata and
publication operations. Nevertheless, `auth.ts` had no explicit server-only marker
and retained unused signup helpers that directly upserted account/profile rows.
Unused credential/session wrappers and dashboard/slug helpers remained alongside
the active service code.

Reference searches across the current app, libraries, scripts and tests, plus the
original workspace's application sources, found no callers of the removed exports.
The package is a private application, not a published library API. The production
signup/login endpoints and canonical provisioning service are unchanged.

`auth.ts` now declares `server-only`, and the unused alternate signup, credential,
session and path helpers are removed. Existing account-service implementations
are retained exactly, verified by comparing their source bodies before/after.
This makes the intended boundary explicit:

```text
Browser UI → authenticated API → account/provisioning services → Supabase
```

The existing import-graph regression now includes `auth.ts`: client component
dependencies cannot reach it, directly or transitively. One server-runtime fixture
recognizes the server-only build marker; its behavior/assertions are unchanged.

The large live shell, dashboard and admin modules remain review targets. Existing
role-specific dynamic imports and shared API/provisioning boundaries are preserved;
this step does not introduce a second application architecture or rewrite those
surfaces. No UI, business rule, database migration, account record, environment
setting, package dependency or production request frequency changes.

A read-only TypeScript syntax-tree scan resolved 1,153 imports across 372 modules
in `app/` and `src/` and found no strongly connected cycles. It covers static and
literal dynamic imports and excludes declared type-only imports; computed imports,
CommonJS loading and the standalone browser shell are outside that result. No
cycle-related refactor is justified by this evidence.

## Validation and delivery

The expanded boundary assertion failed before the marker was added, confirming
the missing boundary. After the change, all 100 focused architecture, signup,
provisioning, lifecycle, admin-suspension, preference and venue-authorization tests
passed with no skips. The initial full 2,806-test suite, type checking, lint and
production build also passed. The independent rate-limit correction `a89818f8`
then reached main and was reviewed and preserved without conflicts; it is not
part of this step's implementation. Combined validation passed all 2,856 tests
with zero failures or skips, TypeScript, zero-warning lint and the production
build. A later independent SDK-loading optimization, `9cfa154e`, was also reviewed
and preserved. Final combined validation passed all 2,859 tests with zero failures
or skips, TypeScript, zero-warning lint and the production build.
The migration-history guard passed all 132 frozen files; build-time demo
population was skipped. Exact commit deployment verification is required before
Step 2. Final execution
evidence is retained with the local hardening delivery records.

No paid service, hosted test platform or additional recurring usage was introduced.
Removing unused helpers adds no API/database requests. Existing authorization,
publication guards, transaction behavior and production password flows are retained.
