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
| 6 | API authorization, input validation and consistent failure behavior | Published: `b0f3ac2950b934793c07c9b63a32ecbf849727e1`; 6,721 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5JHGBMZtCdFFkMstAtWrehtYvvJ5) |
| 7 | Browser security, rendering, redirects and token exposure boundaries | Published: `0f5e0c31084dc53d58442202cea7ad6f761e1af0`; 6,851 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5UyvzVyCnUUwncbhTDV5VkZkT8MG) |
| 8 | Upload/media validation, resource budgets and publication safety | Published: `19ca1b4292af071a3d6395bb1f044acd4d367d03`; 7,123 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/DCCd34YEFm8Y9Zoo3sRagCvvvGNR) |
| 9 | Rate limits, request budgets and abuse under concurrency | Published: `590ffc24e7b183358821267b43a903dd8cd29325`; 7,312 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/zUReVoQ4GVjs5xgrLoBcND8aegip) |
| 10 | Atomic operations, idempotency and partial-write recovery, including venue provisioning compensation | Published: `0ac237ee6a0d99f30a58b711d6fa802b9d8ee8f1`; 7,356 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5k3A4LX4Rc3B6ck8g11rqjX4nA6N) |
| 11 | Query bounds, caching, network behavior and generated asset consistency | Published: `104b221da2417f58fc1f60dd710c1d9db21229e0`; 7,365 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/F5EMcpzuXxq1jd1BnUYpLzDBrami) |
| 12 | Frontend exceptions, loading/empty/error states and interrupted navigation | Published: `e8586070673d11f48c96be50cd86cebd6ab9ae05`; 7,770 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/H9C1pohZoeoyGbN9FQq573Eu4apP) |
| 13 | Background jobs, overlapping runs, deadlines and retry recovery | Published: `a519813ea8211a440e695f62858bbc2896f09846`; 8,048 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/H13p7p12hrw7tgSzaDqtFTMjF9dV) |
| 14 | Privacy-safe diagnostics, exception monitoring and failure visibility | Published: `d999a16218f8db7aacc3663206f36fc8e662b934`; 8,841 tests and all release gates; [Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/Ebk7oT5oC9KBihU1rY6KXm6AFPrk) |
| 15 | Provider integrations, webhook replay and uncertain external outcomes | Notification and monitoring corrections with consolidated closeout; 9,036 tests and all local release gates; exact delivery recorded in `step15-delivery.json` |
| 16 | Dependencies, installation scripts, advisory review and runtime consistency | Consolidated into the [final architecture review](final-architecture-review.md); see verified controls, remaining findings and unperformed checks |
| 17 | CI/deployment gates, reproducible releases and application rollback | Consolidated into the [final architecture review](final-architecture-review.md); see verified controls, remaining findings and unperformed checks |
| 18 | Lightweight health checks and operational diagnosis | Consolidated into the [final architecture review](final-architecture-review.md); see verified controls, remaining findings and unperformed checks |
| 19 | Migration provenance, backups and restore procedures | Consolidated into the [final architecture review](final-architecture-review.md); see verified controls, remaining findings and unperformed checks |
| 20 | Critical journey and regression coverage, including browser verification where safely available | Consolidated into the [final architecture review](final-architecture-review.md); see verified controls, remaining findings and unperformed checks |
| 21 | Scalability, bounded load and measured resource use | Consolidated into the [final architecture review](final-architecture-review.md); see verified controls, remaining findings and unperformed checks |
| 22 | Maintenance ownership, operational documentation and remaining configuration | Consolidated into the [final architecture review](final-architecture-review.md); see verified controls, remaining findings and unperformed checks |
| 23 | Final architecture/stability audit and exact-release verification | Consolidated into the [final architecture review](final-architecture-review.md); see verified controls, remaining findings and unperformed checks |

## Owner-approved consolidation

On 2026-09-12, the owner chose to consolidate the remaining reviews. Steps 0–14
retain their separate deliveries. Step 15 combines the confirmed notification and
monitoring fixes with the final review of topics 16–23. Documentation-only topics do
not receive separate release loops. Actual fixes retain full validation, normal
push and exact deployment verification. The final report distinguishes unresolved
findings and unperformed hosted exercises from completed corrections.

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
