# Dancr

Premium nightlife schedule discovery prototype.

This is a static HTML demo. The root `index.html` forwards to `outputs/index.html`.

## Live stack foundation

Production backend planning has started in:

- `docs/live-stack.md`
- `docs/backend-roadmap.md`
- `docs/supabase-setup.md`
- `supabase/migrations/202606250001_initial_schema.sql`
- `.env.example`

The current visual prototype stays in `outputs/index.html` while the real Supabase, Stripe, notification, approval, and dashboard systems are built behind it.

The first production app service layer lives in `src/lib`. It provides Supabase clients and Dancr service functions for auth, public pages, customer actions, dancer profile controls, shift posting, and dashboard analytics.
