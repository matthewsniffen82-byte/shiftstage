# Supabase setup

MyDancr already has a production Supabase project. Do not create a replacement production database or run an old partial schema setup against it. See the [current architecture audit](supabase-reliability/README.md) and [migration safety procedure](supabase-reliability/migration-safety.md).

## 1. Select the correct environment

Use the existing configured project for production read-only checks. Schema replay and destructive failure tests require an explicitly designated disposable Supabase project. No project should be assumed disposable merely because it is available in the account. For the selected environment, use its own:

- Project URL
- Public anon key
- Service role key

Keep credentials in that environment's secret configuration. The service-role key belongs only in trusted server processes. Never copy production service-role access into frontend code or use it for test-data setup in an unverified project.

## 2. Run the database schema

Run `npm run db:check-migrations` before preparing a database change. Historical version collisions and ledger gaps mean the current directory is not yet certified for clean replay. Follow the reconciliation procedure linked above; do not run only the initial schema/auth files or blindly push all apparently missing versions. Every schema change needs a reviewed migration, a disposable-environment test, and a recovery path.

## 3. Run the storage setup

The live project has ten storage buckets with existing ownership and moderation policies. Preserve those policies. The architecture audit records current public/private status, limits and MIME types. Identity-document collection has been retired; the legacy `verification-documents` bucket is private and must not be treated as an instruction to collect new identity files. Database backups do not include storage object bytes.

## 4. Configure auth

Set the production site URL to:

`https://www.mydancr.com`

Add redirect URLs for:

- `https://www.mydancr.com/auth/callback`

The fresh production audit found only that canonical callback in the additional redirect allowlist. Keep development and preview callbacks in their own test environment; do not widen production redirects as a setup shortcut.

### Auth email sender

Use Resend for production confirmation emails so Supabase does not use its limited built-in sender.

1. In Resend, verify the sending domain `mydancr.com`.
2. Add the DNS records Resend gives you at the domain registrar.
3. Create a Resend API key.
4. In Supabase, go to Authentication -> Settings -> SMTP Settings.
5. Enable custom SMTP and use:
   - Sender email: `no-reply@mydancr.com`
   - Sender name: `Mydancr`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the Resend API key
6. Send a test email from Supabase, then test a real customer signup.

If signup says the email rate limit was exceeded, wait for the Supabase rate window to clear, then try again after custom SMTP is enabled.

## 5. Add Vercel environment variables

Use `.env.example` as a reference for required and optional integrations. Configure each deployment environment with its own intended Supabase target; do not blindly copy all production values to development or previews.

The first required values are:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The admin monitoring panel also checks:

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_DANCER_MONTHLY_PRICE_ID`
- OneSignal: `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`
- Resend: `RESEND_API_KEY`, `EMAIL_FROM`

Use this production email value:

`EMAIL_FROM=Mydancr <no-reply@mydancr.com>`

## 6. Verify the existing integration

Run `node scripts/check-supabase-readiness.mjs` with the selected environment's server credentials supplied securely. It performs read-only connectivity, schema-presence and access checks. Run the full test suite, TypeScript check, lint and production build before release. Real signup/password-reset email tests require designated disposable accounts. Check Vercel success for the exact pushed SHA and both deployed health endpoints. Application deployment does not apply SQL migrations.

## Auth behavior

Customer signup creates:

- `app_users` with role `customer`
- `customer_profiles` with private notification settings

Dancer signup creates:

- `app_users` with role `dancer`
- `dancer_profiles` with private account fields; legacy identity fields are not a request to collect identity documents
- `stage_name` for the public profile cards
- `draft` profile status until setup and approval are complete

The current Auth trigger and `provision_app_account_safely` support account initialization with email confirmation enabled. Later migrations supersede the original bootstrap logic. Use the current function definitions and provisioning/recovery tests when diagnosing account setup; do not replay the original bootstrap migration to repair one account.
