# Step 2 — secrets and environment configuration

Source baseline: `50d4eb543dbfc93dbed6f0663c51aa2332542cb4`.

Before delivery, the independently published venue change `e60f1a64a1ecbead7b63c9e340e8edcfe69fcc15` was fast-forwarded into this checkout. Its files are not part of the Step 2 change. Complete validation is repeated on the integrated source.

The subsequent crop-session fix `6ef753e2a654d52a8621eed508d30072311b4a40` was also integrated and fully revalidated. A later performance-audit commit added only documentation and diagnostic scripts; it changed none of the application, tests, dependencies or build configuration. Its added scripts passed a separate lint check.

Further independently published UI changes were integrated and validated. Upstream commit `43d851ba` then patched the baseline dependency findings: Next 15.5.24, Sharp 0.35.4, qs 6.16.0 and js-yaml 4.3.2. The subsequent registry audit reports zero vulnerabilities. These upstream dependency changes are preserved; they are not part of the Step 2 patch. Step 23 will recheck their status.

## Finding and change

The existing build validated Supabase's public URL/key, and server-only imports already protected privileged library modules. However, another NEXT_PUBLIC variable could contain a provider secret, service-role JWT, private connection URL or an opaque server credential without the configuration guard rejecting it. That is an accidental publication risk; this review found no active credential exposure.

The Next configuration now validates all nonempty NEXT_PUBLIC variables before constructing the exported build configuration. It rejects reserved private-variable names, recognizable private credential formats, private/authenticated JWTs, credential-bearing URLs and values that contain configured server secrets. Error messages identify only a sanitized variable name. Intended anon/publishable keys, browser-restricted map keys, site URLs and public application IDs remain supported. Existing Supabase-specific validation remains in place.

The validator is a build safeguard, not an authentication or token-signature verifier. It cannot identify every possible undocumented secret format and does not replace provider access control or secret scanning.

## Audit evidence

- 885 tracked text files and 199 browser/static files were scanned before this change.
- 1,420 reachable text objects from the latest 100 commits, approximately 165 MB, were scanned for configured private values and recognizable private-key/provider patterns. No matches were found. This is a bounded history review, not proof about all historical or unreachable commits.
- A separate service-role JWT scan after incorporating the upstream venue commit checked 1,441 reachable text objects from the latest 100 commits and found no privileged JWT literals.
- The live root page and seven same-origin scripts were scanned for known locally configured private values; no matches were found.
- The existing local environment passed the new guard. No credential value was printed or written to audit evidence.
- .env patterns are ignored by Git, with .env.example explicitly allowed. The example contains variable names and placeholders, not credential values.
- Privileged module/import-graph tests passed; the service-role client and private environment helper retain server-only boundaries.
- Provider log contents, all Vercel environment settings and third-party account consoles were not available through this scan. The exact production build provides an additional check of the values available to that build.
- The locally configured administrative signup secret was flagged for a strength review; length alone does not establish predictability or compromise, and the production value was not inferred from it. Step 7 must review the bootstrap mechanism and production secret strength. No value or exact length is recorded here.

No credentials were changed, revoked or rotated. No new secret or paid service was required. No credential is identified for emergency rotation from the evidence obtained.

## Signing-secret rotation preparation

Existing service-role-key fallback behavior is retained because replacing it immediately would invalidate recovery links, claim/verification tokens or other signed artifacts. Independent per-purpose secrets are already documented in .env.example. The NFC browser-account deterrent also derives its signature from the service-role credential.

If exposure is later confirmed:
1. Identify the credential and affected provider without placing its value in an issue, log or commit.
2. Prepare a replacement in the provider's secure console and inventory every server environment and signing purpose that consumes it.
3. Where supported, deploy a short, explicitly bounded overlap for signed artifacts; set independent per-purpose keys and verify the affected flows in staging.
4. Deploy and verify the replacement before revoking the old provider credential, unless incident containment requires immediate revocation.
5. Confirm old credentials fail, inspect minimized access/audit logs and remove any temporary overlap. Plan invalidation/reissuance of recovery or invitation links where overlap is unsafe.
6. Remove exposed material from published artifacts/history after coordinating with repository owners; rewriting Git history is not a substitute for revocation.

No source history was rewritten during this task.

## Regression coverage

Six new tests cover intended public configuration, secrets hidden under innocent public names, opaque/encoded secret copies, reserved private names, log-safe errors, and the configuration hook. Eighteen focused environment/server-boundary/image-preview tests pass. The integrated full suite passed all 1,972 tests with zero failures/skips; lint, TypeScript and the production build passed, including the migration history gate. Postbuild reported LAYOUT_REVIEW_POPULATION_SKIPPED. Deployment evidence is recorded in execution-ledger.md after verification.
