# NATS commission settlement

MyDancr remains the authoritative system for club receivables, cashier-NFC attribution, dancer tiers, agent hierarchy, and commission amounts. NATS is the independent affiliate account, tax-compliance, settlement, and payout-audit layer for dancers and sales agents.

Clubs are never NATS payees. Clubs owe MyDancr the agreed referral fee. A verified cashier NFC redemption creates the receivable and immutable dancer/agent allocation. Agent earnings stay `pending_venue_payment` until the corresponding club invoice is paid; only then can they enter the NATS export queue.

## Production activation

All five variables are required in the Vercel Production environment:

- `COMMISSION_SETTLEMENT_PROVIDER=nats`
- `NATS_BASE_URL` — licensed NATS API HTTPS origin
- `NATS_AFFILIATE_PORTAL_URL` — HTTPS portal dancers and agents use for their NATS account, tax forms, and payout settings
- `NATS_API_USERNAME`
- `NATS_API_KEY`

Do not set `COMMISSION_SETTLEMENT_PROVIDER=nats` until the other four values have been installed and verified. With NATS unselected, the existing MyDancr payout path remains active. With NATS selected but incomplete, exports stop safely and no fallback payout is attempted.

## Affiliate verification and sensitive data

An agent or dancer submits only the NATS numeric login ID and optional username to MyDancr. An administrator activates the mapping only after matching the payee in NATS and confirming NATS tax-compliance clearance.

W-9 forms, SSNs/TINs, identity documents, bank details, and payout credentials stay in NATS or its payment provider. MyDancr stores only the NATS login mapping, verification audit note, commission ledger, export state, and provider response metadata.

## Failure handling

- A definite NATS rejection is recorded as `failed` and may be retried after correction.
- A timeout, network error, or accepted invoice whose local completion cannot be confirmed is `reconciliation_required`; it must be checked in NATS before any retry.
- An export lease abandoned for 20 minutes becomes `reconciliation_required` automatically.
- Voiding revenue before export cancels the export. Voiding it after export creates a reconciliation requirement rather than silently reversing money.
- Every finance table is delete-protected and every administrative reconciliation requires an audit note.

## Commission policy

- Club Deals remain visible and redeemable on dancer profiles without NATS enrollment. Profile/shift attribution is retained for analytics.
- Dancer eligibility begins at the database-recorded, administrator-verified NATS activation time, not link submission or deal selection. Missing, requested, or disabled accounts earn no new Club Deal commissions.
- At the cashier redemption, MyDancr permanently snapshots eligibility and the active enrollment time. Only eligible redemptions count toward the dancer's monthly 30/40/50 tier. Later enrollment never creates back pay.
- An unenrolled dancer's share stays with MyDancr. Existing sales-agent allocations are independent and unchanged.
- Redemptions before enrollment create no dancer earning or NATS export. Valid commissions already earned during enrollment remain valid if settlement is delayed or the account is later disabled/re-enrolled; exports still require a currently active account.
- Dancer: 30% for monthly redemptions 1–9, 40% for 10–24, and 50% for 25+.
- Direct venue-signing agent: 15%.
- Sponsor levels 1–3: 3%, 2.5%, and 2%.
- One active Founding Agent can receive levels 4–5: 1.5% and 1%.
- No pay-to-join or recruitment event creates commission.
- The maximum combined dancer and agent allocation is 74.5%, leaving MyDancr at least 25.5%.

## Prospective-enrollment migration

`202609080001_prospective_nats_dancer_commissions.sql` replaces the cashier accounting function and dancer NATS export eligibility checks. It serializes enrollment changes with redemption, gives the database control of activation timestamps, and keeps the snapshot immutable. It does not gate Club Deal display or change profiles, schedules, photos, videos, or club fees.

The one-time correction reverses only unpaid, unexported pre-enrollment Club Deal earnings, cancels their exports, and moves their dancer allocation to MyDancr with an audit event. The original earning amount and history remain. The migration stops for reconciliation if it finds paid, reserved, or dispatched pre-enrollment money; it never deletes ledger records or silently claws back payments. Apply only this reviewed migration after rollback verification; do not replay historical migrations.

Applied to production project `hfmzwadzabmgxkjzmqun` and registered atomically as `202609080001 / prospective_nats_dancer_commissions`. Live verification found one unpaid pre-enrollment earning corrected, its export canceled, no waiting dancer exports, and unchanged profile/photo/video/shift counts. No payments were dispatched. The SQL rollback fixture exercised missing/requested/active/disabled/re-enrolled accounts, all 30/40/50 tiers, immutable eligibility, duplicate export claiming, and browser-role denial; no test redemptions persisted.
