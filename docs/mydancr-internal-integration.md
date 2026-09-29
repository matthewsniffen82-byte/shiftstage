# MyDancr internal roster integration

## Existing architecture

MyDancr is a Next.js App Router application with an existing generated public discovery shell, custom Supabase session transport, and server-authorized dancer, venue, and admin workflows. Supabase owns canonical dancer profiles, approved avatars, Ondato results, club affiliations, and NFC shifts. Working Now lasts six hours, followed by a six-hour global cooldown; a retap must not extend a shift or move it between clubs.

The MyDancr venue dashboard has one **Dancers & tables** section for Internal and External dancers, with channel filters that both include dancers who chose Both. The same section manages club affiliations, table requests, table numbers/names, and printable QR signs. NFC controls working status automatically; there is no manual venue working-status action. The separate Club Roster project remains untouched.

## Visibility contract

Each dressing-room tap requires an explicit choice before submission:

| Choice | Internal club roster | External MyDancr |
| --- | --- | --- |
| Internal only | Selected approved main photo and stage name; click to open full profile | Absent from external discovery |
| External only | Absent | Existing full public profile |
| Both | Selected approved main photo and stage name | Existing full public profile |

No channel is selected implicitly and neither is not a valid check-in choice. Internal consent applies to the confirmed club shift. Public-profile privacy remains in effect after the shift ends until another explicit eligible tap changes it; expiry never silently republishes a profile. Existing dancers are not automatically opted into the internal roster. Signup and profile moderation stay shared; Ondato verification must precede a new channel-aware check-in.

Every dancer completes the full profile during onboarding, regardless of visibility choice. Internal cards use the same three-column, 9:16 photo tiles and 2px gutters as external discovery. They show the dancer’s chosen approved gallery photo and stage name; the avatar remains separate. Clicking a card opens the complete customer-facing profile through the club's authorized roster context, including approved gallery and social links. Internal-only profiles stay out of external discovery. Legal identity, verification documents, and private contact information are never included. Private media are fetched through an authorized, uncached endpoint. Already downloaded media cannot be recalled.

## Implementation phases

1. Add service-only consent storage, an atomic channel-aware NFC entry point, and a database publication guard. Preserve established affiliation, moderation, disabled-account, club-removal, timing, and cooldown rules. Add behavioral database tests for all visibility choices and failed/replayed taps.
2. Replace automatic dancer check-in with an explicit three-choice confirmation. Suppress public follow notifications for internal-only taps and show the selected visibility in the result.
3. Add the MyDancr internal staff roster, club-scoped table request queue, and revocable table links. Reuse existing venue ownership and team authorization; internal rosters derive from eligible active NFC shifts, never duplicated dancer records.
4. Validate affected API/database/UI workflows, inspect the final diff, apply only the reviewed additive migration, commit task files, push `origin/main`, and verify Vercel success for that exact commit.

## Security and operations

All mutations and reads require server-side authorization. New operational tables use RLS with no anonymous or authenticated direct grants. Guest table links are revocable bearer capabilities; possession grants access to that club's opted-in roster only. Do not publish these links as public discovery links. Owners and managers can revoke them if a link leaves the club. Revocation, shift expiry, account suspension, affiliation removal, and internal opt-out remove access on the next uncached request. Rosters and open profiles refresh quietly every 20 minutes, retaining their last loaded content during temporary connection failures. Confirmed access denial or a changed staff session clears protected content. Initial loading failures still offer a manual retry, and successful user actions refresh immediately.

Existing Ondato server credentials and Supabase environment variables are reused. No identity documents, duplicated avatars, or separate staff credentials are transferred from Club Roster. Physical NFC placement, real Ondato completion, and operational club acceptance require an on-site acceptance check.

## Routes and data

`/internal/profile-viewer?internal_profile=[dancerId]` serves the same discovery viewer shell with same-origin framing allowed only on that dedicated route. Its HTML contains no scoped dancer data or club token, is not cached or indexed, and receives authorized profile data from the roster's origin-checked message bridge. Public pages retain their prohibition on framing.

