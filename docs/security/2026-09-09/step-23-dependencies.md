# Step 23 — dependency review and native runtime correction

The review began only after Step 22's exact deployment and health gates passed. Evidence was prepared outside the shared checkout while the architecture, TV, Supabase and review tasks completed their reserved releases. This step changes no database records, provider configuration or application media policy.

## Findings and disposition

The initial complete and production-only npm audits both reported zero known package advisories. The installed dependency tree was consistent with the lockfile. Those scans do not establish the safety of executables fetched separately by an install script.

**Native decoder security updates were missing.** The locked `ffmpeg-static@5.3.0` wrapper installs FFmpeg 6.1.1 by default, including on this Windows checkout. The package's current binary release remains 6.1.1. Uploaded videos reach this executable through validation, moderation, watermarking and poster generation. Existing file-only protocol, container, pixel, duration and process limits reduce exposure; they do not replace upstream decoder patches. [Wrapper releases](https://github.com/eugeneware/ffmpeg-static/releases), [FFmpeg security fixes](https://ffmpeg.org/security.html).

The wrapper remains pinned at 5.3.0 to preserve every existing runtime import and deployment tracing path. Its download script is explicitly denied. A first-party postinstall script installs reviewed FFmpeg 8.1.2 maintenance-branch binaries, identified as `n8.1.2-50-g1a748fe2cd`, from BtbN's August 31 monthly release. FFmpeg links this distributor; its monthly archives are retained for two years. Windows x64 and Linux x64 are explicitly supported. Other platforms fail with an actionable error instead of falling back to the old decoder. [FFmpeg distribution links](https://ffmpeg.org/download.html), [Distributor and retention policy](https://github.com/BtbN/FFmpeg-Builds), [Pinned release](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-08-31-13-27).

