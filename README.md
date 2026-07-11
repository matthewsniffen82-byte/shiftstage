# Dancr

Premium nightlife schedule discovery live app.

Dancr is a Next.js, Supabase, Vercel, and TypeScript application. Public discovery pages, dashboards, approvals, photo moderation, schedules, notifications, venues, and account tools are served from the live app and database.

## Live Stack

The production app is implemented across:

- `docs/live-stack.md`
- `docs/backend-roadmap.md`
- `docs/supabase-setup.md`
- `supabase/migrations/202606250001_initial_schema.sql`
- `.env.example`

The app service layer lives in `src/lib`. It provides Supabase clients and Dancr service functions for auth, public pages, customer actions, dancer profile controls, shift posting, dashboard analytics, approvals, notifications, support, billing, and image moderation.

## Production routes

- `/` serves the live database-backed Dancr homepage
- `/tonight`, `/dancers`, `/venues`, `/dancers/[slug]`, and `/venues/[slug] serve live public discovery pages
- `/account` handles live auth and account access
- `/dashboard/customer`, `/dashboard/dancer`, and `/dashboard/venue` serve authenticated dashboards
- `/admin` serves the live admin console
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
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`

## Dancr Image Moderation

Dancr dancer photo uploads now go through a server-side OpenAI moderation pipeline before any image can become public.

### Setup

1. Run `npm install` so the official `openai` Node.js SDK from `package.json` is installed and `package-lock.json` is refreshed.
2. Add `OPENAI_API_KEY=` to local `.env.local`.
3. Add `OPENAI_API_KEY` to Vercel Project Settings for Production, Preview, and Development.
4. Do not create `NEXT_PUBLIC_OPENAI_API_KEY`; the key is server-only.
5. Apply `supabase/migrations/202607100001_image_moderation.sql`.
6. Confirm these private buckets exist: `dancr-image-moderation-temp` and `dancr-image-moderation-review`.
7. Keep `dancer-photos` as the approved photo bucket. Public storage policies only expose approved dancer photos.

### How It Works

`POST /api/dancer/photos` requires authentication, validates bytes and image signatures, strips common metadata, rate-limits attempts, stores the upload privately, calls OpenAI `omni-moderation-latest`, and evaluates the result with `evaluateDancrImageModeration`.

Decisions:

- `approved`: the sanitized image is copied to `dancer-photos`, a `dancer_photos` row is created, and the public URL may be used.
- `review`: the image remains private in `dancr-image-moderation-review` and appears in `/admin` under Image Moderation.
- `rejected`: the private object is deleted after the audit record is written.

The decision engine does not reject lingerie, bikinis, thongs, cleavage, body tape, or revealing promotional poses just because OpenAI reports sexual signal. Ambiguous sexual scores go to manual review. Clear minor-safety signals, graphic violence, self-harm, and high-confidence explicit sexual content reject.

Thresholds are server-side:

- `DANCR_SEXUAL_REVIEW_THRESHOLD`
- `DANCR_SEXUAL_REJECT_THRESHOLD`
- `DANCR_VIOLENCE_REJECT_THRESHOLD`
- `DANCR_SELF_HARM_REJECT_THRESHOLD`

These must be calibrated using a private, legally obtained test set representing Dancr’s allowed and prohibited photo categories. A general moderation classifier may not perfectly distinguish barely covered breasts from prohibited nipple or areola exposure.

### Admin Queue

Admins use `/admin`, Image Moderation. The queue shows a short-lived signed thumbnail, upload context, reason codes, category flags/scores, provider model, notes, and Approve/Reject actions.

Approving publishes the image to `dancer-photos`, creates the profile/gallery photo record, records `reviewed_by` and `reviewed_at`, and removes the private review object. Rejecting keeps the audit record, deletes the private object, and sends a neutral notification.

### Testing

Mock OpenAI in automated tests; do not send real user photos. Minimum cases to cover:

- clothed portrait, bikini, lingerie, thong without exposure, cleavage, and body tape return approved or review, not automatic rejection for skin alone
- visible nipple/areola, exposed genitalia, explicit sex act, suspected minor, graphic violence return rejected
- unsupported type, oversized file, fake extension/invalid bytes fail before OpenAI
- OpenAI timeout returns review, never approve
- missing `OPENAI_API_KEY` returns a server configuration error and never publishes
- non-admin queue access is blocked
- approved images become public only after moderation or admin approval
- rejected images never publish
- duplicate idempotency keys do not create duplicate uploads

### Deployment Verification

After deploying:

1. Run `npm install`, `npm run build`, and any project tests.
2. Verify `OPENAI_API_KEY` is present only in local `.env.local` and Vercel server environment variables.
3. Verify no OpenAI key appears in `.next/static`, browser bundles, API responses, logs, or Supabase rows.
4. Apply the migration and confirm RLS is enabled on `image_moderation_records`.
5. Confirm normal users can read only their own moderation status and cannot edit provider decisions.
6. Confirm admins can list and resolve review records.
7. Confirm temp/review storage objects do not have public URLs.
8. Upload an allowed test image and confirm it publishes only when the decision is approved.
9. Upload a review test image and confirm it appears only in the admin queue.
10. Upload a rejected test image and confirm it never appears publicly.

### Cleanup And Rollback

Create a scheduled Supabase job or Vercel cron to delete abandoned objects from `dancr-image-moderation-temp` after 24 hours. Do not delete unresolved `review` records or their review-bucket images.

Rollback by reverting the code and disabling the `/api/dancer/photos` route deployment. Keep `image_moderation_records` for audit unless legal counsel approves deletion. Do not make pending/review bucket contents public during rollback.
