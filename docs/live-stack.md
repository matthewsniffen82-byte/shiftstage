# Dancr Live Stack

This repo currently contains the visual prototype in `outputs/index.html`. The production app should keep that visual system, but move all account, profile, shift, payment, notification, approval, and analytics behavior into real services.

## Production Services

- Frontend and hosting: Vercel
- App framework: Next.js
- Database: Supabase Postgres
- Auth: Supabase Auth
- File storage: Supabase Storage
- Payments: Stripe Checkout, Billing, Customer Portal, and webhooks
- Push notifications: OneSignal
- Email: Resend or Postmark
- Maps and directions: Google Maps Platform

## First Production Milestone

1. Create Supabase project.
2. Run `supabase/migrations/202606250001_initial_schema.sql`.
3. Create storage buckets:
   - `dancer-photos`
   - `verification-documents`
4. Add environment variables from `.env.example`.
5. Convert the static prototype into a Next.js app while preserving the current Dancr UI.
6. Connect public pages to Supabase:
   - home
   - dancer profile
   - venue profile
   - tonight
   - dancers
   - venues
   - trending
7. Connect dashboards:
   - customer dashboard
   - dancer setup dashboard
   - approved dancer dashboard
   - admin dashboard

## Required Live Roles

### Customer

- Create private customer account.
- Follow dancers.
- Follow venues.
- Turn notifications on/off.
- Mark Going Tonight or Going to Upcoming Shift.
- Request directions.
- View private dashboard.
- Disable or delete account.

### Dancer

- Create account.
- Provide real name for verification.
- Provide stage name for public profile.
- Upload profile photos.
- Add socials: Instagram, TikTok, Snapchat, X, OnlyFans.
- Wait for approval.
- Start paid subscription after approval.
- Post, edit, cancel, and broadcast shifts.
- Share profile and QR code.
- View analytics and ranking events.
- Disable or delete account.

### Admin

- Review dancer identity.
- Review photos.
- Approve or reject dancer profile.
- Manage venues.
- Manage reported profiles.
- View subscriptions.
- Trigger ranking recalculations.

## Public Privacy Rules

- Pending dancers must not appear in public tabs or profile search.
- Customer profiles are private.
- Customers do not have public profile pages.
- Public pages can view approved dancer profiles without login.
- Follow, notify, and going actions can be anonymous in prototype, but should require a customer account in production unless intentionally designed as anonymous lead capture.

## Launch Order

1. Database and auth.
2. Public approved dancer and venue pages.
3. Dancer signup and approval.
4. Stripe subscription after approval.
5. Shift posting and public schedule logic.
6. Customer follow/notify/going flows.
7. Analytics capture.
8. Notification delivery.
9. Admin dashboard.
10. Custom domain and production monitoring.

