# Dancer Agreement acceptance

The current version is `2026-10-08-v3`, published at `/dancer-agreement`. The document and immutable database snapshot preserve the agreement presented to the dancer; previous versions and receipts remain intact.

Dancer signup creates the account without accepting the Dancer Agreement. Acceptance stays inside the dashboard's existing **Create profile** onboarding step: the dancer opens the agreement popup, checks the checkbox, and selects **Continue**. The server validates the required profile media and records current-version acceptance before submitting the profile.

Dancers with an already submitted or approved profile review a new version in that same onboarding step. Continue saves acceptance through `/api/dancer/agreement` without resubmitting or resetting their profile, age verification, or club affiliation. After a confirmed save, the dashboard reloads its authoritative state and resumes onboarding or the approved workspace.

There is no separate dashboard acceptance screen. Direct links to dancer tools return unaccepted dancers to onboarding. Protected dancer and NFC APIs still enforce acceptance on the server. Account management and support remain available, including for paused accounts.

Receipts identify the authenticated user, agreement version, server timestamp, and acceptance source. Retries preserve the first receipt. Browser roles cannot directly edit receipt tables; authenticated acceptance uses `auth.uid()`.

For future revisions, publish the document and immutable database snapshot, switch the database's current version, and update the application version constant together. Deployment does not apply SQL automatically. Keep previous snapshots and receipts; stale-version submissions must review the current agreement.

Focused unit and component checks cover onboarding submission, renewal without profile changes, failed saves, duplicate submissions, direct tool links, account changes, dashboard loading, and server access checks. Do not run E2E tests for this project.
