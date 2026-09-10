# Current public-table access matrix

Read-only catalog: 2026-09-10T00:55:22.697866+00:00. Column/helper/role capture: 2026-09-10T00:59:48.041918+00:00.

S/I/U/D mean table-level SELECT/INSERT/UPDATE/DELETE grants. A grant permits an operation only when RLS also permits its target row; it does not expose every record. Column SELECT grants are shown separately. Policy command/name summaries below map intended owner, customer, dancer, venue and administrator access. Full predicates, restrictive/permissive combinations, view definitions and exact role grants are in tests/fixtures/rls-current-access.json. Server access is trusted and must remain behind authenticated/authorized API routes.

| Relation | RLS / view | Anonymous grants | Authenticated grants | Server grants | Policy commands and access scope |
| --- | --- | --- | --- | --- | --- |
| account_recovery_events | Enabled | none | none | SIUD | No direct browser policy; server-only or underlying view rules |
| admin_actions | Enabled | none | S | SIUD | SELECT: active admins read audit history |
| agent_commission_events | Enabled | S | SIUD | SIUD | ALL: Admins manage agent commissions; SELECT: Agents read own commissions |
| app_users | Enabled | S | S | SIUD | SELECT: users read own profile |
| approval_reviews | Enabled | S | SIUD | SIUD | ALL: admins manage reviews; SELECT: dancers read own reviews |
| club_deals | Enabled | S | S | SIUD | SELECT: Active club deals are public; ALL: Admins manage club deals; SELECT: Venue owners read own club deals |
| club_finance_accounts | Enabled | S | SIUD | SIUD | ALL: Admins manage club finance accounts; SELECT: Venue owners read own finance account |
| club_invoice_items | Enabled | S | SIUD | SIUD | ALL: Admins manage club invoice items; SELECT: Venue owners read own invoice items |
| club_invoice_reminders | Enabled | S | SIUD | SIUD | ALL: Admins manage club invoice reminders; SELECT: Venue owners read own invoice reminders |
| club_invoices | Enabled | S | SIUD | SIUD | ALL: Admins manage club invoices; SELECT: Venue owners read own invoices |
| commission_events | Enabled | S | S | SIUD | SELECT: Admins read commission events; SELECT: Dancers read own earnings |
| content_reports | Enabled | S | SUD | SIUD | ALL: admins manage content reports |
| customer_deal_saves | Enabled | none | SID | SIUD | SELECT: customers read own saved club deals; DELETE: customers remove own saved club deals; INSERT: customers save own club deals |
| customer_profiles | Enabled | S | SIUD | SIUD | INSERT (restrictive): active account required for inserts; UPDATE (restrictive): active account required for updates; ALL: customers manage own profile |
| dancer_earning_status_history | Enabled | S | S | SIUD | SELECT: Admins read earning history; SELECT: Dancers read own earning history |
| dancer_monthly_impact | View: owner permissions | none | none | SIUD | No direct browser policy; server-only or underlying view rules |
| dancer_nfc_enrollments | Enabled | S | SIUD | SIUD | ALL: Admins manage dancer NFC enrollments; SELECT: Dancers read own NFC enrollments; SELECT: Venue owners read own dancer NFC enrollments |
| dancer_payout_accounts | Enabled | S | S | SIUD | SELECT: Admins read dancer payout accounts; SELECT: Dancers read own payout account |
| dancer_payout_batches | Enabled | S | S | SIUD | SELECT: Admins read dancer payout batches; SELECT: Dancers read own payout batches |
| dancer_payout_items | Enabled | S | S | SIUD | SELECT: Admins read dancer payout items; SELECT: Dancers read own payout items |
| dancer_photos | Enabled | S | S | SIUD | SELECT: approved photos are public |
| dancer_profile_slug_aliases | Enabled | none | none | SIUD | No direct browser policy; server-only or underlying view rules |
| dancer_profiles | Enabled | none + 20 column SELECT grants | none + 20 column SELECT grants | SIUD | SELECT: approved public dancers are public |
| deal_revenue_events | Enabled | S | SIUD | SIUD | ALL: Admins manage deal revenue events |
| direction_requests | Enabled | S | S | SIUD | SELECT: dancers read own direction analytics |
| dmca_agent_settings | Enabled | none | SIUD | SIUD | ALL: admins manage dmca agent settings |
| dmca_cases | Enabled | S | SIUD | SIUD | ALL: admins manage dmca cases; SELECT: uploaders read own dmca cases |
| dmca_counter_notices | Enabled | S | SIUD | SIUD | ALL: admins manage counter notices; SELECT: uploaders read own counter notices |
| dmca_strikes | Enabled | S | SIUD | SIUD | ALL: admins manage dmca strikes; SELECT: users read own dmca strikes |
| favorites | Enabled | S | SIUD | SIUD | INSERT (restrictive): active account required for inserts; UPDATE (restrictive): active account required for updates; ALL: customers manage own favorites |
| financial_audit_events | Enabled | S | S | SIUD | SELECT: Admins read financial audit |
| follows | Enabled | S | SIUD | SIUD | INSERT (restrictive): active account required for inserts; UPDATE (restrictive): active account required for updates; ALL: customers manage own follows |
| going_signals | Enabled | S | SIUD | SIUD | INSERT (restrictive): active account required for inserts; UPDATE (restrictive): active account required for updates; ALL: customers manage own going signals |
| image_moderation_records | Enabled | S | S | SIUD | ALL: admins manage image moderation; SELECT: users read own moderation status |
| media_likes | Enabled | none | none | SIUD | No direct browser policy; server-only or underlying view rules |
| mydancr_tv_events | Enabled | S | S | SIUD | SELECT: dancers read own MyDancr TV analytics; SELECT: venue owners read MyDancr TV analytics |
| mydancr_tv_videos | Enabled | S | S | SIUD | ALL: admins manage MyDancr TV videos; SELECT: dancers read own MyDancr TV videos; SELECT: public reads approved MyDancr TV videos; SELECT: venue owners read tagged MyDancr TV videos |
| nats_affiliate_accounts | Enabled | S | S | SIUD | SELECT: Admins read NATS affiliate accounts; SELECT: Dancers read own NATS affiliate account |
| nats_agent_affiliate_accounts | Enabled | S | S | SIUD | SELECT: Admins read NATS agent affiliate accounts; SELECT: Agents read own NATS affiliate account |
| nats_agent_commission_exports | Enabled | S | S | SIUD | SELECT: Admins read NATS agent commission exports; SELECT: Agents read own NATS commission exports |
| nats_commission_exports | Enabled | S | S | SIUD | SELECT: Admins read NATS commission exports; SELECT: Dancers read own NATS commission exports |
| nfc_tags | Enabled | S | SIUD | SIUD | ALL: Admins manage NFC tags; SELECT: Venue owners read own NFC tags |
| nfc_tap_events | Enabled | S | SIUD | SIUD | ALL: Admins manage NFC tap events; SELECT: Dancers read own NFC tap events; SELECT: Venue owners read own NFC tap events |
| notifications | Enabled | S | SIUD | SIUD | INSERT: admins create notifications; DELETE: users delete own notifications; SELECT: users read own notifications; UPDATE: users update own notifications |
| payment_provider_webhook_events | Enabled | S | S | SIUD | SELECT: Admins read provider webhooks |
| payout_settings | Enabled | S | S | SIUD | SELECT: Admins read payout settings |
| profile_views | Enabled | S | S | SIUD | SELECT: dancers read own analytics |
| public_dancer_profiles | View: security_invoker=true,security_barrier=true | S | S | SIUD | No direct browser policy; server-only or underlying view rules |
| qr_redemption_events | Enabled | S | SIUD | SIUD | ALL: Admins manage QR redemption events; SELECT: Dancers read own QR redemption events; SELECT: Venue owners read own QR redemption events |
| qr_redemptions | Enabled | S | SIUD | SIUD | ALL: Admins manage qr redemptions; SELECT: Dancers view own attributed redemptions; SELECT: Venue owners read own QR redemptions |
| ranking_events | Enabled | S | SIUD | SIUD | ALL: admins manage ranking events; SELECT: dancers read own ranking events |
| request_rate_limit_buckets | Enabled | none | none | SIUD | No direct browser policy; server-only or underlying view rules |
| sales_agents | Enabled | S | SIUD | SIUD | ALL: Admins manage sales agents; SELECT: Agents read own sales record |
| schedule_views | Enabled | S | S | SIUD | SELECT: dancers read own schedule analytics |
| shift_location_events | Enabled | none | S | SIUD | SELECT: dancers read own location events |
| shifts | Enabled | none + 21 column SELECT grants | none + 21 column SELECT grants | SIUD | ALL: approved dancers manage own shifts; SELECT: posted approved shifts are public |
| social_clicks | Enabled | S | S | SIUD | SELECT: dancers read own social analytics |
| social_links | Enabled | S | S | SIUD | SELECT: approved social links are public |
| subscriptions | Enabled | S | SIUD | SIUD | ALL: admins manage subscriptions; SELECT: dancers read own subscription |
| support_ai_runs | Enabled | S | S | SIUD | SELECT: admins read support ai runs |
| support_messages | Enabled | S | S | SIUD | INSERT: users create own support messages; SELECT: users read own support messages |
| support_threads | Enabled | S | S | SIUD | INSERT: users create own support threads; SELECT: users read own support threads; UPDATE: users update own support threads |
| trending_scores | Enabled | S | SIUD | SIUD | ALL: admins manage rankings; SELECT: approved rankings are public |
| venue_activity_log | Enabled | S | SIUD | SIUD | ALL: Admins manage venue activity; SELECT: Venue team reads own activity |
| venue_claim_codes | Enabled | none | none | SIUD | ALL: admins manage venue claim codes |
| venue_club_deal_requests | Enabled | S | SIUD | SIUD | ALL: Admins manage venue Club Deal requests; SELECT: Venue teams read own Club Deal requests |
| venue_dancer_affiliation_events | Enabled | none | none | SIUD | No direct browser policy; server-only or underlying view rules |
| venue_dancer_affiliations | Enabled | none | none | SIUD | No direct browser policy; server-only or underlying view rules |
| venue_dancer_verification_tokens | Enabled | none | none | SIUD | No direct browser policy; server-only or underlying view rules |
| venue_follows | Enabled | S | SIUD | SIUD | INSERT (restrictive): active account required for inserts; UPDATE (restrictive): active account required for updates; ALL: customers manage own venue follows |
| venue_nfc_support_requests | Enabled | S | SIUD | SIUD | ALL: Admins manage venue NFC support requests; SELECT: Venue team reads own NFC support requests |
| venue_ownership_claims | Enabled | S | SIUD | SIUD | ALL: admins manage venue claims; SELECT: claimants read own venue claims |
| venue_page_events | Enabled | S | S | SIUD | SELECT: venue owners read venue analytics |
| venue_pilot_night_reports | Enabled | S | SIUD | SIUD | ALL: Admins manage venue pilot night reports |
| venue_referral_fee_change_requests | Enabled | S | SIUD | SIUD | ALL: Admins manage referral fee requests; SELECT: Venue owners read own referral fee requests |
| venue_referral_fee_terms | Enabled | S | SIUD | SIUD | ALL: Admins manage referral fee terms; SELECT: Venue owners read own referral fee terms |
| venue_sales_attributions | Enabled | S | SIUD | SIUD | ALL: Admins manage venue sales attribution; SELECT: Agents read attributed venues |
| venue_signup_requests | Enabled | none | none | SIUD | ALL: Admins manage venue signup requests |
| venue_team_invitations | Enabled | S | SIUD | SIUD | ALL: Admins manage venue team invitations; SELECT: Venue owners read own team invitations |
| venue_team_members | Enabled | S | SIUD | SIUD | ALL: Admins manage venue team members; SELECT: Venue users read own team membership |
| venues | Enabled | S | SIUD | SIUD | SELECT: active venues are public; ALL: admins manage venues; SELECT: venue owners read own venue |

The snapshot itself is evidence of configuration, not proof of every permitted workflow. Current synthetic role tests and deployed read-only probes provide separate behavioral evidence. Hosted account/RLS/Storage end-to-end testing remains deferred with the disposable test project.
