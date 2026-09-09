# Step 9 — XSS and HTML injection

## Findings and fixes

| Severity | Finding | Correction |
| --- | --- | --- |
| MEDIUM | Several home-shell templates interpolated profile/venue names, saved-deal text, notes and administrative labels directly into HTML text or double-quoted attributes. Even a valid stage name containing a quotation mark could introduce attributes. Legacy or privileged content could introduce markup. | Escape the reviewed scalar values at the rendering boundary using the existing output encoder. Profile slug path segments are encoded as well. Preserve intended application-owned HTML fragments and all layouts. |
| LOW | The shared CSS-photo helper escaped CSS apostrophes but inserted the resulting value into an HTML attribute without HTML encoding. A quoted URL could break that boundary. Existing server-owned storage paths reduce the reachable production attack surface. | Encode the complete CSS attribute value after CSS escaping; reject control characters in CSS URLs. Preserve ordinary HTTP images, responsive image sets, blob previews and image-data previews. |
| LOW | Home-shell social and admin-preview renderers trusted URL schemes, including legacy/draft values, despite stronger current server-side social validation. Synthetic executable schemes reached anchors. | Apply the existing HTTP(S) URL parser before social anchors and admin previews; encode the resulting attributes. Invalid social destinations are omitted or inert while their editable text remains available. |

The root's hash-based script CSP and `script-src-attr 'none'` already block injected inline script/event handlers. Those stronger protections remain. No production script execution, account takeover or current arbitrary-media-upload exploit was demonstrated. Severity reflects confirmed unsafe rendering and the existing mitigating controls; the test cases are not separate vulnerabilities.

## Review coverage

The review covered React pages, the custom home shell, public helper scripts, callback HTML and notification email HTML. A source inventory identified 802 nontrivially interpolated expressions across home-shell HTML templates; reviewed data expressions were distinguished from trusted application markup, enumerated classes, encoded attributes and numeric formatting. The patch adds boundary encoding to 105 scalar expressions in 22 renderers, plus the CSS and URL checks. It does not globally escape already assembled HTML or strip characters from stored names.

React user content remains ordinary JSX text/attributes. The single `dangerouslySetInnerHTML` in the root layout contains a fixed device-detection script; its source is not assembled from user input. The authentication callback escapes `<` in serialized script data and uses fixed navigation destinations. Support/report text is already encoded before optional newline formatting. Notification email text and generated action links are escaped. The external-social warning inserts static markup and assigns dynamic destination text with `textContent`. No production `eval`, string-built function execution or user-controlled `document.write` was found in the reviewed application code. Test-only function extraction is not browser code.

Current server-side social platform validation, ownership, moderation and public eligibility checks remain intact. No HTML sanitizer or new dependency is needed because these fields are plain text. Host allowlists and redirect policies receive their separate Step 18 review; this step handles executable schemes and HTML contexts.

## Tests and deployment gate

Forty-three new runtime regression tests execute the checked-in renderers with synthetic quoted names, markup, punctuation, URLs and numeric values. They cover saved deals, profile cards/actions, notes, metrics, admin labels, popular venues, social links, responsive CSS photos, local previews and rejected admin preview schemes. The initial 39-case subset reproduced 38 failures before the changes. Assertions verify encoded output and rejected URL schemes; they do not claim a full browser penetration test. Existing layout assertions were updated to expect encoding while retaining their structural requirements; the social-layout fixture loads the actual new helper dependencies.

The full suite passed 2,767 tests before incorporating the subsequent independent static-CSS performance release. Final combined validation, exact-commit Vercel success and safe production checks are recorded in the execution ledger. The live verification must check the deployed home-shell version and rendering helpers in addition to health, authentication denials and Supabase readiness. No test payload is submitted to production profiles or private records. No database migration is required.
