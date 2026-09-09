# Step 8 — Server-side input validation

## Finding and correction

**MEDIUM — Unbounded photo deletion collections in dancer profile saves.** The PATCH endpoint already imposed a 65,536-byte JSON limit and checked the active dancer role, ownership and moderation state. However, `deletedPhotoIds` had no item limit or UUID validation before profile work. Hundreds of IDs fit within the byte limit. Each could trigger repeated owned-photo/moderation queries; nonexistent-photo errors were ignored as the loop continued. Malformed IDs could also fail after an earlier social-link update. This was an authenticated resource-amplification and partial-save risk, not an ownership bypass.

The endpoint now validates deletion collections immediately after bounded JSON parsing and before loading or updating the profile. It accepts at most 100 UUID strings (the existing 50-photo gallery limit plus 50 pending moderation records) and 200 nonempty storage references of at most 4,096 characters each. Wrong collection types and malformed entries return a stable 400 response. Limits apply before deduplication. Omitted and empty collections remain valid. Ownership and safe storage resolution remain enforced by the existing deletion helpers.

The current editor deletes photos through its dedicated owned-photo endpoint and removes acknowledged IDs from its pending list; the new save limit does not accumulate every deletion across a long editing session. Normal published/pending galleries remain supported. No upload formats, media limits, UI layout, account policy or database permissions changed.

## Broader boundary review

- JSON mutations use the shared streaming byte-bounded object reader. It rejects oversized declared or actual bodies, invalid UTF-8, malformed JSON, arrays and scalar top-level values. No direct request-body spreading into database writes was found in the API review; existing explicit field selection is retained.
- Signup, account recovery and profile changes validate account roles, email/password inputs, names and city selections. Profile changes retain protected-field rejection, strict visibility booleans and allowlisted social platforms. The owner's established password policy is unchanged.
- Schedule changes validate UUIDs, owned active affiliations, real calendar dates, venue time zones and the bounded scheduling window. Shift timestamps are generated on the server. Demo-locked and live-session restrictions remain.
- Venue page updates are intentionally managed by MyDancr; the retired account-side update helper remains closed. Venue team operations enforce management permission and allowed membership roles. Venue signup requests bound contact/name/address inputs and validate contact/website formats.
- Public events, reporting and media likes retain UUID/type allowlists, bounded text, target visibility/relationship checks, rate limits and media batch caps. Discovery queries have fixed result bounds. Admin roster search removes filter punctuation before its server-built search expression.
- Support messages retain subject/message length limits and request-ID validation. NFC operations validate identifiers and label lengths. Finance commands parse action enums, UUIDs, reasons, strict booleans and bounded safe integers into explicit command objects.

URL scheme handling, upload decoding, rate limits and response minimization receive their separate numbered reviews. This review does not assert that every optional field must reject every unknown property: inert fields that cannot reach privileged writes are not a mass-assignment vulnerability.

## Verification and limits

Forty-one new checks cover oversized and malformed collections, accepted published/pending/empty batches, and the actual compiled PATCH handler with a valid authenticated context. Twenty endpoint tests failed before the guard and pass afterward; they assert 400 before any profile database work even when valid social edits accompany invalid deletion data. These are twenty cases for one finding, not twenty vulnerabilities. Existing profile-save and professional-role tests also pass.

The endpoint tests use synthetic requests and an isolated database-work sentinel. No production deletion, malformed authenticated mutation or exhaustion test was performed. Full tests, lint, TypeScript, production build and exact-commit deployment/health verification are required before Step 9; delivery is tracked in the execution ledger.
