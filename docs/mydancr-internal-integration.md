# MyDancr internal roster integration

## Existing architecture

MyDancr is a Next.js App Router application with an existing generated public discovery shell, custom Supabase session transport, and server-authorized dancer, venue, and admin workflows. Supabase owns canonical dancer profiles, approved avatars, Ondato results, club affiliations, and NFC shifts. Working Now lasts six hours, followed by a six-hour global cooldown; a retap must not extend a shift or move it between clubs.

The MyDancr venue dashboard has one **Dancers & tables** section for Internal and External dancers, with channel filters that both include dancers who chose Both. The same section manages club affiliations, table requests, table numbers/names, and printable QR signs. NFC controls working status automatically; there is no manual venue working-status action. The separate Club Roster project remains untouched.

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
3. Add the MyDancr internal staff roster, club-scoped table request queue, and revocable table links. Reuse existing venue ownership and team authorization; internal rosters derive from eligible active NFC shifts, never duplicated dancer records.
4. Validate affected API/database/UI workflows, inspect the final diff, apply only the reviewed additive migration, commit task files, push `origin/main`, and verify Vercel success for that exact commit.

## Security and operations

All mutations and reads require server-side authorization. New operational tables use RLS with no anonymous or authenticated direct grants. Guest table links are revocable bearer capabilities; possession grants access to that club's opted-in roster only. Do not publish these links as public discovery links. Owners and managers can revoke them if a link leaves the club. Revocation, shift expiry, account suspension, affiliation removal, and internal opt-out remove access on the next uncached request; clients clear stale cards on refresh failures.

Existing Ondato server credentials and Supabase environment variables are reused. No identity documents, duplicated avatars, or separate staff credentials are transferred from Club Roster. Physical NFC placement, real Ondato completion, and operational club acceptance require an on-site acceptance check.

## Routes and data

- `/dashboard/venue#venue-dancer-roster`: unified venue roster. Staff can view approved affiliated profiles and acknowledge/complete/dismiss requests. Owners/managers can remove affiliation, allow a new NFC tap, and create, rename, print or revoke table QR links. Removing affiliation ends this club’s Internal and External presence and blocks retapping until allowed; it never deletes the dancer’s account or their other affiliations.
- `/internal`: redirects to the unified venue roster.
- `/internal/club/[token]`: customer table roster/request screen. Selecting the avatar opens approved photos, videos, and social links within the club context, including for Internal-only dancers.
- `/internal/sign/[token]`: printable QR sign. Configure `NEXT_PUBLIC_SITE_URL` to the canonical deployment origin.
- `/api/internal`: authenticated workspace snapshot and mutations; `/api/internal/link/[token]` handles capability-scoped table reads and requests. Profile and media endpoints revalidate membership and capability on every request. Responses use `private, no-store`.

`dancer_channel_preferences` preserves the last explicitly chosen discovery visibility. `dancer_shift_channels` connects opt-in to the canonical NFC shift. `dancer_channel_tap_receipts` makes retries idempotent without letting an old retry overwrite newer consent. `internal_roster_links` and `internal_roster_requests` provide club-scoped operations. Request acknowledgements mean staff saw a request, not that a dancer accepted it. Profile and avatar ownership remain with the dancer.

The forward migrations implement the integration:

1. `20260928090000_mydancr_internal_channels.sql`: decouple established NFC approval/presence eligibility from external discovery visibility.
2. `20260928090100_mydancr_internal_roster.sql`: consent, atomic check-in, publication guard, service-only roster and operational schema/RPCs.
3. `20260928090200_channel_aware_publication_receipt.sql`: report channel consent when private accounts are resumed or visibility is changed.
4. `20260928170000_unified_venue_roster.sql`: service-only unified staff profile scope and active channel metadata, table renaming with stable QR tokens, and revocation of all former entrance-display links. New display creation is rejected. Table links still show only active Internal/Both dancers. Staff can review approved affiliated profiles between shifts; customers cannot.

Apply these explicitly, in order, with the existing migration safety procedure. Do not replay historical migrations. No new external credentials or npm dependencies are required. The standalone Club Roster's legacy TV pairing, push worker, and venue-specific geofence remain in that separate project; this integration uses revocable club links and MyDancr team access. It does not import that project's staff, dancers, images, or request history.

## Validation and acceptance

### Fictional Internal roster

`20260929100000_internal_demo_roster.sql` allows an explicitly marked `demo_locked` shift to use the existing Internal roster and table-request workflow. Eligibility requires the existing layout-review dataset marker, matching synthetic email and profile slug, a disabled Auth login, and the prelaunch age-enforcement setting to remain off. Real dancers still require Ondato verification. Enabling age enforcement disables the fictional exception; affiliation, channel, account, venue and shift-expiry checks apply to both paths.

`scripts/seed-internal-demo-echo-house.sql` assigns the five existing fictional profiles Luna, Ivy, Kai, Sienna and Nova to Echo House. It moves their existing demo shifts, records their previous venues in shift metadata, adds active demo affiliations and Both-channel records, and rolls back unless all five appear in both rosters. It creates no NFC tap or identity-verification records. Run only against the Dancr project after applying the migration; the script checks the exact venue and synthetic dataset before writing.

The focused integration suite covers all three choices, mandatory profile/age verification, retries, cross-club isolation, cooldowns, suspension/revocation/expiry, avatar identity, capability profile/media access, table requests, staff permissions, and safe publication receipts. A transaction-only rehearsal against the current MyDancr schema confirms the migrations execute and browser roles cannot invoke protected functions; the rehearsal rolls back.

The browser-control service exposed no available browser during implementation. Client compilation, focused TypeScript and lint checks can run locally, but mobile visual inspection is an outstanding acceptance check. Before club use, complete a real Ondato onboarding and physical sticker tap for each choice, open the internal avatar profile from a table QR, confirm external discovery follows the choice, and verify the table roster clears after shift expiry or affiliation removal. Browser/mobile visual review and real NFC/Ondato testing remain outstanding because no browser surface is connected.
