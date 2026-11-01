# Automatic case-email deletion

Site Admin → Safety & privacy → Automatic mailbox deletion provides an owner-only
queue for the dedicated Zoho mailbox. The connection is separate from Resend.
Incoming mail is not automatically ingested or classified. Staff must link and
review each case's emails once; subsequent due-date execution is automatic.

## Connection and activation

The feature ships paused and cannot contact Zoho without all five server-only
environment variables in `.env.example`. Authorize a dedicated US Zoho OAuth
client for `ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.DELETE`.
It needs no send or organization-administration scope. The provider scopes grant
mailbox access; message-level restrictions are enforced by this application.
Store the client secret and refresh token only in production's secret environment
configuration, never source, logs, screenshots, or the operations register.
Pin `ZOHO_MAIL_ACCOUNT_ID` and `ZOHO_MAIL_ADDRESS` to the intended primary mailbox.
Every worker run verifies both against Zoho before reading case emails.

After deploying the connection configuration, the owner enables the worker in
the admin panel. This performs a read-only connection/identity check. Hourly
`/api/cron/mailbox-retention` requires `CRON_SECRET`. Pausing the feature or an item
stops future attempts; a provider request already in flight cannot be recalled.
Revoke the dedicated Zoho token if access must stop immediately.

## Review and scheduling

1. Classify by purpose, not sender, recipient alias, or arrival age. Record
   mail-only requests using the existing external-case intake first.
2. Close the actual case and record the original closure. An answered/open thread
   or missing closure is ineligible. The worker uses the adopted policy revision:
   support/privacy, at most 24 calendar months after closure; necessary safety
   decisions/notices, at most three calendar years. These are maxima.
3. Find emails by case UUID, or a distinctive exact phrase from their subject if
   no case reference exists in the email. Review every match in Zoho, including
   attachments and incoming/sent/archive/Spam/Trash copies. Selection is empty
   initially. Confirm actual case association and necessity; search alone is not
   classification. Choose an earlier disposal deadline for material no longer
   needed. Do not place raw harmful media or unnecessary identity material under
   an ordinary case maximum. Separately governed records retain their own rules.
4. Schedule selected messages. Confirmation explicitly includes removal from
   Trash at the deadline. Enrollment stores minimal references and search phrase,
   closure, policy/revision, deadline, reviewer, and a short minimization reason;
   it never copies email bodies or attachments to the application.
5. Check scheduled items and receipts daily. A new matching copy must be reviewed
   and linked before the worker can continue. The search includes Spam/Trash and
   disables conversation grouping. An incomplete/oversized/failed search blocks
   execution. A broad phrase may need refinement to separate unrelated matches.

All active preservation registers conservatively pause the worker, since existing
hold scopes are free text. Case preservation markers/restricted media also block
execution. Reopening a case latches a review block. Re-review can acknowledge a
policy change or shorten a deadline, but cannot silently restart its closure or
extend an earlier disposal decision. Changed categories/clocks need an explicit
operations resolution; the UI's resume switch cannot bypass these blocks.

## Execution and recovery evidence

Each attempt leases one due item, repeats a complete copy search, checks current
policy/case/holds, retrieves current message metadata, and checks the lease again
immediately before the provider call. First it moves the exact message to Trash
with `expunge=false`, verifies the Trash location, and records `trashed`. A new
claim performs the same safeguards and deletes that exact Trash message with
`expunge=true`; a complete follow-up search must no longer find it before recording
`trash_removed`. It never empties a folder or uses a bulk deletion action.

Failures retry with a generic error code and return a failed cron status. A lost
response is reconciled on the next search, not counted as success. `absent` only
means search absence; `trash_removed` is an API result plus search verification.
Neither is proof of physical erasure from provider backups or a signed purge
certificate. Zoho's provider recovery period is tracked separately in the private
vendor register. That provider evidence is not completed by enabling this code.

Successful removals are checked daily for restoration for a bounded 90-day
reconciliation period. Restored matches are removed under the original deadline.
References expire after 90 days only when recently confirmed absent; unresolved
items remain visible. Minimal attempt receipts expire after 90 days when the
worker is active and no hold is open. Do not put sensitive content in reasons or
search phrases beyond the minimum required to find the case's copies.

Before any mailbox or database restoration, pause normal access and preserve the
current private job/receipt ledger outside the restoration target under restricted
access. Reconcile it with restored data before allowing ordinary use. The scheduled
worker is a backstop; it cannot itself quarantine a Zoho restoration, recognize
re-imported messages with new identifiers, discover all unrelated copies, or
recover a ledger overwritten by an older database backup. Those remain explicit
restoration tasks. Files/downloads, other staff mailboxes and unrelated retention
categories are outside this connection; do not mark their coverage complete.

## Verification

Run only focused unit/database/API tests (no E2E or real-mail test deletion):
`node --test tests/mailbox-retention-postgres.test.mjs tests/mailbox-retention-api.test.mjs tests/zoho-mailbox.test.mjs`.
Read-only deployment and configuration checks establish rollout, not actual
deletion. Keep the connection, activation, coverage review and first legitimate
due-item receipts as separate operational evidence.

Provider references: [OAuth](https://www.zoho.com/mail/help/api/using-oauth-2.html),
[case search](https://www.zoho.com/mail/help/api/get-search-emails.html),
[single-message deletion](https://www.zoho.com/mail/help/api/delete-email.html),
[provider deletion policy](https://www.zoho.com/mail/help/data-deletion-policy.html).
