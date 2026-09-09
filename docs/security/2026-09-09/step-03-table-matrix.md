# Step 3 public table and view access matrix

Catalog: 2026-09-09 10:51 UTC, before the active-account preference-write migration. All base tables below have RLS enabled. S/I/U/D denote table-level SELECT/INSERT/UPDATE/DELETE grants; grants remain subject to the listed policies. Column-only SELECT grants are noted separately. The full predicates and definitions are retained in the existing catalog inventory.

| Relation | Anonymous grants | Authenticated grants | Policies / access boundary |
| --- | --- | --- | --- |
| account_recovery_events | none | none | server-only; no browser grants/policies |
| admin_actions | S | DISU | ALL: admins manage admin actions |
| agent_commission_events | S | DISU | ALL: Admins manage agent commissions; SELECT: Agents read own commissions |
| app_users | S | S | SELECT: users read own profile |
| approval_reviews | S | DISU | ALL: admins manage reviews; SELECT: dancers read own reviews |
| club_deals | S | S | SELECT: Active club deals are public; ALL: Admins manage club deals; SELECT: Venue owners read own club deals |
| club_finance_accounts | S | DISU | ALL: Admins manage club finance accounts; SELECT: Venue owners read own finance account |
| club_invoice_items | S | DISU | ALL: Admins manage club invoice items; SELECT: Venue owners read own invoice items |
| club_invoice_reminders | S | DISU | ALL: Admins manage club invoice reminders; SELECT: Venue owners read own invoice reminders |
| club_invoices | S | DISU | ALL: Admins manage club invoices; SELECT: Venue owners read own invoices |
| commission_events | S | S | SELECT: Admins read commission events; SELECT: Dancers read own earnings |
| content_reports | S | DSU | ALL: admins manage content reports |
| customer_deal_saves | none | DIS | SELECT: customers read own saved club deals; DELETE: customers remove own saved club deals; INSERT: customers save own club deals |
| customer_profiles | S | DISU | ALL: customers manage own profile |
| dancer_earning_status_history | S | S | SELECT: Admins read earning history; SELECT: Dancers read own earning history |
| dancer_monthly_impact | none | none | private view; browser privileges revoked |
| dancer_nfc_enrollments | S | DISU | ALL: Admins manage dancer NFC enrollments; SELECT: Dancers read own NFC enrollments; SELECT: Venue owners read own dancer NFC enrollments |
| dancer_payout_accounts | S | S | SELECT: Admins read dancer payout accounts; SELECT: Dancers read own payout account |
| dancer_payout_batches | S | S | SELECT: Admins read dancer payout batches; SELECT: Dancers read own payout batches |
| dancer_payout_items | S | S | SELECT: Admins read dancer payout items; SELECT: Dancers read own payout items |
| dancer_photos | S | S | SELECT: approved photos are public |
| dancer_profile_slug_aliases | none | none | server-only; no browser grants/policies |
| dancer_profiles | column SELECT | column SELECT | SELECT: approved public dancers are public |
| deal_revenue_events | S | DISU | ALL: Admins manage deal revenue events |
| direction_requests | S | S | SELECT: dancers read own direction analytics |
| dmca_agent_settings | none | DISU | ALL: admins manage dmca agent settings |
| dmca_cases | S | DISU | ALL: admins manage dmca cases; SELECT: uploaders read own dmca cases |
| dmca_counter_notices | S | DISU | ALL: admins manage counter notices; SELECT: uploaders read own counter notices |
| dmca_strikes | S | DISU | ALL: admins manage dmca strikes; SELECT: users read own dmca strikes |
| favorites | S | DISU | ALL: customers manage own favorites |
| financial_audit_events | S | S | SELECT: Admins read financial audit |
| follows | S | DISU | ALL: customers manage own follows |
| going_signals | S | DISU | ALL: customers manage own going signals |
| image_moderation_records | S | S | ALL: admins manage image moderation; SELECT: users read own moderation status |
| media_likes | none | none | server-only; no browser grants/policies |
| mydancr_tv_events | S | S | SELECT: dancers read own MyDancr TV analytics; SELECT: venue owners read MyDancr TV analytics |
| mydancr_tv_videos | S | S | ALL: admins manage MyDancr TV videos; SELECT: dancers read own MyDancr TV videos; SELECT: public reads approved MyDancr TV videos; SELECT: venue owners read tagged MyDancr TV videos |
| nats_affiliate_accounts | S | S | SELECT: Admins read NATS affiliate accounts; SELECT: Dancers read own NATS affiliate account |
| nats_agent_affiliate_accounts | S | S | SELECT: Admins read NATS agent affiliate accounts; SELECT: Agents read own NATS affiliate account |
| nats_agent_commission_exports | S | S | SELECT: Admins read NATS agent commission exports; SELECT: Agents read own NATS commission exports |
| nats_commission_exports | S | S | SELECT: Admins read NATS commission exports; SELECT: Dancers read own NATS commission exports |
| nfc_tags | S | DISU | ALL: Admins manage NFC tags; SELECT: Venue owners read own NFC tags |
| nfc_tap_events | S | DISU | ALL: Admins manage NFC tap events; SELECT: Dancers read own NFC tap events; SELECT: Venue owners read own NFC tap events |
| notifications | S | DISU | INSERT: admins create notifications; DELETE: users delete own notifications; SELECT: users read own notifications; UPDATE: users update own notifications |
| payment_provider_webhook_events | S | S | SELECT: Admins read provider webhooks |
| payout_settings | S | S | SELECT: Admins read payout settings |
| profile_views | S | S | SELECT: dancers read own analytics |
| public_dancer_profiles | S | S | security_invoker view; underlying RLS |
| qr_redemption_events | S | DISU | ALL: Admins manage QR redemption events; SELECT: Dancers read own QR redemption events; SELECT: Venue owners read own QR redemption events |
| qr_redemptions | S | DISU | ALL: Admins manage qr redemptions; SELECT: Dancers view own attributed redemptions; SELECT: Venue owners read own QR redemptions |
| ranking_events | S | DISU | ALL: admins manage ranking events; SELECT: dancers read own ranking events |
| request_rate_limit_buckets | none | none | server-only; no browser grants/policies |
| sales_agents | S | DISU | ALL: Admins manage sales agents; SELECT: Agents read own sales record |
| schedule_views | S | S | SELECT: dancers read own schedule analytics |
| shift_location_events | none | S | SELECT: dancers read own location events |
| shifts | column SELECT | column SELECT | ALL: approved dancers manage own shifts; SELECT: posted approved shifts are public |
| social_clicks | S | S | SELECT: dancers read own social analytics |
| social_links | S | S | SELECT: approved social links are public |
| subscriptions | S | DISU | ALL: admins manage subscriptions; SELECT: dancers read own subscription |
| support_ai_runs | S | S | SELECT: admins read support ai runs |
| support_messages | S | S | INSERT: users create own support messages; SELECT: users read own support messages |
| support_threads | S | S | INSERT: users create own support threads; SELECT: users read own support threads; UPDATE: users update own support threads |
| trending_scores | S | DISU | ALL: admins manage rankings; SELECT: approved rankings are public |
| venue_activity_log | S | DISU | ALL: Admins manage venue activity; SELECT: Venue team reads own activity |
| venue_claim_codes | none | none | ALL: admins manage venue claim codes |
| venue_club_deal_requests | S | DISU | ALL: Admins manage venue Club Deal requests; SELECT: Venue teams read own Club Deal requests |
| venue_dancer_affiliation_events | none | none | server-only; no browser grants/policies |
| venue_dancer_affiliations | none | none | server-only; no browser grants/policies |
| venue_dancer_verification_tokens | none | none | server-only; no browser grants/policies |
| venue_follows | S | DISU | ALL: customers manage own venue follows |
| venue_nfc_support_requests | S | DISU | ALL: Admins manage venue NFC support requests; SELECT: Venue team reads own NFC support requests |
| venue_ownership_claims | S | DISU | ALL: admins manage venue claims; SELECT: claimants read own venue claims |
| venue_page_events | S | S | SELECT: venue owners read venue analytics |
| venue_pilot_night_reports | S | DISU | ALL: Admins manage venue pilot night reports |
| venue_referral_fee_change_requests | S | DISU | ALL: Admins manage referral fee requests; SELECT: Venue owners read own referral fee requests |
| venue_referral_fee_terms | S | DISU | ALL: Admins manage referral fee terms; SELECT: Venue owners read own referral fee terms |
| venue_sales_attributions | S | DISU | ALL: Admins manage venue sales attribution; SELECT: Agents read attributed venues |
| venue_signup_requests | none | none | ALL: Admins manage venue signup requests |
| venue_team_invitations | S | DISU | ALL: Admins manage venue team invitations; SELECT: Venue owners read own team invitations |
| venue_team_members | S | DISU | ALL: Admins manage venue team members; SELECT: Venue users read own team membership |
| venues | S | DISU | SELECT: active venues are public; ALL: admins manage venues; SELECT: venue owners read own venue |
