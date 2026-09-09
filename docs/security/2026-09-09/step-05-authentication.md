# Step 5 — Authentication and account recovery

## Findings and changes

| Severity | Confirmed issue | Resolution |
| --- | --- | --- |
| LOW | Visiting `/auth/callback?type=recovery` without a valid recovery session deleted the browser's existing sign-in. An unsolicited or expired link could therefore cause local logout without proving account ownership. | Invalid recovery redirects to the existing expired-link screen without removing the unrelated browser session. The reset form still rejects that screen before making an account request. |
| MEDIUM | Fragment confirmation awaited server validation and then wrote its session unconditionally. A response arriving after a different login, token refresh or logout could restore the older session and select the wrong account. The existing stale-response protection covered only resuming a stored session. | Capture browser session state before validation and compare it immediately before saving. A changed session is preserved and the callback returns to the current sign-in entry. Failure to read storage stops confirmation with recovery guidance. |

Regression tests reproduced the original failures before the implementation changed. The fix affects only callback completion; no provider credentials, account records, password policy, email delivery configuration or UI layout changed. A valid recovery link can still intentionally replace a previously signed-in account when that account has not changed during validation.

## Inspected boundaries and controls retained

- **Signup and login:** `/api/auth` bounds JSON and credentials, applies existing abuse limits, verifies passwords with Supabase, and provisions through the existing account boundary. Login uses the database account role rather than the selected public login role. Provider failures are sanitized. A correct-password email-confirmation requirement remains useful feedback; arbitrary provider error detail is not returned.
- **Public venue requests:** signup returns no session until confirmation. Resend responses are neutral and throttled. The confirmation helper checks the Auth user ID, email and server-controlled provisioned role before generating a link, then checks the generated identity again. Existing venue-code/team-invitation and admin enrollment are separate privileged flows, reviewed further in Steps 6–7.
- **Forgotten email:** recovery creates a private support case and gives a neutral response. It does not expose a registered email or automatically grant access. The existing ownership-verification runbook remains required. Public support recovery excludes administrators.
- **Password recovery:** the server chooses an allowed MyDancr callback origin, uses provider-issued recovery links, retains neutral success wording and reports delivery outages without claiming success. Callback OTP/code exchange is delegated to Supabase; fragment tokens are verified through `/api/auth` before being stored. Missing, rejected and expired recovery credentials cannot reuse a normal browser session to enter recovery.
- **Password update:** `/api/account` requires a verified Auth user; Supabase updates that user's password. Other-session revocation and the security email occur after the credential change, with distinct reporting if those later actions fail. A later notification failure does not falsely report that the password was unchanged. The form also prevents a different account selected after its verification from receiving the password update.
- **Logout and refresh:** logout clears local state and requests provider revocation of the current session. Request authentication verifies `getUser()` after refresh; token decoding alone does not authorize access. Existing middleware checks the refreshed subject and transports renewed credentials. Broad session architecture remains Step 17's scope.
- **Credential handling:** callback responses are no-store/no-referrer; script serialization escapes `<`; the callback scrubs query/fragment credentials and does not forward them into destination URLs. Token values are not added to logs. No token, password or private user record is included in this report.
- **Phone verification:** no application phone-OTP signup/reset endpoint was found. Phone/NFC product flows are not treated as proof of email ownership; their role and authorization checks remain in the scheduled reviews.

The same-day, read-only provider configuration review recorded the canonical production URL, one exact callback URL, email confirmation enabled, configured SMTP, email frequency limits, TOTP enabled and finite session limits. That evidence is described in `docs/supabase-reliability/README.md`; it establishes configuration, not successful mailbox delivery. This step does not claim a second fresh management-configuration capture.

## Validation

- Added 16 runtime regressions, and strengthened existing invalid-recovery assertions. They execute the actual rendered callback script with synthetic sessions, covering signup, recovery and email-change responses after logout, account switching and refresh; invalid recovery variants; valid account recovery; and blocked storage.
- Focused authentication, recovery, callback, venue-confirmation and session suite: 192 passed before final release validation.
- Complete suite: 2,118 passed after incorporating the independent video-performance release. Lint, TypeScript, migration-history guard and production build passed; postbuild skipped demo population.
- Final verification uses the exact pushed Vercel commit, safe production health/authentication probes and the existing 30-check Supabase readiness command. It never sends a reset/verification email or changes a real password for testing.

## Limits and intentionally retained settings

- No designated disposable staging accounts have been supplied. Actual email delivery, provider token replay/expiry, refresh rotation and post-reset revocation across real devices therefore remain unverified end to end. Mocked runtime and database policy tests are not represented as provider penetration tests.
- The owner-approved six-character composition policy and disabled leaked-password rejection are explicitly documented in `docs/password-policy.md`. They remain weaker than a long, unique-password policy; direct Supabase requests enforce the provider's configured minimum, not MyDancr's composition validator. This step preserves that specific product decision instead of silently restoring a rejected password requirement. Reconsidering it remains a recommendation for the final report.
- Existing IP-source selection and rate-limit compatibility paths remain Step 11 review items. Legacy unused signup helpers have no application callers; their role/provisioning boundary remains Step 6's review. Broader URL validation remains Step 18.
- Existing browser-readable bearer-session storage and unbound email-link/fragment handoff remain relevant to XSS, login CSRF and session theft reviews in Steps 9–10 and 17. The race fix does not claim to bind an emailed link to the browser that requested it or prevent a person from following another account's valid link.
- Provider access tokens can remain valid until expiry after refresh-token revocation. The application must continue enforcing account state and authorization independently; logout is not claimed to instantly revoke every issued JWT.

Primary references consulted: [Supabase password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [Supabase session semantics](https://supabase.com/docs/guides/auth/sessions), and [OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
