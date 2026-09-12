# Step 25 — production build and public artifacts

Source baseline: `ffc628e230200c29ab6c602071b70ad1e3f3774b`. This step begins only after Step 24's exact deployment, health and clean matching refs closed at 2026-09-12T08:16:11Z. The final integration base is `088bc541dc35c41d99e26953a650dcc6cd506af1`; the independent architecture, TV recovery and review releases below are preserved.

## Finding and scope

No active private credential or browser source-map exposure was found in the inspected build or downloaded public assets. Next's emitted production configuration already has browser source maps disabled, server source maps disabled, TypeScript errors enforced and build lint enforced. The one explicit `nextConfig.env` value is the already validated public moderation mode. Privileged module/import graph and public environment boundaries remain intact.

The missing safeguard is inspection of the files that actually become public. The existing public-environment guard checks configuration before compilation; it cannot catch someone copying a map, environment file or credential-bearing static file into `public`. Next disables browser source maps by default and serves them when explicitly enabled. Values specified through `nextConfig.env` are browser-visible configuration. [Next source-map configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/productionBrowserSourceMaps), [Next explicit environment configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/env).

The change makes `productionBrowserSourceMaps: false` explicit and runs a public-artifact check after `next build`, before npm can run the existing postbuild maintenance hook. A rejected inspection fails the build. This adds no provider call, SQL, account operation or background process.

The inspector covers `public`, `.next/static`, prerendered HTML/Flight/route bodies, prerendered Pages data and the two custom HTML/JavaScript shell outputs. It rejects source-map files, inline/external source-map comments, development source URLs, emitted source-map response headers, linked artifacts, selected private/source/backup file types, unsafe emitted build settings and additional unreviewed explicit browser environment values. Text inspection recognizes private key/provider formats, non-anonymous JWT literals and configured private values in literal, JSON-escaped, URL-encoded and base64 forms. Diagnostics contain neither filenames nor matched values; unexpected file/JSON errors produce a fixed CLI error. Oversized text assets and missing required output directories fail closed.

Private server bundles, server-only maps and trace metadata remain outside the public content scan. Browser JavaScript is intentionally public. This inspection is a release safeguard, not an authorization control, comprehensive secret scanner or code obfuscator.

## Evidence

- The earlier clean build inspected 263 files, including 239 text assets and 7,723,783 text bytes, with no finding against locally configured private values. It is preliminary evidence, not the final integrated candidate.
- The initial candidate clean production build completed at 2026-09-12T08:26:13Z. The final build, including the emitted-header guard, completed at 2026-09-12T08:36:23.7042366Z. It compiled successfully and passed build lint/types plus artifact inspection: 263 files, 239 text assets, 7,723,613 text bytes. Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. The same emitted artifacts also pass comparison against locally configured private values without exposing or copying those values into evidence.
- All 57 focused checks pass, including 40 new artifact regressions and the existing production-maintenance/public-environment/privileged-import boundaries. Synthetic fixtures cover map files/comments, each rendered/static surface, secret encodings, provider/JWT formats, unsafe or malformed configuration, symlinks, missing outputs, oversized files and value-free CLI failure. New sources, tests and configuration pass lint. No test invokes production business/provider operations.
- At 2026-09-12T08:23:36Z, four rendered production pages and 38 referenced same-origin assets passed private-value/format inspection and had no `SourceMap` or `X-SourceMap` response header. `/account` retained its expected 307 redirect to the customer login surface. Six environment/repository/server-file requests returned 404.
- Six custom-script map requests and six Next chunk-map requests returned 403. A sampled Next map response was a **Vercel Security Checkpoint**, so those denials do not prove how the origin would answer a permitted map request. No challenge was bypassed. The complete local artifact inventory independently contained no public map files or debug references; the new gate checks every candidate before delivery.

## Limits and delivery

Content scanning covers the named text formats up to 32 MiB each; it does not decode arbitrary binary assets, unknown credential formats or arbitrary obfuscation. Configured-value comparisons only cover secrets available to the checking process and at least eight characters long. The clean build uses synthetic public settings; the deployment check receives the build environment. Dynamic authenticated responses, old deployments/CDN objects, provider log retention and previously documented administrative/staging limits are not certified by this inspection. Existing server-side authorization and data minimization remain required.

