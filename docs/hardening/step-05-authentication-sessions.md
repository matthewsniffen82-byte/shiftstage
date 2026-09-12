# Step 5 — authentication, sessions and password recovery

This review found a remaining browser refresh race. The canonical refresh helper
checked the stored token pair, then read storage again to obtain account details.
If another tab changed the sign-in between those reads, the helper combined the
first account's refreshed credentials with the second account's metadata. A
logout or a newer refresh could also be overwritten. This was a browser state
consistency failure; it did not bypass server verification of token ownership.

## Repair and reproduction

`persistRefreshedBrowserAuthSession` now parses one captured raw storage value,
checks that value's token pair against the requesting session, prepares the
credential-only update from the same account snapshot, and compares storage with
the captured value immediately before writing. A changed or unavailable value
returns false without writing or clearing a newer sign-in's push ownership.
Successful saves retain the existing cleanup of stale push ownership for another
account. Incoming refresh metadata cannot replace the captured account.

Thirteen tests execute the real TypeScript module with synthetic browser storage.
The published predecessor failed six: account switching, logout, newer token
rotation, newer account details, storage becoming unavailable on a later read,
and a session change while notification ownership was read. The account-switch
failure recorded account B's identity next to account A's refreshed tokens.
Seven ordinary/error/notification controls already passed. All thirteen now
pass; the broader session, login ordering, customer response ordering and
password reset group passes 94 tests. No production account or provider session
was used to reproduce these interleavings.

This remains a comparison before a write, not a transaction across tabs. A change
after the final comparison, or a value changed and restored byte-for-byte between
comparisons, is outside the guarantee. The fix removes the separate-snapshot
merge and rejects intervening changes that are observed at the write check. It
does not claim universal cross-tab serialization or replace server authorization.

## Current boundaries reviewed

| Boundary | Current behavior and retained evidence |
| --- | --- |
| Signup/login | The server bounds credentials, rate limits attempts and verifies the provider user. Application role comes from the database. Step 3's atomic provisioner is retained. Admin/venue enrollment remains separately gated. |
| Request authentication | Each request uses an isolated client with SDK persistence, URL detection and automatic refresh disabled. The user is verified after any session establishment; token decoding only schedules middleware refresh. Role/active-account requirements are chosen by route code and checked against the database. |
| Session rotation | Middleware checks the refreshed subject and propagates bounded credentials on private, uncached responses. Browser callers require the requesting token pair to remain current. The repaired canonical helper now preserves one consistent account snapshot through its write check. |
| Confirmation/recovery callbacks | The published callback verifies provider-issued credentials, scrubs URL credentials, uses no-store/no-referrer and preserves an unrelated sign-in when recovery fails. Earlier callback/login response-ordering guards remain in place. |
| Reset delivery | The endpoint retains neutral success wording, existing throttling and explicit temporary delivery failure. No reset or confirmation email is sent for this review. |
| Password update | The reset form uses the captured session for verification and submission. The API verifies the user, performs one credential update and reports other-session revocation failure separately. Confirmed password success is not relabeled as failure when notification/revocation follow-up fails. |
| Logout | The browser captures the session being ended, clears local state promptly and requests bounded local-session revocation. Later responses cannot use the canonical helper to restore a logout observed at its write check. |
| Private-page state | Earlier admin/homepage focus, page-show, storage-event and request-ordering repairs remain. Private responses keep their cache controls. This step changes no UI layout or page authorization. |

Detailed earlier evidence remains in the security authentication/session reports
and `docs/supabase-reliability/step-06-authentication-review.md`. Its September 10
provider configuration capture is dated evidence; this step does not claim a new
management-configuration capture. Current read-only readiness and health checks
verify availability, not real mailbox delivery or provider token replay.

## Retained decisions and limits

The explicitly selected password policy in `docs/password-policy.md` remains:
six-character minimum with uppercase/number/symbol composition and no additional
leaked-password rejection. Login does not rewrite existing passwords. Direct
provider requests use provider configuration rather than MyDancr's composition
validator. No password-policy or provider-setting change is inferred here.

Browser-readable bearer storage remains dependent on the existing XSS/CSP
controls. Moving all sessions into HttpOnly cookies would require a separate
application design and is not part of this correction. Revoking refresh
capability is not treated as immediate invalidation of every issued access JWT.

No disposable hosted users were designated, so real signup/email delivery,
expiry/replay and cross-device revocation remain untested end to end. The local
preview remains stopped after automatic approval review rejected its restart;
this task did not start a replacement server. Synthetic module tests do not claim new
native multi-tab browser or hosted-provider coverage. The remaining architecture
steps retain API authorization, browser security, account lifecycle compensation
and critical-journey review.

Final validation on `5d5fdb936c3d42b2f8e487e228cd9e2db0658ec2` plus this step
passed all **6,528 tests**, with no failures, skips, cancellations or todo,
standalone TypeScript, full zero-warning lint and the production build. All
thirty read-only Supabase readiness checks passed. Pretest/prebuild generators
ran; postbuild confirmed `LAYOUT_REVIEW_POPULATION_SKIPPED`. Tests used three
workers; the build's duplicate lint pass was omitted after full standalone lint.

Published as `8725ca85a8d696f50baacc314eff6194dab36fd9`, with [exact-commit Vercel success](https://vercel.com/ai-movie-jobs/shiftstage/5rkPQiZyeDQ1LBSkkF3LeaWVZAFH). At 2026-09-12T06:04:12.235Z the checkout was clean and local main, origin/main and the remote matched. Public root and both health endpoints passed; anonymous administrator monitoring remained 401. The final receipt is `D:\Codex\MyDancr-validation-2026-09-11\arch-stability\step5-delivery.json`.
