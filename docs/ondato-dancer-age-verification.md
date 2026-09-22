# Ondato dancer age verification

Ondato is the only active verification provider. Dancers submit their private profile and accept the Dancer Agreement, verify age 18+ using government photo ID and a live selfie, then complete their first dressing-room tap. Customers and venues do not use this flow. Club approval remains separate.

## Production setup

1. Apply only `20260922010000_dancer_ondato_age_verification.sql` after the existing migrations, following [migration safety](supabase-reliability/migration-safety.md). This forward migration preserves the rollout switch and historical records, and changes session reservation, publication, shift and first-tap guards to Ondato. Never edit or replay historical migrations. Vercel does not apply SQL.
2. Obtain a **live Ondato IDV project and setup** requiring government photo ID, selfie, face match, passive liveness and minimum age 18. Required successful KYC rules are `SelfieHasFace`, `DocumentHasFace`, `SelfieAndDocumentFacesMatch`, and `SuccessfulPassiveLivenessCheck`. The application also checks the document DOB itself. Age estimation alone does not satisfy this dancer onboarding flow.
3. Configure these **server-only Vercel Production variables** using credentials supplied by Ondato:

   | Variable | Value |
   | --- | --- |
   | `ONDATO_CLIENT_ID` | OAuth client ID |
   | `ONDATO_CLIENT_SECRET` | OAuth client secret |
   | `ONDATO_APPLICATION_ID` | Application UUID appearing in IDV/KYC resources |
   | `ONDATO_SETUP_ID` | IDV setup UUID, not the KYC setup UUID |
   | `ONDATO_WEBHOOK_SECRET` | Ondato HMAC webhook secret |
   | `ONDATO_ENVIRONMENT` | `live`, only after confirming the project is live |

   `NEXT_PUBLIC_SITE_URL` must remain the canonical HTTPS site origin. Credentials need permission to create/read IDV sessions, update session localisations and read KYC identifications (`idv_api`, `idv_api_readonly`, `kyc_identifications_api_readonly`). Ondato's production API hosts also serve testing projects: hostname alone does not prove a live check. Retire unused previous-provider credentials. Redeploy after configuring variables.
4. Register `https://www.mydancr.com/api/ondato/webhook` with Ondato using HMAC authentication. Subscribe to `IdentityVerification.StatusChanged`, `KycIdentification.Processed`, `KycIdentification.Approved`, `KycIdentification.Rejected`, and `KycIdentification.Updated`. Confirm this endpoint is reachable under your provider/network configuration.
5. With enforcement still off, complete a live check using a consenting adult's submitted dancer profile. Confirm ID + selfie collection, the hosted return, successful webhook delivery, the expected rule results, and a private `provider='ondato', status='verified'` record. Check the provider's consent and retention settings. Negative tests use synthetic fixtures or a separate test environment, never simulated approvals in Production.
6. Only after the live pilot succeeds, call service-only `public.activate_dancer_age_verification()`. Missing configuration fails closed once enforcement is enabled. This release does not activate enforcement or purchase a provider plan.

## Behavior and privacy

- The server uses OAuth client credentials, creates an IDV session with an opaque attempt UUID, and redirects to `https://idv.ondato.com/?id=…`. IDV session return URLs all point to `/dashboard/dancer?age-verification=returned`. The browser return only requests reconciliation; it cannot grant approval.
- Webhooks require Ondato's raw-body timestamp HMAC and matching application ID. The 25-hour signature age window accommodates the documented 24-hour delivery retry period. Every relevant notification retrieves current IDV and KYC results, so replaying an old approval cannot restore it. Unknown/superseded sessions are ignored.
- Approval requires matching application, setup, session, KYC and attempt references; completed IDV; approved KYC; valid adult document DOB; and successful face/liveness rules. No failed rule is accepted. The request has an 18-second total provider timeout. Failed processing returns non-200 for retries; users can also refresh status.
- Only references, status, timestamps, counters and a pending hosted URL are stored. ID images, selfies, DOB, age, raw provider payloads and credentials are not persisted or logged. Ondato processes its own copies according to the provider agreement.
- Session creation uses the existing database reservation lock and three-start daily limit. Pending/reviewed/verified sessions for the same setup are reused. Duplicate approvals preserve the original verification time, so a previously valid physical tap remains valid. Concurrent updates are conditional on the original attempt and reconciliation timestamp.
- Saved approvals remain available during provider outages. Revocation removes public visibility. Old-provider records do not authorize Ondato access. Private profile setup, account settings, support and deletion remain available; enforcement preserves the original rollout setting.

## Validation and references

Run `node --test tests/ondato-*.test.mjs` plus affected dancer agreement, onboarding and service-role route regressions; scoped ESLint and TypeScript; and `npm run db:check-migrations`. Tests use synthetic data, mocked provider calls and PostgreSQL-compatible role/trigger scenarios. They do not certify live credentials or a completed live pilot.

Official contracts reviewed for this integration: [hosted flow](https://ondato.atlassian.net/wiki/spaces/PUB/pages/2295726818), [OAuth](https://ondato.atlassian.net/wiki/spaces/PUB/pages/2320990304), [webhook HMAC and retries](https://ondato.atlassian.net/wiki/spaces/PUB/pages/2296184995), [session redirects](https://ondato.atlassian.net/wiki/spaces/PUB/pages/2655617031), [IDV OpenAPI](https://idvapi.ondato.com/swagger/v1/swagger.json), and [KYC OpenAPI](https://kycid.ondato.com/swagger/v1/swagger.json).
