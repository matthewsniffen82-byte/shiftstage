# Architecture and stability delivery sequence

Resumed on 2026-09-12 in `D:\Codex\MyDancr-clean-2026-09-11`.
The original **Arch stability** task remains intact. This file is the durable
continuation record for the replacement task.

## Recovery and scope

Steps 0–2 are published work recorded in `docs/ARCHITECTURE.md`,
`step-01-boundaries.md` and `step-02-configuration.md`. The unpublished Step 3
database fix was not copied into this checkout. Its defect is covered by newer
published Supabase work; see `step-03-database-integrity.md` for the reconciliation.

The complete original numbered prompt was unavailable through task-history
retrieval, and the owner no longer has a copy. The owner instructed this task to
continue each step through its own validated commit and successful deployment.
The sequence below reconstructs the remaining scope from the numbered risk
references in `docs/ARCHITECTURE.md`, especially sections 14–16, and the recorded
unfinished work. **Steps 4–23 are a reconstruction, not a verbatim recovered
user checklist.** Preserve those topic mappings and inspect current code and
provider evidence before choosing changes. Existing security, performance and
Supabase reports may supply evidence; their dated claims must be verified before
being treated as present state.

| Step | Scope and completion evidence | State |
| --- | --- | --- |
| 0 | Architecture inventory and stability baseline | Published: `9421967012a04dccd24d99d14fa33dae29da43a1` |
| 1 | Service boundaries and browser/server import isolation | Published: `47d165470d4ed4682497da7c21f6f3068fbd071f` |
| 2 | Environment validation, credential boundaries and configuration | Published: `14cf8206`; see its report |
| 3 | Database integrity, repeatable account provisioning and reconciliation of the unpublished fix | Published: `34b6f50dadd61a5b38f7b3831499d34c8a21040b`; 6,225 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5RqEiNACJtqxuqzeUeyrgWuaF7Bn) |
| 4 | Supabase access boundaries: RLS, grants, Storage and role isolation | Published: `5e04e6359671af0cbccbe8e1604aed71c306e00b`; 6,359 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/DTTKfvKxd1HgzKhH34K2U5VRjbJy) |
| 5 | Authentication, session lifecycle and password recovery | Published: `8725ca85a8d696f50baacc314eff6194dab36fd9`; 6,528 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5rkPQiZyeDQ1LBSkkF3LeaWVZAFH) |
| 6 | API authorization, input validation and consistent failure behavior | Validated: 6,721 tests, TypeScript, lint, build and 30 readiness checks; malformed session and sales-agent input corrected; delivery receipt follows |
| 7 | Browser security, rendering, redirects and token exposure boundaries | Pending |
| 8 | Upload/media validation, resource budgets and publication safety | Pending |
| 9 | Rate limits, request budgets and abuse under concurrency | Pending |
| 10 | Atomic operations, idempotency and partial-write recovery, including venue provisioning compensation | Pending |
| 11 | Query bounds, caching, network behavior and generated asset consistency | Pending |
| 12 | Frontend exceptions, loading/empty/error states and interrupted navigation | Pending |
| 13 | Background jobs, overlapping runs, deadlines and retry recovery | Pending |
| 14 | Privacy-safe diagnostics, exception monitoring and failure visibility | Pending |
| 15 | Provider integrations, webhook replay and uncertain external outcomes | Pending |
| 16 | Dependencies, installation scripts, advisory review and runtime consistency | Pending |
| 17 | CI/deployment gates, reproducible releases and application rollback | Pending |
| 18 | Lightweight health checks and operational diagnosis | Pending |
| 19 | Migration provenance, backups and restore procedures | Pending |
| 20 | Critical journey and regression coverage, including browser verification where safely available | Pending |
| 21 | Scalability, bounded load and measured resource use | Pending |
| 22 | Maintenance ownership, operational documentation and remaining configuration | Pending |
| 23 | Final architecture/stability audit and exact-release verification | Pending |

## Per-step delivery contract

Inspect the existing behavior, reproduce any defect, make only justified changes,
and review the final diff. Run the complete automated suite, TypeScript, full lint,
and production build. Commit only this step's files, push normally to `origin/main`,
confirm local/remote equality and exact-commit Vercel success, and perform bounded
read-only health checks. Advance only after those gates pass. A report must
distinguish verified behavior, unresolved findings and untested provider journeys.

Coordinate source freezes, generators, `.next`, Git staging and production SQL
with the other tasks sharing this checkout. Keep drafts/evidence on D: outside
the shared source until its release slot. Do not overwrite unrelated work,
force-push, replay historical migrations or resurrect an unpublished predecessor
over a newer deployed implementation.

Retain the existing application, design, product rules and security boundaries.
Do not add paid services, change billing, send test communications to real users,
or run destructive production tests. Use synthetic local database fixtures and
read-only production checks. Hosted account/email, full migration replay and
restore tests require a designated disposable environment; record any unavailable
evidence explicitly. Do not fabricate passing results or claim unavailable tests
ran. No watcher or new recurring automation is part of this reconstruction.
