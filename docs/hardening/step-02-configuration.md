# Step 2 — environment and configuration

Step 1 was pushed as `47d165470d4ed4682497da7c21f6f3068fbd071f`.
[Its exact Vercel deployment](https://vercel.com/ai-movie-jobs/shiftstage/BuBuhC8QsruRGBPusXGmpBbXHTEP)
succeeded, followed by four passing production HTTP checks at
2026-09-09 14:54 UTC. This step began afterward.

## Inspection

Reviewed environment reads in application routes, middleware, Supabase clients,
provider adapters, maintenance scripts, Next/Vercel configuration and the example
environment contract. No private environment values were copied into the checkout,
tests, reports or build logs.

| Configuration area | Existing protection / finding | Step 2 treatment |
| --- | --- | --- |
| Public environment | Next already rejects private names, known secret formats, private JWTs, credential URLs and copies of configured server secrets | Preserve that guard |
| Explicit Next `env` | `DANCR_VIDEO_MODERATION_MODE` is embedded in browser assets without the NEXT_PUBLIC prefix; invalid values were rejected only when used at runtime | Reject unsupported values before bundling; preserve both currently supported modes and their case/whitespace behavior |
| Public Supabase configuration | URL security, missing values, anon/publishable key type and hosted JWT project match already checked | Vercel production also rejects loopback URLs; retain local Supabase development |
| Admin Supabase configuration | Server-only client, bounded transport and disabled session persistence; missing secret rejected, but wrong key type/project was accepted until an API failure | Check supported privileged key family and hosted legacy JWT project match before constructing the client |
| Required server variables | Empty strings rejected; whitespace-only strings accepted | Reject whitespace-only values; preserve valid credential bytes and optional-variable semantics |
| Public app URL aliases | Production callback/link generation already canonicalizes to MyDancr and rejects external origins | Preserve current behavior; the unused `getPublicEnv().siteUrl` compatibility field is unchanged |
| Optional integrations | Stripe, OpenAI, notifications and NATS check configuration when their feature runs; several request-signing boundaries still fall back to the server-only service key | Preserve feature availability, fallback compatibility and payout defaults; do not invent credentials or require every optional provider at startup |
| Demo operations | Four exact opt-in postbuild flags can trigger production data operations | Flags were absent in the Step 0 production dashboard inspection and cleared for local builds; no script/data operation executed here |

The new server check accepts legacy `service_role` JWTs and `sb_secret_` keys,
matching the [Supabase key contract](https://supabase.com/docs/guides/getting-started/api-keys).
It rejects anon/publishable/user tokens, ordinary placeholders, malformed keys
and hosted JWT project mismatches with value-free errors. It does not verify a
signature or grant authority: Supabase remains responsible for credential
validation, and every application authorization boundary remains in place.

## Verification

Runtime fixtures exercise the actual configuration functions and admin factory
with synthetic credentials. They verify that invalid configuration creates no
client and issues no network request; valid configuration retains bounded fetch
and all three disabled Auth session options. Tests also cover loopback production
targets, optional/missing settings, exact credential preservation and secret-free
errors. An AST inventory test requires review if Next gains another explicit
browser environment property. The server configuration module is included in
the existing privileged import boundary regression.

Initial focused checks passed 26 tests with no skips. The full combined suite
passed 2,880 tests with zero failures or skips, TypeScript, zero-warning lint and
the production build. Independent submission-burst protections (`68a04ea1`)
were preserved before that run. A later video resource-cleanup change
(`3b589b18`) was preserved. Final combined validation passed all 2,886 tests with
zero failures or skips, TypeScript, zero-warning lint and the production build.
The migration guard passed 132 frozen files and postbuild demo operations were
skipped. Exact deployment verification is required before advancing to Step 3.

## Limits and manual configuration

- Opaque Supabase keys and custom-domain JWT configurations cannot be reliably
  matched to a project offline. A syntactically valid placeholder can still pass
  format checks; the provider health check is the operational verification.
- No staging Supabase project or isolated test accounts have been designated.
  Preview/development credentials must be scoped to their intended environment
  in Vercel; no new project, paid branch or credential rotation was configured.
  The localhost build restriction uses `VERCEL_ENV=production`; it does not
  establish environment isolation for arbitrary standalone hosts.
- Required configuration is checked at its existing feature boundary, avoiding
  a global outage when an unused optional provider is not configured.
- Independent signing secrets are documented in `.env.example`; replacing a
  shared signing fallback requires reviewing outstanding signed links/cookies.
- The current explicit demo moderation mode remains supported. Step 2 does not
  switch moderation policy, billing settings or other business rules.
- Legacy production postbuild data flags remain a deployment risk if re-enabled;
  dashboard owners should keep them unset outside a separately approved operation.

No dependency, paid service, subscription, scheduled run or provider request was
added. Configuration checks run locally in-process and add no external usage.
No database schema, RLS, account data or dashboard configuration was modified.
