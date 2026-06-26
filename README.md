# Dancr

Premium nightlife schedule discovery prototype.

The current visual prototype lives at `outputs/index.html`. The production app shell is a Next.js app so Dancr can add real API routes while preserving the existing preview URL.

## Live stack foundation

Production backend planning has started in:

- `docs/live-stack.md`
- `docs/backend-roadmap.md`
- `docs/supabase-setup.md`
- `supabase/migrations/202606250001_initial_schema.sql`
- `.env.example`

The current visual prototype stays in `outputs/index.html` while the real Supabase, Stripe, notification, approval, and dashboard systems are built behind it.

The first production app service layer lives in `src/lib`. It provides Supabase clients and Dancr service functions for auth, public pages, customer actions, dancer profile controls, shift posting, and dashboard analytics.

## Production routes

- `/` redirects to `/outputs/index.html`
- `/outputs/index.html` serves the current Dancr prototype
- `/api/health` verifies the Next.js API runtime is deployed
- `/api/health/supabase` verifies the Vercel app can reach Supabase
- `/api/public/dancers` and `/api/public/venues` serve public discovery data
- `/api/account`, `/api/customer/*`, and `/api/dancer/*` serve authenticated app workflows
- `/api/admin/*` serves admin-only approval, venue, subscription, and ranking tools
- `/api/stripe/webhook` receives Stripe subscription webhooks

## Go-live checklist

1. Install dependencies with `npm install`.
2. Run `npm run build` and confirm it completes without errors.
3. Apply the Supabase migrations in `supabase/migrations`.
4. Create the Supabase storage buckets and policies from the storage migration.
5. Set production environment variables in Vercel from `.env.example`.
6. Configure the Stripe webhook endpoint to point at `/api/stripe/webhook`.
7. Deploy `main` to Vercel.
8. Verify `/api/health` and `/api/health/supabase` in production.

Required production environment variables:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DANCR_ADMIN_SEED_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_DANCER_MONTHLY_PRICE_ID`