- `/dashboard/venue#venue-dancer-roster`: unified venue roster. Staff can view approved affiliated profiles and acknowledge/complete/dismiss requests. Owners/managers can remove affiliation, allow a new NFC tap, and create, rename, print or revoke table QR links. Removing affiliation ends this club’s Internal and External presence and blocks retapping until allowed; it never deletes the dancer’s account or their other affiliations.
- `/internal`: redirects to the unified venue roster.
- `/internal/club/[token]`: customer table roster/request screen. Selecting the main photo opens approved photos, videos, and social links within the club context, including for Internal-only dancers.
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

Before club use, complete a real Ondato onboarding and physical sticker tap for each choice, open the Internal profile from a table QR, confirm external discovery follows the choice, and verify the table roster clears after shift expiry or affiliation removal. Local browser fixtures cover the photo grid and picker; acceptance on a real phone with NFC and Ondato remains separate.

### Internal main photos

`20260929120000_internal_main_photos.sql` adds a service-only preference and owner-checked selector. The onboarding Photos uploader and photo manager let dancers explicitly choose an approved gallery photo for Internal. Avatar upload remains required and independent; public primary photos and pins are unchanged. Existing dancers use their approved primary gallery photo, then a deterministic approved fallback, until they choose. Deleting or rejecting the selected photo falls back to another approved photo; a gallery with none displays a placeholder.

`/api/dancer/internal-main-photo` reads and changes only the authenticated dancer’s choice. Internal roster snapshots expose photo IDs and opaque revisions, never storage paths. Existing capability-scoped media endpoints recheck approval and roster membership on every fetch. Focused database/API checks cover ownership, moderation, account state, deletion, fallback and restricted grants. Local browser fixtures verify three columns at 320/393/768px, profile opening, table requests, and persisted choices.

### Shared full profile viewer

Internal profiles replace Going with **Requests tonight**, the count of saved requests for that dancer at this venue between the current active shift's check-in and expiry. Finished or dismissed requests remain real sent requests; retries with the same key do not add a row. A new shift starts its own count. No active shift shows zero. Going and Views today remain on External; Internal keeps followers and omits Views today and Club Deals.

Table guests can request from the roster or from **Request at [table label]** in the full profile. Both use the existing table capability, RPC, notification path and idempotency rules. They show **Request sent** while that table has a pending or acknowledged request, including after reloading. Request status and counts update without reopening the photo/video viewer. Staff profile previews show the same Internal metrics without a guest request button. The existing quiet 20-minute refresh remains in place; opening a profile or submitting a request also fetches current data.

Internal photo cards open the same `openProfileModal` viewer used by External discovery, hosted in a same-origin frame. The frame receives the canonical dancer identity, approved gallery, current approved videos and social links from the existing authorized Internal profile endpoint. It reuses the external profile layout, gallery and full-screen media controls; Club Deal markup and QR hydration are omitted in Internal context. No second profile is created.

The frame URL contains only the dancer ID. Table capabilities travel through a message checked against the exact parent window and origin, then only to scoped Internal media endpoints. Staff media uses the existing authenticated venue session. Internal data stays in memory outside public discovery, and existing roster refreshes close the frame on confirmed loss of access. Public engagement actions retain their existing server permissions; this does not publish Internal-only profiles or grant them public engagement access.

Validation covers the shared viewer, approved media, message boundaries, staff authentication, private visibility, unchanged refreshes, return to the roster, and external Club Deal preservation. The 53 focused tests pass, along with scoped TypeScript and ESLint checks. A mobile browser fixture exercises the actual assembled viewer for both public and Internal-only profiles, decoded gallery images, the photo overlay above the profile, and closing back to the roster. Two older profile layout suites still have the same 15 failures on the baseline commit; this change introduces none of those failures.
