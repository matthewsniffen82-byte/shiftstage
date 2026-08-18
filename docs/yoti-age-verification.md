# Yoti age verification

MyDancr uses Yoti's hosted Age Verification Service (AVS) as a site-wide 18+ gate. The feature is opt-in and fail-closed: production traffic is gated only when `YOTI_AGE_VERIFICATION_ENABLED=true`, and an enabled deployment without complete credentials cannot issue an age pass.

## Privacy boundary

Yoti performs the camera, Digital ID, or document interaction on its hosted service. MyDancr stores only:

- a random internal reference;
- SHA-256 hashes of the Yoti session and request fingerprint;
- pending/pass/fail state, verification method, and timestamps;
- the configured minimum age, never the person's exact age.

MyDancr does not store dates of birth, exact ages, ID images, document numbers, selfies, or biometric media. Audit rows are deleted opportunistically after 90 days. The browser receives a signed, HttpOnly, SameSite cookie containing only a random reference and verification/expiry timestamps.

## Yoti Hub setup

1. Create a Yoti Age Verification application in Yoti Hub.
2. Allow hosted AVS sessions for the production domain.
3. Copy the Age API key and SDK ID into the production secret store.
4. Apply `supabase/migrations/202608180004_yoti_age_verification.sql`.
5. Generate a high-entropy cookie secret of at least 32 characters.
6. Configure the variables below with the gate still disabled.
7. Test the Yoti callback on the production HTTPS domain, then set `YOTI_AGE_VERIFICATION_ENABLED=true`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `YOTI_AGE_VERIFICATION_ENABLED` | Activates middleware enforcement only when exactly `true`. |
| `YOTI_AGE_API_KEY` | Server-only bearer token from Yoti Hub. |
| `YOTI_AGE_SDK_ID` | Yoti application SDK ID. |
| `YOTI_AGE_COOKIE_SECRET` | Server-only HMAC secret, at least 32 characters. |
| `YOTI_AGE_MINIMUM_AGE` | Access threshold, clamped to 18 or older. |
| `YOTI_AGE_ESTIMATION_THRESHOLD` | Facial-estimation threshold; defaults to Challenge 25. |
| `YOTI_AGE_SESSION_TTL_SECONDS` | Hosted Yoti session lifetime; defaults to 900 seconds. |
| `YOTI_AGE_COOKIE_DAYS` | Browser proof lifetime; defaults to 30 days. |

The session enables passive-liveness age estimation at 25 and offers Digital ID/document fallbacks at 18. Yoti redirects to `/age-verification/callback`; the server independently fetches and validates the result before issuing the signed cookie.

## Operational checks

- `GET /api/health` reports only whether Yoti is enabled/configured; it never returns credentials.
- Platform monitoring lists Yoti alongside the other production integrations.
- Five session starts per browser/network fingerprint are allowed within 15 minutes.
- Health checks, signed cron requests, Stripe webhooks, Yoti endpoints, and static assets bypass the browser gate. All product pages and product APIs require the signed age cookie when enforcement is enabled.
