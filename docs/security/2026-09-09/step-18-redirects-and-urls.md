# Step 18: redirects and external URLs

## Confirmed findings and changes

| Severity | Finding | Correction |
| --- | --- | --- |
| MEDIUM | The shared and homepage local-return validators checked the input and the first parsed origin, then returned the normalized pathname. `/a/..//outside.example/path` becomes `//outside.example/path`; navigation reparses that value as an external authority. Encoded dot segments also reproduce this. The dedicated account sign-in handler could navigate there after a successful login, and callback HTML exposed an external continuation link. | Reject literal or encoded authority separators on the normalized pathname before returning it. Existing initial checks remain. Apply the same rule to both implementations. |
| LOW | The email callback allowlist accepted any pathname beginning with `/auth/callback`, plus URL credentials and caller-supplied fragments. These destinations are outside the intended callback contract even though their origin passes. | Require the exact callback pathname and no username, password or fragment. Preserve the existing trusted origins and valid query parameters. |

The first finding is an open-redirect/phishing risk; the reproduction does not demonstrate authentication-token theft, code execution or an authorization bypass. The second is a callback destination-validation defect; no off-origin provider redirect or account takeover was demonstrated. No provider settings, account records, cookies, RLS or credentials were changed.

## Review coverage and retained controls

- Account entry, the dedicated NFC account form, homepage customer/venue sign-in, callback return paths and password reset were inspected. Reset destinations remain fixed; callback scripts validate sessions, scrub sensitive URL parameters, retain no-store/no-referrer and derive role routing from verified account data.
- The canonical production origin remains `https://www.mydancr.com`. Existing apex and project-domain compatibility in the application email allowlist remains; the provider's previously reviewed production callback configuration was not altered. Client-supplied roles still cannot authorize account access.
- Server redirects for club signup and venue claims construct local paths. The maps endpoint constructs a fixed Google Maps URL with the address in URLSearchParams. Uber destinations likewise use the fixed HTTPS universal link and encoded query fields.
- Social profiles retain the established safe-protocol and platform-host validation and canonical handle reconstruction. Public homepage links reject executable protocols; image/CSS data and blob sources are separate media contexts, not general navigation exceptions. Ordinary HTTP venue/reference links remain supported.
- Venue signup website validation rejects credentials and unsafe protocols. Copyright reference URLs are limited to HTTP(S), and reported MyDancr URLs additionally validate the hostname. These third-party reference destinations are intentionally not restricted to MyDancr. This review does not certify the content or subsequent redirects of independently operated sites.
- Payout return/refresh URLs are built server-side from the canonical public origin. Stripe onboarding destinations come from the authenticated provider API, and NATS destinations come from server configuration with HTTPS validation. Retired billing endpoints still return no checkout/portal link. No new provider or arbitrary browser-supplied payout redirect was introduced.
- Dashboard/profile close controls compare referrer origins and retain application-generated discovery fallbacks. Public profile/share URLs and route identifiers are constructed from local paths or encoded query values. Deployment configuration introduces no user-controlled redirect rule.

## Verification

Fifty-one new runtime tests exercise the actual shared/homepage validators, extracted email-route functions, the dedicated account submit handler and the actual callback response. Before the fixes, 28 of 104 tests failed: sixteen normalization checks, four completed-sign-in destinations, three callback-link checks and five email-destination checks. After the fixes, all 132 focused tests passed, including prior session, callback, venue navigation and social URL controls.

The new regression cases cover literal/encoded dot segments, slash/backslash authority prefixes, callback suffixes, credentials, fragments, unsafe protocols, foreign hosts, ports, trusted-origin query preservation and ordinary local destinations. Test credentials and destinations are synthetic. Native browser verification uses the local production build, intercepted authentication/NFC responses and blocked remote requests. The complete suite, lint, standalone TypeScript, production build and browser verification must pass before publication; exact-commit Vercel success and read-only production checks must pass before Step 19.

No production email was sent, real account signed in, private document downloaded or external attack destination visited. Local mocks do not certify live Supabase token issuance or real-user recovery. Existing direct-provider defenses remain independently required.

## References

The provider recommends exact production redirect paths: [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls). URL resolution and serialization behavior is defined by the [WHATWG URL standard](https://url.spec.whatwg.org/). These references support the validation approach; findings above were reproduced against MyDancr code.
