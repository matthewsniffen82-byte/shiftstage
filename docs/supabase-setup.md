# Supabase setup

Use this when turning the Dancr prototype into the live app.

## 1. Create the project

Create a new Supabase project for Dancr production. Save:

- Project URL
- Public anon key
- Service role key

Add them to `.env.local` locally and Vercel environment variables.

## 2. Run the database schema

Open Supabase SQL Editor and run:

`supabase/migrations/202606250001_initial_schema.sql`

That creates the core Dancr tables for customers, dancers, venues, shifts, follows, going signals, notifications, analytics, approvals, and rankings.

## 3. Create storage buckets

Create these private buckets:

- `dancer-photos`
- `verification-documents`

Approved public profile photos should be served through signed URLs or promoted to a public CDN path after approval.

## 4. Configure auth

Set the production site URL to:

`https://dancr.com`

Add redirect URLs for:

- `https://dancr.com/auth/callback`
- `https://shiftstage.vercel.app/auth/callback`
- `http://localhost:3000/auth/callback`

## 5. Add Vercel environment variables

Add every value from `.env.example` to Vercel.

The first required values are:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

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
