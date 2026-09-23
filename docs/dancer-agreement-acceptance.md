# Dancer Agreement acceptance

The required checkbox uses agreement version `2026-09-22-v5`, published at `/dancer-agreement`. The original document, rendered text, hashes, and exact consent wording are retained through the document assets and `dancer_agreement_versions` snapshot. Migration `20260923020000_publish_dancer_agreement_v5.sql` archives this revision and makes it current without changing earlier snapshots or acceptance receipts.

New dancer signup requires explicit acceptance of the current version. The server creates an email-bound, single-use intent; an Auth INSERT trigger saves the receipt for the new identity in the same transaction. Duplicate signup and later edits to user metadata cannot accept for an existing identity. Unused intents expire after one hour and are removed by subsequent signup requests.

Existing active dancers must accept through the authenticated `/api/dancer/agreement` endpoint before their dashboard renders. Dancer API requests and NFC requests requiring a dancer role also check acceptance on the server. Account management, support, and the acceptance endpoint remain accessible. Paused accounts retain their existing management restrictions and must accept after reactivation.

Receipts contain the authenticated user ID, agreement version, server timestamp, and signup/dashboard source. Retries preserve the first receipt. Browser roles cannot read or edit receipt tables; authenticated acceptance functions use `auth.uid()`. Service-role access to the version and acceptance tables is read-only. Account deletion removes the user's receipt through its Auth foreign key.

Migration `20260920032000_dancer_agreement_acceptance.sql` is additive and does not accept for existing users. Apply only this new migration and record its version and reviewed statements atomically in migration history before deploying the application. Vercel does not apply SQL.

For a future agreement revision, publish the new document, add a new immutable database snapshot and switch the current version, and update the application constant and signup form together. Keep previous snapshots and receipts. Cached clients with an old version must reload and review the current agreement.

Focused validation covers the database grants and signup trigger, duplicate and forged requests, version checks, receipt retry behavior, server feature gates, and browser gate rendering. Mobile and desktop interaction checks cover failed saves, successful acceptance, reloads, and account changes.