After the initial live audit, the architecture task confirmed a Vercel automatic System Rule Challenge beginning at 01:23 PDT; fresh automated application health probes then received the same checkpoint. All tasks paused site probes while it was investigated. The candidate was prepared externally while the preceding releases completed their delivery verification. No mitigation setting was changed or challenge bypass attempted. At 08:42:18Z the architecture task observed the normal root response again using the unchanged client; its prepared support report was not sent. Production probes remain serialized with the release owner.

An additional isolated full-suite run was interrupted at 08:50 UTC to release CPU for the shared release owner. No test failure had been reported, but this incomplete run is not a passing validation gate. The completed focused checks and clean production build above remain separate evidence.

Final integrated validation is recorded below. Task-only publication and exact deployed verification remain required; Step 26 has not begun.

## Preserved integration base

- Architecture browser verification and its challenge-aware correction culminated in `0f5e0c31084dc53d58442202cea7ad6f761e1af0`, with [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5UyvzVyCnUUwncbhTDV5VkZkT8MG), 6,851 tests and fresh boundary/health checks at 08:58:31–33 UTC.
- TV recovery release `4cffa0ca81b34e43de867b6c70c8f01e9a2350cb` has [exact Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/DKinN4xjQv4D8dt4Mzc6fLhxCkar). Its delivery receipt records 6,861 tests and four successful public checks at 09:08:59 UTC. User-triggered browser verification recovery, cache intent and restored rendering remain intact.
- Independent review `088bc541dc35c41d99e26953a650dcc6cd506af1` changes only its report. Its [exact deployment](https://vercel.com/ai-movie-jobs/shiftstage/GJvZMKEge4Y5XK6Li9DGeGwSpvLN) succeeded, all 6,861 tests and the canonical gates passed, and eight bounded live checks passed at 09:25:30 UTC. Its author handed over the tracked-clean matching main at 09:26:54 UTC. The uploaded user screenshot remains untracked and is preserved by content hash outside this release.

The exact Vercel statuses above were independently read for this security integration; the other tasks' health observations retain their stated provenance. Step 25 uses the complete combined release gate, including a separate local comparison against configured private values after the real-config production build. The scanner makes no provider call and emits only aggregate inspection counts.

## Initial integrated validation

On `088bc541dc35c41d99e26953a650dcc6cd506af1`, the complete release command passed all **6,901 tests** with zero failures, skips or cancellations, both dependency audits, route type generation, standalone TypeScript, full lint and the production build. The migration guard passed across 162 frozen files and postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. The artifact guard inspected **263 files**, including **239 text assets and 7,726,442 text bytes**. The separate local check with configured private values also passed without printing any values. All five source/config/test files retain their validated hashes; only audit evidence was finalized afterward. The user screenshot is preserved by hash and remains outside the eight-file release. Completion of validation: 2026-09-12T09:33:35.7136695Z.

Task-only commit/push, matching main, exact Vercel success and bounded deployed health remain the delivery gates before Step 26.

## Push-protection fixture correction

GitHub rejected the push of unpublished task commit `e678c6a1cf3ec7d9221bb3a5667047bbec444fd4` because a deliberately synthetic Stripe-format test literal matched its credential detector. Remote main remained `088bc541dc35c41d99e26953a650dcc6cd506af1`; no deployment started. The fixture now assembles the same synthetic value at runtime, and all forty artifact regressions pass. No real credential, provider request, protection-setting change or unblock exception is involved. This observes enforcement for the reported pattern, not every repository-administration setting. The complete gate is rerun before amending only the unpublished task commit and retrying publication. GitHub documents removing a detected value and amending the latest commit before retrying the push. [GitHub guidance](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/work-with-leak-prevention/push-protection-on-the-command-line).

## Step 25 final corrective validation

The complete corrected release gate passed at 2026-09-12T09:43:52.8066047Z: all **6,901 tests**, zero failures/skips/cancellations, dependency and signature audits, route type generation, standalone TypeScript, full lint and production build. Both artifact inspection and the separate configured-private-value comparison passed with 263 files, 239 text assets and 7,726,442 text bytes. Postbuild skipped population. All five frozen source/config/test hashes match, and the unrelated screenshot retains its original hash. Only the test fixture and its audit records changed after the rejected push. The unpublished commit is amended before retrying publication; exact successful deployment and bounded health checks still precede Step 26.
