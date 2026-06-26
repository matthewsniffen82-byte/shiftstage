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
- `/api/health/supabase` verifies the Vercel app can reach Supabase
