# Step 15 — Provider receipts and monitoring count certainty

Reviewed on `72d32f5bd04dbc0c09a9cb1f62a6e635158c343f`.

The deployed Security 29 resource limits and Supabase consolidated permission/
recovery release are preserved. All 31 reviewed source hashes match this parent;
their dated receipts and remaining boundaries are recorded in the combined review.

This release corrects push-message creation receipts, response cleanup and the
admin open-case count, and includes the consolidated architecture review.

The Stripe webhook route reads at most one MiB of exact signed bytes, rejects a
missing signature before body/secret access, and verifies with the installed SDK
using an explicit five-minute tolerance. Only supported event types enter the
database claim path. These observations concern the reviewed source; automated
actual-route and native database regressions retain their synthetic boundaries.

`recordPaymentProviderWebhook` requires a matching provider/event/type/object
receipt, valid attempt number, raw database timestamp, and processing state.
A completed duplicate can be acknowledged; an active attempt owned elsewhere
cannot be treated as completed. Completion matches the event row, attempt count,
exact timestamp and processing state, then requires a returned matching row.
Keeping the database timestamp verbatim preserves its microseconds. The captured
database fixtures exercise expired attempts and stale completion; they do not
establish a hosted multi-connection delivery drill.

Invoice handling reloads current provider state and uses its version instead of
blindly replaying the older event snapshot. Payout dispatch validates the atomic
claim and amount/currency/provider before using the batch-specific idempotency
key. Once a claim is attempted, uncertain outcomes retain earnings and require
review instead of releasing them on a worker's local assumption. Transfers,
invoice/customer creation, and connected-account creation carry their existing
stable operation keys. An idempotency key alone does not make provider and
database writes one transaction or prove indefinite replay safety.

Only Stripe implements the payout adapter. Other enum options explicitly reject
unsupported operations. Current configuration presence is not proof that payouts
are enabled or a hosted provider account is eligible. Preserve provider settings,
billing, product rules and existing operational review requirements.

Notification requests use fixed provider origins, reject redirects, and have a
ten-second abort signal. The transactional email result describes acknowledged
HTTP acceptance; it is not evidence of final inbox delivery. Transport failure
can be uncertain, and the generic delivery helper does not provide durable
cross-system exactly-once delivery. Multi-recipient batch duration remains a
separate resource limit; this step bounds and consumes or cancels provider
responses. No real message or payment is sent by this architecture review.

The DMCA caller distinguishes a confirmed database action from an email-review
outcome. A delivery problem must not cause the completed action to be repeated.
The notification change preserves that distinction. No SQL or provider mutation
was replayed to collect architecture review evidence.

## Creation-receipt correction

