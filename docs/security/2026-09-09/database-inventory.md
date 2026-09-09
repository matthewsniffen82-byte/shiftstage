# Step 1 database surface inventory

Source: bb14ecd162af1594c1b031d8aeb38442bbe114d6. These are historical CREATE TABLE names in 126 migration files, not a current catalog dump. Every listed table has an ENABLE ROW LEVEL SECURITY statement somewhere in history. That does not prove its current state, policy safety, function grants or cross-user isolation. Step 3 must resolve current definitions and review SELECT, INSERT, UPDATE and DELETE.

| Historical public table | Source RLS enable found |
| --- | --- |
| account_recovery_events | Yes |
| admin_actions | Yes |
| age_verification_sessions | Yes |
| agent_commission_events | Yes |
| app_users | Yes |
| approval_reviews | Yes |
| club_deals | Yes |
| club_finance_accounts | Yes |
| club_invoice_items | Yes |
| club_invoice_reminders | Yes |
| club_invoices | Yes |
| commission_events | Yes |
| content_reports | Yes |
| customer_deal_saves | Yes |
| customer_profiles | Yes |
| dancer_earning_status_history | Yes |
| dancer_identity_verifications | Yes |
| dancer_nfc_enrollments | Yes |
| dancer_payout_accounts | Yes |
| dancer_payout_batches | Yes |
| dancer_payout_items | Yes |
| dancer_photos | Yes |
| dancer_profile_slug_aliases | Yes |
| dancer_profiles | Yes |
| deal_revenue_events | Yes |
| direction_requests | Yes |
| dmca_agent_settings | Yes |
| dmca_cases | Yes |
| dmca_counter_notices | Yes |
| dmca_strikes | Yes |
| favorites | Yes |
| financial_audit_events | Yes |
| follows | Yes |
| going_signals | Yes |
| image_moderation_records | Yes |
| media_likes | Yes |
| mydancr_tv_events | Yes |
| mydancr_tv_videos | Yes |
| nats_affiliate_accounts | Yes |
| nats_agent_affiliate_accounts | Yes |
| nats_agent_commission_exports | Yes |
| nats_commission_exports | Yes |
| nfc_tags | Yes |
| nfc_tap_events | Yes |
| notifications | Yes |
| payout_provider_oauth_states | Yes |
| payout_settings | Yes |
| profile_views | Yes |
| qr_redemption_events | Yes |
| qr_redemptions | Yes |
| ranking_events | Yes |
| request_rate_limit_buckets | Yes |
| sales_agents | Yes |
| schedule_views | Yes |
| shift_location_events | Yes |
| shifts | Yes |
| social_clicks | Yes |
| social_links | Yes |
| stripe_finance_webhook_events | Yes |
| subscriptions | Yes |
| support_ai_runs | Yes |
| support_messages | Yes |
| support_threads | Yes |
| trending_scores | Yes |
| venue_activity_log | Yes |
| venue_claim_codes | Yes |
| venue_club_deal_requests | Yes |
| venue_dancer_affiliation_events | Yes |
| venue_dancer_affiliations | Yes |
| venue_dancer_verification_tokens | Yes |
| venue_follows | Yes |
| venue_nfc_support_requests | Yes |
| venue_ownership_claims | Yes |
| venue_page_events | Yes |
| venue_pilot_night_reports | Yes |
| venue_referral_fee_change_requests | Yes |
| venue_referral_fee_terms | Yes |
| venue_sales_attributions | Yes |
| venue_signup_requests | Yes |
| venue_team_invitations | Yes |
| venue_team_members | Yes |
| venues | Yes |

## Duplicate migration prefixes

- 202606280001: 202606280001_add_venue_user_role.sql; 202606280001_shift_location_checkins.sql
- 202608040001: 202608040001_public_media_watermarks.sql; 202608040001_qr_finance_operations.sql
- 202608080001: 202608080001_multi_offer_club_deals.sql; 202608080001_mydancr_tv_thirty_second_feed_distribution.sql; 202608080001_separate_venue_receivables_and_dancer_payouts.sql
- 202608180001: 202608180001_bitsafe_payout_provider.sql; 202608180001_fix_dancer_profile_commission_at_fifty_percent.sql

Live OpenAPI metadata is not a full Postgres catalog. The schema omits retired identity/session objects and uses payment_provider_webhook_events after its rename; view definitions include public_dancer_profiles and dancer_monthly_impact. Do not rename previously applied migration files or infer that missing REST entries mean missing physical tables.
