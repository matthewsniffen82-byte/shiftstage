# Supabase setup

Use this when turning the Dancr prototype into the live app.

## 1. Create the project

Create a new Supabase project for Dancr production. Save:

- Project URL
- Public anon key
- Service role key

Add them to `.env.local` locally and Vercel environment variables.

## 2. Run the database schema

Open Supabase SQL Editor and run the migrations in order:

`supabase/migrations/202606250001_initial_schema.sql`

Then:

`supabase/migrations/202606250002_auth_bootstrap.sql`

That creates the core Dancr tables for customers, dancers, venues, shifts, follows, going signals, notifications, analytics, approvals, and rankings.

## 3. Run the storage setup

Run:

`supabase/migrations/202606250003_storage_policies.sql`

Then run:

`supabase/migrations/202606260001_content_reports.sql`

That creates:

- `dancer-photos`
- `verification-documents`
- `content_reports`

`dancer-photos` stores profile and gallery photos. Uploaded files stay in review in the database until an admin approves them.

`verification-documents` stores private ID and selfie verification files. Only the dancer owner and admins can read or manage those files.

`content_reports` stores trust and safety reports for admin review.

## 4. Configure auth

Set the production site URL to:

`https://www.mydancr.com`

Add redirect URLs for:

- `https://www.mydancr.com/auth/callback`
- `https://mydancr.com/auth/callback`
- `https://shiftstage.vercel.app/auth/callback`
- `http://localhost:3000/auth/callback`

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

Add every value from `.env.example` to Vercel.

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

## 6. First live features to connect

Build in this order:

1. Customer and dancer auth.
2. Approved dancer public profile pages.
3. Follow, notify, and going signals.
4. Dancer shift posting and profile editing.
5. Admin approval queue.
6. Analytics dashboard.
7. Stripe dancer subscriptions after approval.

## Auth behavior

Customer signup creates:

- `app_users` with role `customer`
- `customer_profiles` with private notification settings

Dancer signup creates:

- `app_users` with role `dancer`
- `dancer_profiles` with `real_name` for verification
- `stage_name` for the public profile cards
- `draft` profile status until setup and approval are complete

The database trigger in `202606250002_auth_bootstrap.sql` also creates these records automatically from Supabase Auth metadata, so account creation still works when email confirmation is enabled.
