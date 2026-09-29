# MyDancr internal roster integration

## Existing architecture

MyDancr is a Next.js App Router application with an existing generated public discovery shell, custom Supabase session transport, and server-authorized dancer, venue, and admin workflows. Supabase owns canonical dancer profiles, approved avatars, Ondato results, club affiliations, and NFC shifts. Working Now lasts six hours, followed by a six-hour global cooldown; a retap must not extend a shift or move it between clubs.

The separate Club Roster project provides staff rosters, table requests, and entrance displays. Its independent accounts, uploaded photos, and manually started shifts cannot become a second source of dancer identity or consent. The integration belongs in MyDancr at `/internal`, with club staff authenticated through their existing MyDancr venue account. The standalone project's database and unrelated work remain intact.

## Visibility contract

Each dressing-room tap requires an explicit choice before submission:

| Choice | Internal club roster | External MyDancr |
| --- | --- | --- |
| Internal only | Canonical approved avatar and stage name; click to open full profile | Absent from external discovery |
| External only | Absent | Existing full public profile |
| Both | Stage name and the canonical approved avatar | Existing full public profile |

No channel is selected implicitly and neither is not a valid check-in choice. Internal consent applies to the confirmed club shift. Public-profile privacy remains in effect after the shift ends until another explicit eligible tap changes it; expiry never silently republishes a profile. Existing dancers are not automatically opted into the internal roster. Signup and profile moderation stay shared; Ondato verification must precede a new channel-aware check-in.

Every dancer completes the full profile during onboarding, regardless of visibility choice. Internal cards show the same canonical approved avatar and stage name. Clicking a card opens the complete customer-facing profile through the club's authorized roster context, including approved gallery and social links. Internal-only profiles stay out of external discovery. Legal identity, verification documents, and private contact information are never included. Private media are fetched through an authorized, uncached endpoint. Already downloaded media cannot be recalled.

## Implementation phases

1. Add service-only consent storage, an atomic channel-aware NFC entry point, and a database publication guard. Preserve established affiliation, moderation, disabled-account, club-removal, timing, and cooldown rules. Add behavioral database tests for all visibility choices and failed/replayed taps.
2. Replace automatic dancer check-in with an explicit three-choice confirmation. Suppress public follow notifications for internal-only taps and show the selected visibility in the result.
3. Add the MyDancr internal staff roster, club-scoped table request queue, and revocable table/display links. Reuse existing venue ownership and team authorization; internal rosters derive from eligible active NFC shifts, never duplicated dancer records.
4. Validate affected API/database/UI workflows, inspect the final diff, apply only the reviewed additive migration, commit task files, push `origin/main`, and verify Vercel success for that exact commit.

## Security and operations

All mutations and reads require server-side authorization. New operational tables use RLS with no anonymous or authenticated direct grants. Guest table and display links are revocable bearer capabilities; possession grants access to that club's opted-in roster only. Do not publish these links as public discovery links. Staff can revoke them if a link leaves the club. Revocation, shift expiry, account suspension, affiliation removal, and internal opt-out remove access on the next uncached request; clients clear stale cards on refresh failures.

Existing Ondato server credentials and Supabase environment variables are reused. No identity documents, duplicated avatars, or separate staff credentials are transferred from Club Roster. Physical NFC placement, real Ondato completion, and operational club acceptance require an on-site acceptance check.

## Routes and data

- `/internal`: venue owner, manager, and staff workspace. Staff can acknowledge/complete/dismiss requests; only owners/managers create or revoke links.
- `/internal/club/[token]`: table roster/request screen or rotating entrance display, depending on link type. Selecting the avatar opens approved photos, videos, and social links within the club context, including for Internal-only dancers.
- `/internal/sign/[token]`: printable QR sign. Configure `NEXT_PUBLIC_SITE_URL` to the canonical deployment origin.
- `/api/internal`: authenticated workspace snapshot and mutations; `/api/internal/link/[token]` handles capability-scoped table/display reads and requests. Profile and media endpoints revalidate membership and capability on every request. Responses use `private, no-store`.

`dancer_channel_preferences` preserves the last explicitly chosen discovery visibility. `dancer_shift_channels` connects opt-in to the canonical NFC shift. `dancer_channel_tap_receipts` makes retries idempotent without letting an old retry overwrite newer consent. `internal_roster_links` and `internal_roster_requests` provide club-scoped operations. Request acknowledgements mean staff saw a request, not that a dancer accepted it. Profile and avatar ownership remain with the dancer.

Three forward migrations implement the integration:

1. `20260928090000_mydancr_internal_channels.sql`: decouple established NFC approval/presence eligibility from external discovery visibility.
2. `20260928090100_mydancr_internal_roster.sql`: consent, atomic check-in, publication guard, service-only roster and operational schema/RPCs.
3. `20260928090200_channel_aware_publication_receipt.sql`: report channel consent when private accounts are resumed or visibility is changed.

Apply these explicitly, in order, with the existing migration safety procedure. Do not replay historical migrations. No new external credentials or npm dependencies are required. The standalone Club Roster's legacy TV pairing, push worker, and venue-specific geofence remain in that separate project; this integration uses revocable club links and MyDancr team access. It does not import that project's staff, dancers, images, or request history.

## Validation and acceptance

The focused integration suite covers all three choices, mandatory profile/age verification, retries, cross-club isolation, cooldowns, suspension/revocation/expiry, avatar identity, capability profile/media access, table requests, staff permissions, and safe publication receipts. A transaction-only rehearsal against the current MyDancr schema confirms the migrations execute and browser roles cannot invoke protected functions; the rehearsal rolls back.

The browser-control service exposed no available browser during implementation. Client compilation, focused TypeScript and lint checks can run locally, but mobile visual inspection is an outstanding acceptance check. Before club use, complete a real Ondato onboarding and physical sticker tap for each choice, open the internal avatar profile from a table QR, confirm external discovery follows the choice, and verify the entrance screen clears after checkout or revocation.