The September 11 maintenance snapshot was compared with the selected monthly build. Its two additional changes correct DTS core profile metadata and uppercase `V` stream selection; the application uses neither option. The monthly pin retains the published 8.1.2 security fixes while avoiding a daily archive that expires after fourteen builds. This is a reviewed compatibility judgment, not a claim that every future maintenance commit is irrelevant. [Upstream comparison](https://github.com/FFmpeg/FFmpeg/compare/1a748fe2cd...5a03dfa0f6).

The committed manifest pins the URL, byte count and SHA-256 for both archives and extracted executables. Every redirect is checked before the next request; downloads must finish on an approved HTTPS host and match their exact size and digest before extraction. Only the named executable and license are extracted. The executable is verified independently and atomically replaces the old binary; GPL license and release metadata accompany it. A failed download leaves the old binary intact, while subsequent verification prevents a build from accepting it. No archive or executable is committed. Environment overrides cannot select another binary during installation or validation.

**The local Node runtime predates security patches.** The host's Node 24.16.0 lacks the June and July 2026 security releases. The repository now selects Node 24 LTS and requires at least 24.18.1; `.node-version` recommends 24.21.0. A checksum-verified portable 24.21.0 was installed only in the task evidence directory for validation, without changing the host's global runtime. [June security release](https://nodejs.org/en/blog/vulnerability/june-2026-security-releases), [July security release](https://nodejs.org/en/blog/vulnerability/july-2026-security-releases), [Node 24.21.0](https://nodejs.org/en/blog/release/v24.21.0).

Installation, development, tests and builds enforce the runtime floor. Next configuration also checks it, including direct Next commands. Build verification hashes the native decoder and performs a tiny synthetic H.264 encode; this checks the Linux executable and its native compatibility during Vercel builds. Vercel selects the major from `engines.node` and manages patch rollout. A successful build demonstrates the build-time floor and executable smoke check, not an independently queried version of every running platform instance. [Vercel runtime selection](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## Other package decisions

- Next 15.5.24 contains the August security release. Sharp 0.35.4 includes patched libheif 1.23.2, which was confirmed from the installed native version report. Both are retained. Next 15.5.25 re-enables AVIF optimization with updated Sharp; it is not required to close the reviewed advisory. [Next security release](https://nextjs.org/blog/august-2026-security-release), [Sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c), [Next 15.5.25](https://github.com/vercel/next.js/releases/tag/v15.5.25).
- All 428 locked package entries retain their existing versions and integrity metadata. The lockfile change is limited to root metadata for the Node requirement, first-party install hook and exact wrapper version.
- Available major upgrades to Next, ESLint, TypeScript, OpenAI and Stripe are not treated as security fixes without an applicable advisory. SDK and framework migrations require their own compatibility review.
- Next 15 is in maintenance support. Its support window needs follow-up before October 2026; this step does not claim a Next 16 migration. Review native FFmpeg updates regularly and replace the monthly pin before its distributor's retention expires. [Next support policy](https://nextjs.org/support-policy).

## Validation evidence

Before integration, 52 existing real-media regressions passed using the new executable with the unchanged application source. They cover MP4/MOV/WebM, audio, format/protocol/pixel restrictions, watermarks, posters and storage receipts. Synthetic fixtures do not upload to production or call a moderation provider.

The 49 new adversarial/runtime tests cover unsupported and old runtimes, unreviewed platforms, integrity and byte limits, failed HTTP responses, redirect origins, corrupt/truncated archives, file preservation, wrapper identity and environment overrides. All pass. Independent negative controls correctly reject the original Node runtime and the original FFmpeg binary. Both Windows and Linux installer integration checks verify archive and executable digests, license retention and cache reuse. Linux execution is additionally required by the Vercel build smoke test.

A clean isolated installation using pinned npm 11.19.1 passed, reported zero advisories, ran the first-party hook and installed the reviewed binary with the old downloader denied. The Windows synthetic encode passed on Node 24.21.0. All 56 focused dependency/runtime/lifecycle checks passed. Ten candidate source/test/config files passed lint without warnings. Full integrated tests, standalone TypeScript, lint, production build, task-only commit/push, matching main, exact Vercel success and deployed health remain required before this step is delivered.

Raw installation, audit, native-version and validation evidence stays outside Git in the task delivery directory. Package audit results are time-bound and do not prove absence of undisclosed vulnerabilities or audit every linked native library. No exploit against production was attempted.

## Integrated release baseline

The release candidate starts from `6a8454490250212bc2e7a175cf82798b02454dbf`. It preserves the browser-session correction `8725ca85`, TV playback correction `bc4812b7`, NFC correction `c5d3ddc9`, migration protection closure `ad0208a5`, and the independent review report. Each exact Vercel status was independently confirmed successful before integration. The Supabase closure protects 161 migrations; this Security release applies no SQL.

Fresh complete and production-only npm audits on the integrated lockfile again report zero advisories. The reviewed replacement installed successfully into the existing wrapper path, and the synthetic native smoke check passed on Node 24.21.0. Thirteen source/config/test files were frozen by hash for the full validation run. A documentation-only trailing blank line was removed after the initial whitespace check; no source file changed during the test run.

## Step 23 final validation

Final integrated validation on `6a8454490250212bc2e7a175cf82798b02454dbf` passed all 6,653 automated tests with zero failures, skips or cancellations, standalone TypeScript, full lint and the production build. The runtime check verified Node 24.21.0 and the pinned FFmpeg executable; the migration-history guard passed and postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All thirteen frozen source/config/test files retained their validated hashes. Both complete and production-only package audits report zero known advisories. The eighteen-file release preserves every unrelated commit. Only task-only commit/push, matching main, exact Vercel success and deployed read-only checks remain before Step 24 may begin.

## Step 23 exact delivery

Step 23 delivered as `77ea0eb48d3de3a1b65c87fdca8e5754fb6d1579`. [Exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/9G1hPeQD5qRiySQxey5ttcksnRLD) succeeded. All eight production health/anonymous-denial checks passed at 2026-09-12T07:00:11Z, thirty Supabase readiness checks passed, and the fully rendered homepage had no browser warnings/errors. At 07:01:30Z local main, origin/main and the remote matched with a clean worktree. No SQL or production business/provider mutation was used as a test. Only after these gates did Step 24 begin.
