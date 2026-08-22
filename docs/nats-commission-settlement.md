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

- Dancer: 30% for monthly redemptions 1–9, 40% for 10–24, and 50% for 25+.
- Direct venue-signing agent: 15%.
- Sponsor levels 1–3: 3%, 2.5%, and 2%.
- One active Founding Agent can receive levels 4–5: 1.5% and 1%.
- No pay-to-join or recruitment event creates commission.
- The maximum combined dancer and agent allocation is 74.5%, leaving MyDancr at least 25.5%.