The previous notification helper returned responses without consuming or
cancelling their bodies and counted every successful push HTTP status as a
created message. OneSignal's [create-message contract](https://documentation.onesignal.com/reference/create-message),
checked on September 12, documents that success can have an empty message ID
when no message was created. The [push API reference](https://documentation.onesignal.com/reference/push-notification)
describes a UUID message ID and permits subscription-level errors alongside a
created message. The correction requires that valid creation receipt before
incrementing the push count. It does not equate creation with delivery to a device.

Successful push bodies are limited to 64 KiB of decoded response bytes and 4,096
chunks, counting empty chunks too. The existing ten-second signal also covers
reading the response. Malformed, oversized, incomplete or aborted receipts remain
unconfirmed without a retry. A valid UUIDv4 ID remains accepted with subscription
warnings; raw provider details and IDs are not logged. A fixed buffer avoids
retaining an unbounded list of chunks. The code preserves the existing endpoints,
headers, keys, payloads and retry policy.

The [Undici guidance](https://github.com/nodejs/undici/blob/main/README.md#garbage-collection)
recommends explicit response consumption or cancellation. Resend acceptance and
rejected provider responses use cancellation without waiting. Cleanup failure
does not reclassify acknowledged email HTTP acceptance. The same cleanup also
releases unread or interrupted push bodies; it does not establish inbox delivery.

At 2026-09-12T17:21:23Z, 31 synthetic cases executed the actual module and native
Web Streams. The original source passed four and failed 27; failures distinguish
missing cleanup, missing receipt consumption and incorrectly confirmed pushes.
The refreshed candidate passed all 31 with no failures, skips, cancellations or
todo. Cases include valid and empty IDs, malformed JSON, exact and exceeded byte
limits, misleading lengths, split UTF-8, empty-chunk streams, late headers and
aborted reads with rejected or stalled cleanup. Focused lint exited zero with
the minimal-tree Next missing-pages notice. The full comparison and lint took
2.526 seconds; source hashes matched and all child processes exited.
See `step15-receipt-candidate-results.json`. The original ten-case cleanup logs
remain separate historical evidence. Existing preference/role assertions are
retained with a valid simulated creation receipt and native decoding globals.
The integrated release validation is recorded below. No provider request,
message or credential access was part of either synthetic comparison.

## Monitoring follow-up

The open copyright-case count now uses the existing active queue states:
`submitted`, `needs_information`, `disabled`, `countered` and `court_hold`.
Terminal cases remain excluded even when a selected terminal case is separately
loaded for recovery. The query retains its exact HEAD count without the panel's
100-record display limit. Missing, negative or malformed counts use the existing
warning contract; affected home/more workspace badges become unavailable. Other
existing numeric fallbacks retain their warning rather than gaining a universal
nullable API in this change. A confirmed zero remains a confirmed empty result.
There is no lifecycle, permission or SQL change in this correction.

At 18:40:33 UTC on September 12, twelve cases executed the actual operations
module and workspace helper with synthetic query results. The original source
passed four and failed eight: three missing active states, their combined count,
and four unconfirmed count results. The candidate passed all twelve with no
failures, skips, cancellations or todo. A 125-case fixture also confirms that
the exact count remains independent of the display limit. The before/after
comparison took 1.372 seconds; preparation plus both naturally exited processes
took 2.45 seconds in the coordinated test-only window. The native module-format
notice is retained in its logs. Focused lint passed separately at 18:47:29 UTC
on the same source, taking 2.657 seconds. Integrated validation follows below;
no production cases were read or changed by these tests.

## Stripe transport limits observed separately

The installed Stripe SDK is 16.12.0. The current singleton supplies no global
retry/timeout overrides; the installed core defaults to 80,000 milliseconds and
one configured network retry. Its Node transport applies the timeout through
`request.setTimeout` and destroys the request on that event. Node documents this
as a [socket inactivity timeout](https://nodejs.org/docs/latest-v24.x/api/http.html#event-timeout),
so it must not be presented as an absolute whole-operation deadline. The SDK
also has a special initial connection-closed retry condition.

Current invoice snapshot/account reads and invoice line-item reads explicitly
use ten seconds and zero configured retries. Other provider calls retain their
current defaults and stable operation keys. This source review does not measure
hosted Stripe latency, prove every financial batch fits the function's lifetime,
or change payment retry policy.

Final release validation:

On `72d32f5bd04dbc0c09a9cb1f62a6e635158c343f` plus this step, all **9,036 tests** passed
with no failures, skips, cancellations or todo. Standalone TypeScript, full
zero-warning lint and the production build passed on Node v24.21.0.
The repository's canonical release gate also passed dependency and registry
signature audits, native runtime checks and route type generation. Its normal
production build retained compilation, lint, type checks and lifecycle hooks.
Postbuild reported `LAYOUT_REVIEW_POPULATION_SKIPPED`. All 58
read-only readiness checks passed.

Exact-commit delivery evidence is recorded in `step15-delivery.json` in the
external architecture evidence directory. Completion requires its successful
Vercel status, matching local/remote refs and post-release health checks.
