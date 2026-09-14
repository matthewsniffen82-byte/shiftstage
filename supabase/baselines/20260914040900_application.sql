-- Application baseline captured from production on 2026-09-14T04:18:50.963497+00:00.
-- For a new Supabase project with platform-managed Auth/Storage schemas.
-- Do not apply to an existing application database. Use reviewed forward migrations.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
do $$begin if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f')) then raise exception 'Baseline requires an empty public application schema';end if;end$$;
-- Reconstruct application objects only. Auth/Storage services, data and the migration ledger remain platform prerequisites.
set local check_function_bodies=off;
create type public."account_state" as enum ('active','disabled','deleted');
create type public."dancer_status" as enum ('draft','pending_review','approved','rejected','disabled');
create type public."notification_channel" as enum ('in_app','push','email');
create type public."notification_type" as enum ('shift_posted','shift_updated','shift_cancelled','ranking_milestone','approval_status','weekly_summary','support_message','tv_video_status','dmca_status','venue_claim_status','venue_affiliation_status','venue_publication_status','engagement');
create type public."review_status" as enum ('pending','approved','rejected');
create type public."shift_status" as enum ('draft','posted','cancelled','completed');
create type public."social_platform" as enum ('instagram','tiktok','snapchat','x','onlyfans');
create type public."user_role" as enum ('customer','dancer','admin','venue');
create table public."account_recovery_events" ("id" uuid not null,
"event_type" text not null,
"account_role" text not null,
"request_ip_hash" text not null,
"subject_hash" text not null,
"outcome" text not null,
"created_at" timestamp with time zone not null);
create table public."account_self_pauses" ("user_id" uuid not null,
"paused_at" timestamp with time zone not null,
"venue_id" uuid,
"venue_was_active" boolean,
"dancer_id" uuid,
"dancer_previous_state" jsonb,
"legacy_imported" boolean not null);
create table public."admin_actions" ("id" uuid not null,
"admin_id" uuid,
"target_type" text not null,
"target_id" uuid,
"action" text not null,
"notes" text,
"created_at" timestamp with time zone not null);
create table public."agent_commission_events" ("id" uuid not null,
"deal_revenue_event_id" uuid not null,
"qr_redemption_id" uuid not null,
"venue_id" uuid not null,
"venue_sales_attribution_id" uuid not null,
"recipient_agent_id" uuid not null,
"signing_agent_id" uuid not null,
"sponsor_level" smallint not null,
"share_bps" integer not null,
"amount_cents" integer not null,
"currency" text not null,
"status" text not null,
"commission_month" date not null,
"venue_payment_received_at" timestamp with time zone,
"payable_at" timestamp with time zone,
"paid_at" timestamp with time zone,
"payout_reference" text,
"voided_at" timestamp with time zone,
"audit" jsonb not null,
"created_at" timestamp with time zone not null);
create table public."app_users" ("id" uuid not null,
"role" user_role not null,
"display_name" text,
"email" text,
"account_state" account_state not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"dmca_suspended_at" timestamp with time zone);
create table public."approval_reviews" ("id" uuid not null,
"dancer_id" uuid not null,
"reviewer_id" uuid,
"review_type" text not null,
"status" review_status not null,
"notes" text,
"created_at" timestamp with time zone not null,
"reviewed_at" timestamp with time zone);
create table public."club_deals" ("id" uuid not null,
"venue_id" uuid not null,
"deal_title" text not null,
"deal_description" text not null,
"deal_terms" text,
"is_active" boolean not null,
"valid_days" text[],
"valid_start_time" time without time zone,
"valid_end_time" time without time zone,
"redemption_rules" jsonb not null,
"payout_type" text not null,
"payout_amount_cents" integer not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"currency" text not null,
"offer_type" text not null,
"booking_url" text,
"sort_order" integer not null,
"removed_at" timestamp with time zone);
create table public."club_finance_accounts" ("venue_id" uuid not null,
"stripe_customer_id" text,
"billing_email" text,
"collection_method" text not null,
"payment_terms_days" integer not null,
"automatic_billing_enabled" boolean not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."club_invoice_items" ("id" uuid not null,
"invoice_id" uuid not null,
"revenue_event_id" uuid not null,
"amount_cents" integer not null,
"created_at" timestamp with time zone not null);
create table public."club_invoice_reminders" ("id" uuid not null,
"invoice_id" uuid not null,
"reminder_key" text not null,
"delivery_provider" text not null,
"provider_reference" text,
"sent_at" timestamp with time zone not null,
"audit" jsonb not null);
create table public."club_invoices" ("id" uuid not null,
"venue_id" uuid not null,
"period_start" date not null,
"period_end" date not null,
"sequence" integer not null,
"status" text not null,
"currency" text not null,
"amount_due_cents" integer not null,
"amount_paid_cents" integer not null,
"due_at" timestamp with time zone not null,
"stripe_customer_id" text,
"stripe_invoice_id" text,
"hosted_invoice_url" text,
"invoice_pdf_url" text,
"external_payment_reference" text,
"paid_at" timestamp with time zone,
"last_reminder_at" timestamp with time zone,
"reminder_count" integer not null,
"last_error" text,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."club_shuttle_requests" ("id" uuid not null,
"venue_id" uuid not null,
"deal_id" uuid,
"details_hash" text not null,
"notification_rows" jsonb not null,
"venue_phone" text,
"created_at" timestamp with time zone not null,
"handed_off_at" timestamp with time zone);
create table public."commission_events" ("id" uuid not null,
"qr_redemption_id" uuid not null,
"venue_id" uuid not null,
"club_deal_id" uuid not null,
"dancer_id" uuid not null,
"status" text not null,
"amount_cents" integer not null,
"payout_type" text not null,
"club_payment_received_at" timestamp with time zone,
"payable_at" timestamp with time zone,
"paid_at" timestamp with time zone,
"rejected_at" timestamp with time zone,
"voided_at" timestamp with time zone,
"audit" jsonb not null,
"created_at" timestamp with time zone not null,
"gross_commission_cents" integer not null,
"dancer_share_bps" integer not null,
"platform_amount_cents" integer not null,
"successful_redemption_number" integer,
"commission_month" date,
"currency" text not null,
"policy_version" text not null,
"payout_batch_id" uuid,
"earning_type" text not null,
"gross_transaction_amount_cents" bigint,
"payment_provider" text,
"pending_until" timestamp with time zone,
"available_at" timestamp with time zone,
"reversed_at" timestamp with time zone,
"reversal_reason" text,
"held_at" timestamp with time zone,
"hold_reason" text,
"review_flag" text,
"recovery_required" boolean not null,
"is_test" boolean not null,
"metadata" jsonb not null);
create table public."content_reports" ("id" uuid not null,
"reporter_id" uuid,
"target_type" text not null,
"target_id" uuid,
"target_label" text not null,
"reason" text not null,
"details" text,
"status" text not null,
"reviewed_by" uuid,
"reviewed_at" timestamp with time zone,
"created_at" timestamp with time zone not null);
create table public."customer_deal_saves" ("customer_id" uuid not null,
"club_deal_id" uuid not null,
"source_type" text not null,
"dancer_id" uuid,
"created_at" timestamp with time zone not null);
create table public."customer_profiles" ("user_id" uuid not null,
"city" text not null,
"notification_settings" jsonb not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."dancer_earning_status_history" ("id" bigint generated always as identity (sequence name public."dancer_earning_status_history_id_seq" start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle) not null,
"earning_id" uuid not null,
"from_status" text,
"to_status" text not null,
"actor_user_id" uuid,
"actor_type" text not null,
"reason" text,
"metadata" jsonb not null,
"created_at" timestamp with time zone not null);
create table public."dancer_nfc_enrollments" ("id" uuid not null,
"dancer_user_id" uuid not null,
"venue_id" uuid not null,
"nfc_tag_id" uuid not null,
"status" text not null,
"tapped_at" timestamp with time zone not null,
"expires_at" timestamp with time zone not null,
"completed_at" timestamp with time zone,
"last_attempted_at" timestamp with time zone,
"audit" jsonb not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."dancer_payout_accounts" ("dancer_id" uuid not null,
"stripe_account_id" text,
"country" text not null,
"default_currency" text not null,
"details_submitted" boolean not null,
"charges_enabled" boolean not null,
"payouts_enabled" boolean not null,
"onboarding_complete" boolean not null,
"last_error" text,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"id" uuid not null,
"payment_provider" text not null,
"provider_account_id" text,
"onboarding_status" text not null,
"payout_eligibility" text not null,
"verification_status" text not null,
"provider_status" jsonb not null);
create table public."dancer_payout_batches" ("id" uuid not null,
"dancer_id" uuid not null,
"status" text not null,
"currency" text not null,
"amount_cents" integer not null,
"period_start" date,
"period_end" date,
"stripe_transfer_id" text,
"external_reference" text,
"failure_message" text,
"paid_at" timestamp with time zone,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"payment_provider" text not null,
"provider_reference_id" text,
"requested_at" timestamp with time zone not null,
"processing_at" timestamp with time zone,
"failed_at" timestamp with time zone,
"canceled_at" timestamp with time zone,
"request_key" text,
"is_test" boolean not null,
"metadata" jsonb not null);
create table public."dancer_payout_items" ("id" uuid not null,
"payout_batch_id" uuid not null,
"commission_event_id" uuid not null,
"amount_cents" integer not null,
"created_at" timestamp with time zone not null);
create table public."dancer_photos" ("id" uuid not null,
"dancer_id" uuid not null,
"storage_path" text not null,
"alt_text" text,
"sort_order" integer not null,
"is_primary" boolean not null,
"review_status" review_status not null,
"created_at" timestamp with time zone not null,
"like_count" bigint not null,
"is_pinned" boolean not null);
create table public."dancer_profile_slug_aliases" ("slug" text not null,
"dancer_id" uuid not null,
"created_at" timestamp with time zone not null);
create table public."dancer_profiles" ("id" uuid not null,
"user_id" uuid not null,
"real_name" text not null,
"stage_name" text not null,
"slug" text not null,
"city" text not null,
"recovery_dropped_slot_7" text,
"status" dancer_status not null,
"verification_status" review_status not null,
"photo_review_status" review_status not null,
"approved_at" timestamp with time zone,
"disabled_at" timestamp with time zone,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"is_public" boolean not null,
"dmca_suspended_at" timestamp with time zone,
"avatar_storage_path" text,
"avatar_updated_at" timestamp with time zone,
"venue_approved_at" timestamp with time zone,
"venue_approved_by_user_id" uuid,
"venue_approved_venue_id" uuid,
"identity_saved_at" timestamp with time zone,
"admin_disabled_at" timestamp with time zone);
alter table public."dancer_profiles" drop column "recovery_dropped_slot_7";
create table public."deal_revenue_events" ("id" uuid not null,
"qr_redemption_id" uuid not null,
"venue_id" uuid not null,
"club_deal_id" uuid not null,
"dancer_id" uuid,
"source_type" text not null,
"currency" text not null,
"gross_commission_cents" integer not null,
"dancer_share_bps" integer not null,
"dancer_commission_cents" integer not null,
"platform_commission_cents" integer not null,
"successful_redemption_number" integer,
"commission_month" date not null,
"policy_version" text not null,
"status" text not null,
"venue_payment_reference" text,
"venue_payment_received_at" timestamp with time zone,
"dancer_payout_reference" text,
"dancer_paid_at" timestamp with time zone,
"refunded_at" timestamp with time zone,
"voided_at" timestamp with time zone,
"audit" jsonb not null,
"confirmed_at" timestamp with time zone not null,
"created_at" timestamp with time zone not null,
"club_invoice_id" uuid,
"recovery_dropped_slot_26" text,
"recovery_dropped_slot_27" text,
"agent_commission_cents" integer not null,
"venue_sales_attribution_id" uuid,
"dancer_commission_eligible" boolean not null,
"dancer_nats_activated_at" timestamp with time zone);
alter table public."deal_revenue_events" drop column "recovery_dropped_slot_26";
alter table public."deal_revenue_events" drop column "recovery_dropped_slot_27";
create table public."direction_requests" ("id" uuid not null,
"dancer_id" uuid,
"venue_id" uuid not null,
"requester_id" uuid,
"requested_at" timestamp with time zone not null,
"session_id" text);
create table public."dmca_agent_settings" ("id" boolean not null,
"legal_name" text not null,
"organization" text,
"email" text not null,
"phone" text,
"address_line_1" text,
"address_line_2" text,
"city" text,
"state_region" text,
"postal_code" text,
"country" text,
"registered_with_copyright_office" boolean not null,
"registration_renewal_at" date,
"updated_by" uuid,
"updated_at" timestamp with time zone not null);
create table public."dmca_cases" ("id" uuid not null,
"claimant_name" text not null,
"claimant_company" text,
"claimant_email" text not null,
"claimant_phone" text not null,
"claimant_address" text not null,
"copyrighted_work_description" text not null,
"original_work_url" text,
"infringing_url" text not null,
"target_type" text not null,
"target_id" uuid,
"uploader_id" uuid,
"status" text not null,
"good_faith_confirmed" boolean not null,
"accuracy_confirmed" boolean not null,
"authority_confirmed" boolean not null,
"signature" text not null,
"request_ip_hash" text not null,
"content_previous_status" text,
"reviewed_by" uuid,
"reviewed_at" timestamp with time zone,
"disabled_at" timestamp with time zone,
"uploader_notified_at" timestamp with time zone,
"counter_received_at" timestamp with time zone,
"restore_eligible_at" timestamp with time zone,
"restore_deadline_at" timestamp with time zone,
"court_filing_received" boolean not null,
"court_filing_notes" text,
"restored_at" timestamp with time zone,
"repeat_infringer_enforced" boolean not null,
"account_previous_state" text,
"dancer_previous_status" text,
"admin_notes" text,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."dmca_counter_notices" ("id" uuid not null,
"case_id" uuid not null,
"uploader_id" uuid not null,
"legal_name" text not null,
"email" text not null,
"phone" text not null,
"address" text not null,
"removed_material_location" text not null,
"mistake_belief_confirmed" boolean not null,
"perjury_confirmed" boolean not null,
"jurisdiction_confirmed" boolean not null,
"service_confirmed" boolean not null,
"signature" text not null,
"status" text not null,
"forwarded_to_claimant_at" timestamp with time zone,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."dmca_enforcement_states" ("target_type" text not null,
"target_id" uuid not null,
"uploader_id" uuid not null,
"previous_state" jsonb not null,
"applied_state" jsonb not null,
"restore_allowed" boolean not null,
"enforced_at" timestamp with time zone not null,
"invalidated_at" timestamp with time zone);
create table public."dmca_strikes" ("id" uuid not null,
"case_id" uuid not null,
"user_id" uuid not null,
"active" boolean not null,
"issued_at" timestamp with time zone not null,
"rescinded_at" timestamp with time zone,
"rescinded_reason" text);
create table public."favorites" ("customer_id" uuid not null,
"dancer_id" uuid not null,
"created_at" timestamp with time zone not null);
create table public."financial_audit_events" ("id" bigint generated always as identity (sequence name public."financial_audit_events_id_seq" start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle) not null,
"actor_user_id" uuid,
"actor_type" text not null,
"action" text not null,
"target_type" text not null,
"target_id" text not null,
"reason" text,
"before_state" jsonb,
"after_state" jsonb,
"metadata" jsonb not null,
"created_at" timestamp with time zone not null);
create table public."follows" ("customer_id" uuid not null,
"dancer_id" uuid not null,
"notifications_enabled" boolean not null,
"created_at" timestamp with time zone not null);
create table public."gallery_media_reference_history" ("event_id" bigint generated always as identity (sequence name public."gallery_media_reference_history_event_id_seq" start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1 no cycle) not null,
"recorded_at" timestamp with time zone not null,
"transaction_id" bigint not null,
"source_kind" text not null,
"source_id" uuid not null,
"profile_id" uuid not null,
"storage_path" text not null,
"event_kind" text not null);
create table public."gallery_storage_retirements" ("storage_path" text not null,
"retirement_id" uuid not null,
"profile_id" uuid not null,
"retired_at" timestamp with time zone not null);
create table public."going_signals" ("customer_id" uuid,
"shift_id" uuid not null,
"created_at" timestamp with time zone not null,
"id" uuid not null,
"visitor_token_hash" text);
create table public."image_moderation_records" ("id" uuid not null,
"user_id" uuid not null,
"image_id" uuid,
"temporary_storage_path" text,
"final_storage_path" text,
"upload_context" text not null,
"provider" text not null,
"provider_model" text not null,
"provider_flagged" boolean not null,
"decision" text not null,
"status" text not null,
"reason_codes" jsonb not null,
"category_flags" jsonb not null,
"category_scores" jsonb not null,
"error_code" text,
"reviewed_by" uuid,
"reviewed_at" timestamp with time zone,
"review_decision" text,
"review_notes" text,
"idempotency_key" text,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"attempt_count" integer not null,
"next_attempt_at" timestamp with time zone,
"locked_at" timestamp with time zone,
"last_error_code" text,
"last_error_message" text,
"completed_at" timestamp with time zone,
"photo_publication_mode" text not null,
"replacement_photo_id" uuid,
"avatar_expected_path" text,
"avatar_expected_updated_at" timestamp with time zone);
create table public."media_likes" ("id" uuid not null,
"visitor_token_hash" text not null,
"photo_id" uuid,
"video_id" uuid,
"created_at" timestamp with time zone not null);
create table public."mydancr_tv_events" ("id" uuid not null,
"video_id" uuid not null,
"viewer_id" uuid,
"session_id" text not null,
"event_type" text not null,
"source" text not null,
"occurred_on" date not null,
"occurred_at" timestamp with time zone not null);
create table public."mydancr_tv_videos" ("id" uuid not null,
"dancer_id" uuid not null,
"submitted_by" uuid not null,
"venue_id" uuid,
"shift_id" uuid,
"caption" text not null,
"storage_path" text not null,
"storage_mime" text not null,
"file_size_bytes" bigint not null,
"duration_seconds" numeric(7,2) not null,
"width" integer not null,
"height" integer not null,
"status" text not null,
"venue_tag_status" text not null,
"venue_featured" boolean not null,
"consent_confirmed" boolean not null,
"rights_confirmed" boolean not null,
"review_notes" text,
"reviewed_by" uuid,
"submitted_at" timestamp with time zone,
"reviewed_at" timestamp with time zone,
"published_at" timestamp with time zone,
"expires_at" timestamp with time zone,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"moderation_decision" text,
"moderation_reason_codes" text[] not null,
"moderation_category_scores" jsonb not null,
"moderation_provider_flagged" boolean not null,
"moderation_frame_count" integer not null,
"moderation_model" text,
"moderation_details" jsonb not null,
"moderation_attempt_count" integer not null,
"moderation_started_at" timestamp with time zone,
"moderation_completed_at" timestamp with time zone,
"distribution_scope" text not null,
"like_count" bigint not null,
"is_pinned" boolean not null);
create table public."nats_affiliate_accounts" ("dancer_id" uuid not null,
"login_id" bigint not null,
"username" text,
"status" text not null,
"requested_at" timestamp with time zone not null,
"activated_at" timestamp with time zone,
"disabled_at" timestamp with time zone,
"verified_by" uuid,
"verification_note" text,
"last_error" text,
"metadata" jsonb not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."nats_agent_affiliate_accounts" ("agent_id" uuid not null,
"login_id" bigint not null,
"username" text,
"status" text not null,
"requested_at" timestamp with time zone not null,
"activated_at" timestamp with time zone,
"disabled_at" timestamp with time zone,
"verified_by" uuid,
"verification_note" text,
"last_error" text,
"metadata" jsonb not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."nats_agent_commission_exports" ("id" uuid not null,
"agent_commission_event_id" uuid not null,
"agent_id" uuid not null,
"amount_cents" bigint not null,
"currency" text not null,
"status" text not null,
"attempt_count" integer not null,
"processing_started_at" timestamp with time zone,
"exported_at" timestamp with time zone,
"failed_at" timestamp with time zone,
"reconciled_at" timestamp with time zone,
"nats_result" text,
"last_error" text,
"response_metadata" jsonb not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."nats_commission_exports" ("id" uuid not null,
"commission_event_id" uuid not null,
"dancer_id" uuid not null,
"amount_cents" bigint not null,
"currency" text not null,
"status" text not null,
"attempt_count" integer not null,
"processing_started_at" timestamp with time zone,
"exported_at" timestamp with time zone,
"failed_at" timestamp with time zone,
"reconciled_at" timestamp with time zone,
"nats_result" text,
"last_error" text,
"response_metadata" jsonb not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."nfc_tags" ("id" uuid not null,
"venue_id" uuid not null,
"tag_type" text not null,
"label" text not null,
"token_digest" text not null,
"status" text not null,
"created_by_user_id" uuid,
"rotated_from_tag_id" uuid,
"last_tapped_at" timestamp with time zone,
"tap_count" bigint not null,
"disabled_at" timestamp with time zone,
"revoked_at" timestamp with time zone,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"scan_count" bigint not null,
"last_scanned_at" timestamp with time zone);
create table public."nfc_tap_events" ("id" uuid not null,
"nfc_tag_id" uuid not null,
"venue_id" uuid not null,
"tag_type" text not null,
"event_type" text not null,
"actor_user_id" uuid,
"session_id" uuid,
"ip_address" text,
"user_agent" text,
"device_fingerprint" text,
"audit" jsonb not null,
"occurred_at" timestamp with time zone not null);
create table public."notifications" ("id" uuid not null,
"recipient_id" uuid not null,
"notification_type" notification_type not null,
"channel" notification_channel not null,
"title" text not null,
"body" text not null,
"payload" jsonb not null,
"read_at" timestamp with time zone,
"sent_at" timestamp with time zone,
"created_at" timestamp with time zone not null);
create table public."payment_provider_webhook_events" ("provider_event_id" text not null,
"event_type" text not null,
"object_id" text,
"processed_at" timestamp with time zone,
"metadata" jsonb not null,
"id" uuid not null,
"payment_provider" text not null,
"processing_status" text not null,
"failure_reason" text,
"received_at" timestamp with time zone not null,
"processing_started_at" timestamp with time zone not null,
"attempt_count" integer not null);
create table public."payout_settings" ("id" text not null,
"payouts_enabled" boolean not null,
"payment_provider" text not null,
"earnings_hold_days" integer not null,
"minimum_payout_cents" integer not null,
"payout_mode" text not null,
"updated_by" uuid,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."profile_views" ("id" uuid not null,
"dancer_id" uuid not null,
"viewer_id" uuid,
"viewed_at" timestamp with time zone not null,
"source" text,
"session_id" text);
create table public."qr_redemption_events" ("id" uuid not null,
"qr_redemption_id" uuid not null,
"event_type" text not null,
"actor_user_id" uuid,
"session_id" text,
"ip_address" text,
"user_agent" text,
"audit" jsonb not null,
"occurred_at" timestamp with time zone not null);
create table public."qr_redemptions" ("id" uuid not null,
"redemption_token" text not null,
"venue_id" uuid not null,
"club_deal_id" uuid not null,
"source_type" text not null,
"dancer_id" uuid,
"customer_id" uuid,
"session_id" text,
"generated_at" timestamp with time zone not null,
"expires_at" timestamp with time zone not null,
"redeemed_at" timestamp with time zone,
"redeemed_by_club_user" uuid,
"status" text not null,
"ip_address" text,
"user_agent" text,
"device_fingerprint" text,
"audit" jsonb not null,
"suspicious" boolean not null,
"voided_at" timestamp with time zone,
"voided_by_admin" uuid,
"created_at" timestamp with time zone not null,
"shift_id" uuid,
"attribution_locked_at" timestamp with time zone,
"saved_at" timestamp with time zone,
"shared_at" timestamp with time zone,
"first_scanned_at" timestamp with time zone,
"confirmed_at" timestamp with time zone,
"nfc_tag_id" uuid);
create table public."ranking_events" ("id" uuid not null,
"dancer_id" uuid not null,
"city" text not null,
"event_type" text not null,
"old_rank" integer,
"new_rank" integer,
"message" text not null,
"notified_at" timestamp with time zone,
"created_at" timestamp with time zone not null);
create table public."request_rate_limit_buckets" ("namespace" text not null,
"key_type" text not null,
"key_hash" uuid not null,
"window_started_at" timestamp with time zone not null,
"request_count" integer not null,
"expires_at" timestamp with time zone not null);
create table public."sales_agents" ("id" uuid not null,
"user_id" uuid not null,
"sponsor_agent_id" uuid,
"status" text not null,
"commission_depth_limit" smallint not null,
"created_by_admin_user_id" uuid not null,
"updated_by_admin_user_id" uuid not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"referral_code" text not null);
create table public."schedule_views" ("id" uuid not null,
"dancer_id" uuid not null,
"shift_id" uuid,
"viewer_id" uuid,
"viewed_at" timestamp with time zone not null,
"session_id" text);
create table public."shift_location_events" ("id" uuid not null,
"shift_id" uuid not null,
"dancer_id" uuid not null,
"user_id" uuid not null,
"event_type" text not null,
"latitude" numeric(9,6) not null,
"longitude" numeric(9,6) not null,
"accuracy_meters" numeric(8,2) not null,
"captured_at" timestamp with time zone not null,
"distance_feet" numeric(9,2),
"accepted" boolean not null,
"reason_code" text,
"occurred_at" timestamp with time zone not null);
create table public."shifts" ("id" uuid not null,
"dancer_id" uuid not null,
"venue_id" uuid not null,
"starts_at" timestamp with time zone not null,
"ends_at" timestamp with time zone not null,
"timezone" text not null,
"status" shift_status not null,
"broadcast_sent_at" timestamp with time zone,
"broadcast_recipients" integer not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"location_status" text not null,
"checked_in_at" timestamp with time zone,
"checked_out_at" timestamp with time zone,
"checkin_latitude" numeric(9,6),
"checkin_longitude" numeric(9,6),
"checkin_distance_feet" numeric(8,2),
"checkin_accuracy_meters" numeric(8,2),
"checkin_captured_at" timestamp with time zone,
"last_location_latitude" numeric(9,6),
"last_location_longitude" numeric(9,6),
"last_location_accuracy_meters" numeric(8,2),
"last_location_captured_at" timestamp with time zone,
"last_location_verified_at" timestamp with time zone,
"location_verification_expires_at" timestamp with time zone,
"working_status" text not null,
"commission_tracking_started_at" timestamp with time zone,
"commission_tracking_stopped_at" timestamp with time zone,
"ended_at" timestamp with time zone,
"ended_reason" text,
"checkout_latitude" numeric(9,6),
"checkout_longitude" numeric(9,6),
"shift_summary" jsonb not null,
"venue_affiliation_id" uuid,
"shift_date" date not null,
"shift_source" text not null,
"nfc_tag_id" uuid,
"nfc_last_tapped_at" timestamp with time zone);
create table public."social_clicks" ("id" uuid not null,
"dancer_id" uuid not null,
"platform" social_platform not null,
"clicker_id" uuid,
"clicked_at" timestamp with time zone not null,
"session_id" text);
create table public."social_links" ("id" uuid not null,
"dancer_id" uuid not null,
"platform" social_platform not null,
"handle" text not null,
"url" text not null,
"is_active" boolean not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."subscriptions" ("id" uuid not null,
"dancer_id" uuid not null,
"stripe_customer_id" text,
"stripe_subscription_id" text,
"stripe_price_id" text,
"status" text not null,
"current_period_end" timestamp with time zone,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."support_ai_runs" ("id" uuid not null,
"thread_id" uuid not null,
"trigger_message_id" uuid,
"response_message_id" uuid,
"provider_response_id" text,
"model" text not null,
"outcome" text not null,
"escalation_category" text,
"escalation_priority" text,
"escalation_reason" text,
"confidence" numeric,
"moderation" jsonb not null,
"error_code" text,
"created_at" timestamp with time zone not null);
create table public."support_messages" ("id" uuid not null,
"thread_id" uuid not null,
"sender_id" uuid,
"sender_role" user_role not null,
"body" text not null,
"read_at" timestamp with time zone,
"created_at" timestamp with time zone not null,
"sender_kind" text not null,
"metadata" jsonb not null);
create table public."support_threads" ("id" uuid not null,
"user_id" uuid not null,
"user_role" user_role not null,
"subject" text not null,
"status" text not null,
"last_message_at" timestamp with time zone not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"escalation_status" text not null,
"escalation_category" text,
"escalation_reason" text,
"escalation_priority" text,
"escalated_at" timestamp with time zone,
"assigned_admin_id" uuid,
"ai_reply_count" integer not null,
"last_ai_response_id" text,
"last_ai_replied_at" timestamp with time zone);
create table public."trending_scores" ("dancer_id" uuid not null,
"city" text not null,
"score" numeric(12,2) not null,
"rank" integer,
"previous_rank" integer,
"highest_rank" integer,
"best_rank_this_week" integer,
"trend" text not null,
"calculated_at" timestamp with time zone not null);
create table public."venue_activity_log" ("id" uuid not null,
"venue_id" uuid not null,
"actor_user_id" uuid,
"actor_role" text not null,
"action" text not null,
"target_type" text,
"target_id" text,
"summary" text not null,
"metadata" jsonb not null,
"created_at" timestamp with time zone not null);
create table public."venue_claim_codes" ("id" uuid not null,
"venue_id" uuid not null,
"code_digest" text not null,
"created_by" uuid,
"created_at" timestamp with time zone not null,
"expires_at" timestamp with time zone not null,
"used_at" timestamp with time zone,
"used_by" uuid,
"revoked_at" timestamp with time zone,
"revoked_by" uuid);
create table public."venue_club_deal_requests" ("id" uuid not null,
"venue_id" uuid not null,
"requested_by_user_id" uuid,
"offer_key" text not null,
"offer_title" text not null,
"request_notes" text,
"status" text not null,
"linked_deal_id" uuid,
"reviewed_by_admin_user_id" uuid,
"reviewed_at" timestamp with time zone,
"decision_note" text,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"request_type" text not null,
"target_deal_id" uuid);
create table public."venue_dancer_affiliation_events" ("id" uuid not null,
"affiliation_id" uuid,
"venue_id" uuid not null,
"dancer_id" uuid not null,
"actor_user_id" uuid,
"event_type" text not null,
"event_payload" jsonb not null,
"occurred_at" timestamp with time zone not null);
create table public."venue_dancer_affiliations" ("id" uuid not null,
"venue_id" uuid not null,
"dancer_id" uuid not null,
"status" text not null,
"approved_by_user_id" uuid,
"approved_at" timestamp with time zone not null,
"revoked_by_user_id" uuid,
"revoked_at" timestamp with time zone,
"revoke_reason" text,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."venue_dancer_verification_tokens" ("id" uuid not null,
"venue_id" uuid not null,
"dancer_id" uuid not null,
"created_by_user_id" uuid not null,
"token_digest" text not null,
"request_ip_hash" text not null,
"created_at" timestamp with time zone not null,
"expires_at" timestamp with time zone not null,
"used_at" timestamp with time zone,
"used_by_user_id" uuid,
"revoked_at" timestamp with time zone);
create table public."venue_follows" ("customer_id" uuid not null,
"venue_id" uuid not null,
"notifications_enabled" boolean not null,
"created_at" timestamp with time zone not null);
create table public."venue_nfc_support_requests" ("id" uuid not null,
"venue_id" uuid not null,
"nfc_tag_id" uuid,
"requested_by_user_id" uuid,
"request_type" text not null,
"notes" text,
"status" text not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"resolved_at" timestamp with time zone);
create table public."venue_ownership_claims" ("id" uuid not null,
"venue_id" uuid not null,
"claimant_user_id" uuid not null,
"claimant_email" text not null,
"claimant_name" text not null,
"claimant_title" text not null,
"claimant_phone" text not null,
"proof_storage_path" text,
"proof_file_name" text not null,
"proof_mime_type" text not null,
"request_ip_hash" text not null,
"status" text not null,
"review_notes" text,
"reviewed_by" uuid,
"submitted_at" timestamp with time zone not null,
"reviewed_at" timestamp with time zone,
"proof_cleared_at" timestamp with time zone,
"updated_at" timestamp with time zone not null,
"claim_code_id" uuid);
create table public."venue_page_events" ("id" uuid not null,
"venue_id" uuid not null,
"dancer_id" uuid,
"viewer_id" uuid,
"event_type" text not null,
"source" text not null,
"session_id" text not null,
"occurred_on" date not null,
"occurred_at" timestamp with time zone not null);
create table public."venue_pilot_night_reports" ("id" uuid not null,
"venue_id" uuid not null,
"service_date" date not null,
"total_door_count" integer not null,
"pilot_cost_cents" integer not null,
"notes" text,
"reported_by_user_id" uuid,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."venue_referral_fee_change_requests" ("id" uuid not null,
"venue_id" uuid not null,
"requested_fee_cents" integer not null,
"currency" text not null,
"reason" text not null,
"status" text not null,
"requested_by_user_id" uuid not null,
"reviewed_by_admin_user_id" uuid,
"reviewed_at" timestamp with time zone,
"decision_note" text,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."venue_referral_fee_terms" ("id" uuid not null,
"venue_id" uuid not null,
"fee_cents" integer not null,
"currency" text not null,
"effective_from" timestamp with time zone not null,
"effective_until" timestamp with time zone,
"agreement_reference" text not null,
"decision_note" text,
"created_by_admin_user_id" uuid,
"superseded_at" timestamp with time zone,
"superseded_by_admin_user_id" uuid,
"created_at" timestamp with time zone not null);
create table public."venue_sales_attributions" ("id" uuid not null,
"venue_id" uuid not null,
"signing_agent_id" uuid not null,
"sponsor_level_1_agent_id" uuid,
"sponsor_level_2_agent_id" uuid,
"sponsor_level_3_agent_id" uuid,
"sponsor_level_4_agent_id" uuid,
"sponsor_level_5_agent_id" uuid,
"agreement_reference" text not null,
"effective_from" timestamp with time zone not null,
"superseded_at" timestamp with time zone,
"created_by_admin_user_id" uuid not null,
"created_at" timestamp with time zone not null);
create table public."venue_signup_requests" ("id" uuid not null,
"venue_name" text not null,
"street_address" text not null,
"city" text not null,
"state" text not null,
"postal_code" text not null,
"website" text,
"contact_name" text not null,
"contact_title" text not null,
"contact_email" text not null,
"contact_phone" text not null,
"message" text,
"request_ip_hash" text not null,
"status" text not null,
"matched_venue_id" uuid,
"access_code_id" uuid,
"reviewed_by" uuid,
"review_notes" text,
"submitted_at" timestamp with time zone not null,
"reviewed_at" timestamp with time zone,
"updated_at" timestamp with time zone not null,
"referring_agent_id" uuid,
"requester_user_id" uuid,
"login_email" text);
create table public."venue_team_invitations" ("id" uuid not null,
"venue_id" uuid not null,
"email" text not null,
"role" text not null,
"token_digest" text not null,
"invited_by_user_id" uuid,
"expires_at" timestamp with time zone not null,
"accepted_at" timestamp with time zone,
"accepted_by_user_id" uuid,
"revoked_at" timestamp with time zone,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null);
create table public."venue_team_members" ("id" uuid not null,
"venue_id" uuid not null,
"user_id" uuid not null,
"role" text not null,
"status" text not null,
"invited_by_user_id" uuid,
"joined_at" timestamp with time zone not null,
"removed_at" timestamp with time zone,
"updated_at" timestamp with time zone not null);
create table public."venues" ("id" uuid not null,
"name" text not null,
"slug" text not null,
"city" text not null,
"state" text,
"address" text,
"phone" text,
"website" text,
"timezone" text not null,
"opens_at" time without time zone,
"closes_at" time without time zone,
"is_active" boolean not null,
"created_at" timestamp with time zone not null,
"updated_at" timestamp with time zone not null,
"latitude" numeric(9,6),
"longitude" numeric(9,6),
"owner_user_id" uuid,
"qr_code_storage_path" text,
"qr_code_label" text,
"qr_code_updated_at" timestamp with time zone,
"cover_image_storage_path" text,
"cover_image_updated_at" timestamp with time zone,
"published_at" timestamp with time zone,
"logo_storage_path" text,
"logo_updated_at" timestamp with time zone,
"page_review_status" text not null,
"page_review_sent_at" timestamp with time zone,
"page_reviewed_at" timestamp with time zone,
"page_reviewed_by_user_id" uuid,
"page_review_notes" text);
CREATE OR REPLACE FUNCTION public.activate_approved_venue_request_manager()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_owner uuid;
begin
  if new.login_email is null or new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  perform 1 from public.app_users where id = new.requester_user_id for update;
  if new.requester_user_id is null or not exists (
    select 1 from public.app_users account
    join auth.users auth_user on auth_user.id = account.id
    where account.id = new.requester_user_id
      and account.role = 'venue' and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'The request manager account is unavailable. Contact support before approving.';
  end if;

  -- The review RPC holds the request lock. Lock the manager and venue too,
  -- so ownership and code consumption either both succeed or both roll back.
  select owner_user_id into v_owner from public.venues where id = new.matched_venue_id for update;
  if not found or (v_owner is not null and v_owner <> new.requester_user_id) then
    raise exception using errcode = '42501', message = 'The approved venue cannot be assigned to this manager.';
  end if;
  if exists (select 1 from public.venues where owner_user_id = new.requester_user_id and id <> new.matched_venue_id)
    or exists (select 1 from public.venue_team_members where user_id = new.requester_user_id and status = 'active') then
    raise exception using errcode = '42501', message = 'This manager already has venue access.';
  end if;

  update public.venues set owner_user_id = new.requester_user_id, updated_at = now()
    where id = new.matched_venue_id;
  update public.venue_claim_codes set used_at = now(), used_by = new.requester_user_id
    where id = new.access_code_id and venue_id = new.matched_venue_id and used_at is null and revoked_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'The approval access credential is unavailable.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.activate_dancer_shift_from_nfc(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tag public.nfc_tags;
  v_venue public.venues;
  v_dancer public.dancer_profiles;
  v_affiliation public.venue_dancer_affiliations;
  v_shift public.shifts;
  v_previous public.shifts;
  v_current_venue_name text;
  v_current_venue_slug text;
  v_now timestamptz := clock_timestamp();
  v_working_until timestamptz := clock_timestamp() + interval '6 hours';
  v_next_tap_allowed_at timestamptz;
  v_local_date date;
begin
  select tag.* into v_tag
  from public.nfc_tags tag
  where tag.id = p_tag_id
    and tag.status = 'active'
    and tag.tag_type = 'dressing_room'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'This dressing-room NFC tag is inactive.';
  end if;

  select venue.* into v_venue
  from public.venues venue
  join public.app_users owner on owner.id = venue.owner_user_id
  where venue.id = v_tag.venue_id
    and venue.is_active = true
    and owner.role = 'venue'
    and owner.account_state = 'active'
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'This venue is not active.';
  end if;

  select dancer.* into v_dancer
  from public.dancer_profiles dancer
  join public.app_users account on account.id = dancer.user_id
  where dancer.user_id = p_dancer_user_id
    and account.role = 'dancer'
    and account.account_state = 'active'
    and dancer.status = 'approved'
    and dancer.verification_status = 'approved'
    and dancer.is_public = true
    and dancer.disabled_at is null
  for update of dancer;
  if not found then
    raise exception using errcode = '42501', message = 'Complete profile setup before tapping to go Working Now.';
  end if;

  select affiliation.* into v_affiliation
  from public.venue_dancer_affiliations affiliation
  where affiliation.venue_id = v_venue.id
    and affiliation.dancer_id = v_dancer.id
    and affiliation.status = 'active'
    and affiliation.revoked_at is null
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'An active venue affiliation is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_dancer.id::text), 781236);
  v_local_date := timezone(coalesce(nullif(v_venue.timezone, ''), 'UTC'), v_now)::date;

  update public.shifts
  set checked_out_at = coalesce(checked_out_at, location_verification_expires_at, v_now),
      location_verification_expires_at = least(coalesce(location_verification_expires_at, v_now), v_now),
      working_status = 'ended',
      commission_tracking_stopped_at = coalesce(commission_tracking_stopped_at, location_verification_expires_at, v_now),
      ended_at = coalesce(ended_at, location_verification_expires_at, v_now),
      ended_reason = coalesce(ended_reason, 'nfc_window_expired'),
      updated_at = v_now
  where dancer_id = v_dancer.id
    and checked_in_at is not null
    and checked_out_at is null
    and location_verification_expires_at <= v_now;

  select shift.* into v_previous
  from public.shifts shift
  where shift.dancer_id = v_dancer.id
    and shift.status = 'posted'
    and shift.checked_in_at is not null
    and shift.checked_out_at is null
    and shift.location_status = 'club_confirmed'
    and shift.location_verification_expires_at > v_now
  order by shift.checked_in_at desc
  limit 1
  for update;

  if found then
    v_next_tap_allowed_at := coalesce(v_previous.nfc_last_tapped_at, v_previous.checked_in_at) + interval '12 hours';
    select venue.name, venue.slug into v_current_venue_name, v_current_venue_slug
    from public.venues venue
    where venue.id = v_previous.venue_id;
    insert into public.nfc_tap_events (
      nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
      ip_address, user_agent, device_fingerprint, audit
    ) values (
      v_tag.id, v_venue.id, v_tag.tag_type, 'opened', p_dancer_user_id, p_session_id,
      p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
      p_audit || jsonb_build_object(
        'dancerId', v_dancer.id,
        'shiftId', v_previous.id,
        'tapApplied', false,
        'reason', 'active_window_not_extendable',
        'workingUntil', v_previous.location_verification_expires_at,
        'nextTapAllowedAt', v_next_tap_allowed_at,
        'method', 'dressing_room_nfc'
      )
    );
    return jsonb_build_object(
      'shiftCheckedIn', true,
      'tapApplied', false,
      'alreadyWorking', true,
      'cooldownActive', false,
      'shiftId', v_previous.id,
      'workingUntil', v_previous.location_verification_expires_at,
      'nextTapAllowedAt', v_next_tap_allowed_at,
      'venueId', v_previous.venue_id,
      'venueName', coalesce(v_current_venue_name, v_venue.name),
      'venueSlug', coalesce(v_current_venue_slug, v_venue.slug),
      'extended', false,
      'switchedVenue', false
    );
  end if;

  select shift.* into v_previous
  from public.shifts shift
  where shift.dancer_id = v_dancer.id
    and shift.nfc_last_tapped_at is not null
    and shift.nfc_last_tapped_at + interval '12 hours' > v_now
  order by shift.nfc_last_tapped_at desc
  limit 1
  for update;

  if found then
    v_next_tap_allowed_at := v_previous.nfc_last_tapped_at + interval '12 hours';
    select venue.name, venue.slug into v_current_venue_name, v_current_venue_slug
    from public.venues venue
    where venue.id = v_previous.venue_id;
    insert into public.nfc_tap_events (
      nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
      ip_address, user_agent, device_fingerprint, audit
    ) values (
      v_tag.id, v_venue.id, v_tag.tag_type, 'opened', p_dancer_user_id, p_session_id,
      p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
      p_audit || jsonb_build_object(
        'dancerId', v_dancer.id,
        'shiftId', v_previous.id,
        'tapApplied', false,
        'reason', 'nfc_cooldown_active',
        'nextTapAllowedAt', v_next_tap_allowed_at,
        'method', 'dressing_room_nfc'
      )
    );
    return jsonb_build_object(
      'shiftCheckedIn', false,
      'tapApplied', false,
      'alreadyWorking', false,
      'cooldownActive', true,
      'shiftId', v_previous.id,
      'workingUntil', v_previous.location_verification_expires_at,
      'nextTapAllowedAt', v_next_tap_allowed_at,
      'venueId', v_previous.venue_id,
      'venueName', coalesce(v_current_venue_name, v_venue.name),
      'venueSlug', coalesce(v_current_venue_slug, v_venue.slug),
      'extended', false,
      'switchedVenue', false
    );
  end if;

  select shift.* into v_shift
    from public.shifts shift
    where shift.dancer_id = v_dancer.id
      and shift.venue_id = v_venue.id
      and shift.status = 'posted'
      and shift.shift_source = 'scheduled'
      and shift.shift_date = v_local_date
      and shift.checked_in_at is null
      and shift.checked_out_at is null
    order by shift.created_at desc
    limit 1
    for update;

  if found then
    update public.shifts
      set starts_at = v_now,
          ends_at = v_working_until,
          checked_in_at = v_now,
          checked_out_at = null,
          location_status = 'club_confirmed',
          last_location_verified_at = v_now,
          location_verification_expires_at = v_working_until,
          working_status = 'club_confirmed',
          commission_tracking_started_at = v_now,
          commission_tracking_stopped_at = null,
          ended_at = null,
          ended_reason = null,
          venue_affiliation_id = v_affiliation.id,
          nfc_tag_id = v_tag.id,
          nfc_last_tapped_at = v_now,
          updated_at = v_now
      where id = v_shift.id
    returning * into v_shift;
  else
    insert into public.shifts (
        dancer_id, venue_id, starts_at, ends_at, timezone, status,
        shift_date, shift_source, checked_in_at, location_status,
        last_location_verified_at, location_verification_expires_at,
        working_status, commission_tracking_started_at, venue_affiliation_id,
        nfc_tag_id, nfc_last_tapped_at
      ) values (
        v_dancer.id, v_venue.id, v_now, v_working_until,
        coalesce(nullif(v_venue.timezone, ''), 'UTC'), 'posted',
        v_local_date, 'nfc_presence', v_now, 'club_confirmed',
        v_now, v_working_until, 'club_confirmed', v_now, v_affiliation.id,
        v_tag.id, v_now
    ) returning * into v_shift;
  end if;

  v_next_tap_allowed_at := v_now + interval '12 hours';

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_venue.id, v_tag.tag_type, 'shift_checked_in', p_dancer_user_id, p_session_id,
    p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object(
      'dancerId', v_dancer.id,
      'shiftId', v_shift.id,
      'workingUntil', v_working_until,
      'nextTapAllowedAt', v_next_tap_allowed_at,
      'tapApplied', true,
      'method', 'dressing_room_nfc'
    )
  );

  return jsonb_build_object(
    'shiftCheckedIn', true,
    'tapApplied', true,
    'alreadyWorking', false,
    'cooldownActive', false,
    'shiftId', v_shift.id,
    'workingUntil', v_working_until,
    'nextTapAllowedAt', v_next_tap_allowed_at,
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug,
    'extended', false,
    'switchedVenue', false
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.activate_waiting_nats_agent_exports()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := clock_timestamp();
  if new.status = 'active' and old.status is distinct from 'active' then
    update public.nats_agent_commission_exports export
    set status = 'pending', updated_at = clock_timestamp(), last_error = null, failed_at = null
    where export.agent_id = new.agent_id
      and export.status = 'waiting_for_affiliate'
      and exists (
        select 1 from public.agent_commission_events earning
        where earning.id = export.agent_commission_event_id and earning.status = 'payable'
      );
  elsif new.status = 'disabled' and old.status is distinct from 'disabled' then
    new.disabled_at := coalesce(new.disabled_at, clock_timestamp());
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.activate_waiting_nats_exports()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtext(new.dancer_id::text), hashtext('nats-dancer-enrollment'));
  new.updated_at := clock_timestamp();
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.activated_at := clock_timestamp();
    new.disabled_at := null;
    -- Other, non-Club-Deal earning types keep their existing settlement behavior.
    update public.nats_commission_exports export
    set status = 'pending', updated_at = clock_timestamp(), last_error = null, failed_at = null
    where export.dancer_id = new.dancer_id and export.status = 'waiting_for_affiliate'
      and exists (
        select 1 from public.commission_events earning
        where earning.id = export.commission_event_id and earning.qr_redemption_id is null
          and earning.status = 'available' and not earning.is_test
          and earning.held_at is null and earning.review_flag is null
      );
  elsif tg_op = 'UPDATE' then
    new.activated_at := old.activated_at;
    if new.status = 'disabled' and old.status is distinct from 'disabled' then
      new.disabled_at := clock_timestamp();
    end if;
  else
    new.activated_at := null;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_manage_dancer_earning(p_admin_user_id uuid, p_earning_id uuid, p_action text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_before public.commission_events%rowtype; v_after public.commission_events%rowtype;
begin
  if not exists (select 1 from public.app_users where id = p_admin_user_id and role = 'admin' and account_state = 'active') then
    raise exception using errcode = '42501', message = 'Active admin access required.';
  end if;
  if p_action not in ('hold', 'release', 'reverse') then
    raise exception using errcode = '22023', message = 'Unsupported earning action.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A reason is required.';
  end if;
  select * into v_before from public.commission_events where id = p_earning_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Earning not found.'; end if;
  if p_action = 'hold' then
    if v_before.status not in ('pending', 'available') then raise exception using errcode = '22023', message = 'This earning cannot be held.'; end if;
    update public.commission_events set held_at = now(), hold_reason = trim(p_reason) where id = p_earning_id returning * into v_after;
  elsif p_action = 'release' then
    if v_before.status not in ('pending', 'available', 'failed') then raise exception using errcode = '22023', message = 'This earning cannot be released.'; end if;
    update public.commission_events set held_at = null, hold_reason = null, review_flag = null,
      status = case when pending_until <= now() then 'available' else 'pending' end
    where id = p_earning_id returning * into v_after;
  else
    if v_before.status not in ('pending', 'available', 'failed') then
      raise exception using errcode = '22023', message = 'Paid or processing earnings require an approved recovery process.';
    end if;
    update public.commission_events set status = 'reversed', reversed_at = now(), reversal_reason = trim(p_reason),
      held_at = null, hold_reason = null where id = p_earning_id returning * into v_after;
  end if;
  insert into public.financial_audit_events (actor_user_id, actor_type, action, target_type, target_id, reason, before_state, after_state)
  values (p_admin_user_id, 'admin', p_action || '_earning', 'earning', p_earning_id::text, trim(p_reason), to_jsonb(v_before), to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_retry_dancer_payout(p_admin_user_id uuid, p_failed_payout_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old public.dancer_payout_batches%rowtype;
  v_new_id uuid;
  v_count integer;
  v_amount bigint;
begin
  if not exists (select 1 from public.app_users where id = p_admin_user_id and role = 'admin' and account_state = 'active') then
    raise exception using errcode = '42501', message = 'Active admin access required.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A retry reason is required.';
  end if;
  select * into v_old from public.dancer_payout_batches where id = p_failed_payout_id for update;
  if not found or v_old.status <> 'failed' then
    raise exception using errcode = '22023', message = 'Only a failed payout can be retried.';
  end if;
  perform 1 from public.dancer_payout_batches
    where dancer_id = v_old.dancer_id and currency = v_old.currency and status in ('requested', 'processing') for update;
  if found then raise exception using errcode = '23505', message = 'A payout request is already active.'; end if;
  with locked_earnings as (
    select earning.id, earning.amount_cents
    from public.dancer_payout_items old_item
    join public.commission_events earning on earning.id = old_item.commission_event_id
    where old_item.payout_batch_id = p_failed_payout_id
      and earning.status = 'available' and earning.payout_batch_id is null
      and earning.held_at is null and earning.review_flag is null
    order by earning.created_at, earning.id for update of earning
  )
  select count(*)::integer, coalesce(sum(amount_cents), 0)::bigint into v_count, v_amount from locked_earnings;
  if v_count = 0 or v_amount <> v_old.amount_cents then
    raise exception using errcode = '22023', message = 'The original earnings are not all eligible for a safe retry.';
  end if;
  insert into public.dancer_payout_batches (dancer_id, status, currency, amount_cents, payment_provider, request_key, requested_at, metadata)
  values (v_old.dancer_id, 'requested', v_old.currency, v_old.amount_cents, v_old.payment_provider,
    'retry:' || p_failed_payout_id::text || ':' || gen_random_uuid()::text, now(),
    jsonb_build_object('retry_of', p_failed_payout_id, 'retry_reason', trim(p_reason))) returning id into v_new_id;
  insert into public.dancer_payout_items (payout_batch_id, commission_event_id, amount_cents)
  select v_new_id, earning.id, earning.amount_cents
  from public.dancer_payout_items old_item join public.commission_events earning on earning.id = old_item.commission_event_id
  where old_item.payout_batch_id = p_failed_payout_id and earning.status = 'available' and earning.payout_batch_id is null;
  update public.commission_events set status = 'payout_processing', payout_batch_id = v_new_id,
    payment_provider = v_old.payment_provider
  where id in (select commission_event_id from public.dancer_payout_items where payout_batch_id = v_new_id);
  insert into public.financial_audit_events (actor_user_id, actor_type, action, target_type, target_id, reason, after_state)
  values (p_admin_user_id, 'admin', 'retry_failed_payout', 'payout', v_new_id::text, trim(p_reason),
    jsonb_build_object('status', 'requested', 'retry_of', p_failed_payout_id, 'amount_cents', v_old.amount_cents));
  return jsonb_build_object('id', v_new_id, 'status', 'requested', 'retry_of', p_failed_payout_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_update_payout_settings(p_admin_user_id uuid, p_payouts_enabled boolean, p_payment_provider text, p_earnings_hold_days integer, p_minimum_payout_cents integer, p_payout_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_before public.payout_settings%rowtype; v_after public.payout_settings%rowtype;
begin
  if not exists (select 1 from public.app_users where id = p_admin_user_id and role = 'admin' and account_state = 'active') then
    raise exception using errcode = '42501', message = 'Active admin access required.';
  end if;
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other') or p_payout_mode not in ('manual_cashout', 'scheduled', 'both')
    or p_earnings_hold_days not between 0 and 90 or p_minimum_payout_cents not between 1 and 10000000
  then
    raise exception using errcode = '22023', message = 'Invalid payout settings.';
  end if;
  select * into v_before from public.payout_settings where id = 'default' for update;
  update public.payout_settings set payouts_enabled = p_payouts_enabled,
    payment_provider = p_payment_provider, earnings_hold_days = p_earnings_hold_days,
    minimum_payout_cents = p_minimum_payout_cents, payout_mode = p_payout_mode,
    updated_by = p_admin_user_id, updated_at = now()
  where id = 'default' returning * into v_after;
  insert into public.financial_audit_events (actor_user_id, actor_type, action, target_type, target_id, before_state, after_state)
  values (p_admin_user_id, 'admin', 'update_payout_settings', 'settings', 'default', to_jsonb(v_before), to_jsonb(v_after));
  return to_jsonb(v_after);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.advance_avatar_review_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_level<>'ROW' or tg_when<>'BEFORE' or tg_op<>'UPDATE'
    or tg_relid<>'public.image_moderation_records'::regclass then
    raise exception 'INVALID_AVATAR_REVIEW_TRIGGER' using errcode='42501';
  end if;
  if old.upload_context='profile_avatar' or new.upload_context='profile_avatar' then
    if old.updated_at is null or not isfinite(old.updated_at) then
      raise exception 'AVATAR_REVIEW_VERSION_UNAVAILABLE' using errcode='40001';
    end if;
    new.updated_at:=greatest(pg_catalog.clock_timestamp(),old.updated_at+interval '1 microsecond');
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.advance_dancer_avatar_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_level<>'ROW' or tg_when<>'BEFORE' or tg_op<>'UPDATE'
    or tg_relid<>'public.dancer_profiles'::regclass then
    raise exception 'INVALID_AVATAR_VERSION_TRIGGER' using errcode='42501';
  end if;
  if old.avatar_updated_at is not null and not isfinite(old.avatar_updated_at) then
    raise exception 'AVATAR_VERSION_UNAVAILABLE' using errcode='40001';
  end if;
  new.avatar_updated_at:=greatest(pg_catalog.clock_timestamp(),old.avatar_updated_at+interval '1 microsecond');
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.agent_allocations_for_venue(p_venue_id uuid, p_gross_cents integer, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(venue_sales_attribution_id uuid, signing_agent_id uuid, recipient_agent_id uuid, sponsor_level smallint, share_bps integer, amount_cents integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with attribution as (
    select * from public.venue_sales_attributions attribution
    where attribution.venue_id = p_venue_id
      and attribution.effective_from <= p_at
      and (attribution.superseded_at is null or attribution.superseded_at > p_at)
    order by attribution.effective_from desc limit 1
  ), candidates as (
    select attribution.id, attribution.signing_agent_id, levels.recipient_agent_id,
      levels.sponsor_level, levels.share_bps
    from attribution cross join lateral (
      values
        (attribution.signing_agent_id, 0::smallint, 1500),
        (attribution.sponsor_level_1_agent_id, 1::smallint, 300),
        (attribution.sponsor_level_2_agent_id, 2::smallint, 250),
        (attribution.sponsor_level_3_agent_id, 3::smallint, 200),
        (attribution.sponsor_level_4_agent_id, 4::smallint, 150),
        (attribution.sponsor_level_5_agent_id, 5::smallint, 100)
    ) levels(recipient_agent_id, sponsor_level, share_bps)
    where levels.recipient_agent_id is not null
  )
  select candidates.id, candidates.signing_agent_id, candidates.recipient_agent_id,
    candidates.sponsor_level, candidates.share_bps,
    round(greatest(p_gross_cents, 0) * candidates.share_bps / 10000.0)::integer
  from candidates
  join public.sales_agents recipient on recipient.id = candidates.recipient_agent_id
  where recipient.status = 'active'
    and (candidates.sponsor_level <= 3 or recipient.commission_depth_limit = 5)
    and round(greatest(p_gross_cents, 0) * candidates.share_bps / 10000.0)::integer > 0;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_club_invoice_payment(p_invoice_id uuid, p_total_paid_cents integer, p_payment_reference text, p_paid_at timestamp with time zone DEFAULT now(), p_stripe_invoice_id text DEFAULT NULL::text, p_hosted_invoice_url text DEFAULT NULL::text, p_invoice_pdf_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice public.club_invoices%rowtype;
  v_paid integer;
begin
  if length(trim(coalesce(p_payment_reference, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A valid payment reference is required.';
  end if;
  select invoice.* into v_invoice from public.club_invoices invoice
  where invoice.id = p_invoice_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Club invoice not found.';
  end if;
  if v_invoice.status in ('void', 'uncollectible') then
    raise exception using errcode = '22023', message = 'This invoice cannot accept payment.';
  end if;

  v_paid := least(v_invoice.amount_due_cents,
    greatest(v_invoice.amount_paid_cents, p_total_paid_cents));
  update public.club_invoices
  set amount_paid_cents = v_paid,
      status = case when v_paid >= amount_due_cents then 'paid' else 'open' end,
      external_payment_reference = trim(p_payment_reference),
      paid_at = case when v_paid >= amount_due_cents then p_paid_at else paid_at end,
      stripe_invoice_id = coalesce(p_stripe_invoice_id, stripe_invoice_id),
      hosted_invoice_url = coalesce(p_hosted_invoice_url, hosted_invoice_url),
      invoice_pdf_url = coalesce(p_invoice_pdf_url, invoice_pdf_url),
      last_error = null, updated_at = now()
  where id = p_invoice_id;

  if v_paid >= v_invoice.amount_due_cents then
    update public.deal_revenue_events revenue
    set status = 'settled', venue_payment_reference = trim(p_payment_reference),
        venue_payment_received_at = p_paid_at,
        audit = coalesce(revenue.audit, '{}'::jsonb) || jsonb_build_object(
          'club_invoice_id', p_invoice_id, 'dancer_payout_dependency', false,
          'agent_payout_dependency_released', true
        )
    where revenue.club_invoice_id = p_invoice_id
      and revenue.status = 'pending_venue_payment';

    update public.agent_commission_events commission
    set status = 'payable', venue_payment_received_at = p_paid_at, payable_at = p_paid_at,
        audit = commission.audit || jsonb_build_object(
          'club_invoice_id', p_invoice_id,
          'venue_payment_reference', trim(p_payment_reference)
        )
    where commission.deal_revenue_event_id in (
      select revenue.id from public.deal_revenue_events revenue
      where revenue.club_invoice_id = p_invoice_id
    ) and commission.status = 'pending_venue_payment';
  end if;
  return jsonb_build_object('id', p_invoice_id, 'amount_paid_cents', v_paid,
    'status', case when v_paid >= v_invoice.amount_due_cents then 'paid' else 'open' end);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_dmca_takedown(p_case_id uuid, p_admin_id uuid, p_admin_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_case public.dmca_cases%rowtype;
  v_video public.mydancr_tv_videos%rowtype;
  v_strike_count integer;
  v_account_state text;
  v_dancer_status text;
  v_now timestamptz := now();
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_item public.mydancr_tv_videos%rowtype;
  v_before jsonb;
  v_applied jsonb;
  v_affected integer;
  v_uploader uuid;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'DMCA_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_case_id is null or p_admin_id is null then
    raise exception 'INVALID_DMCA_ACTION_IDENTITY' using errcode='22023';
  end if;
  if length(coalesce(p_admin_notes,''))>4000 then
    raise exception 'INVALID_DMCA_ACTION_NOTES' using errcode='22023';
  end if;
  if not exists(select 1 from public.app_users where id=p_admin_id and role='admin' and account_state='active') then
    raise exception 'DMCA_ADMIN_REQUIRED' using errcode='42501';
  end if;
  select * into v_case
  from public.dmca_cases
  where id = p_case_id
  for update;

  if v_case.id is null then
    raise exception 'DMCA case not found.';
  end if;

  if v_case.status not in ('submitted', 'needs_information') then
    raise exception 'This DMCA notice cannot be removed from its current state.';
  end if;

  if v_case.target_type <> 'tv_video' or v_case.target_id is null then
    raise exception 'The reported MyDancr video could not be identified.';
  end if;

  select submitted_by into v_uploader from public.mydancr_tv_videos where id=v_case.target_id;
  select * into v_account from public.app_users where id=v_uploader for update;
  select * into v_profile from public.dancer_profiles where user_id=v_uploader for update;
  -- Every case for this uploader shares the account lock. Lock all videos in a
  -- stable order before count/enforcement writes; independent edits hold these
  -- same source rows before invalidating their enforcement snapshot.
  perform 1 from public.mydancr_tv_videos where submitted_by=v_uploader order by id for update;
  select * into v_video from public.mydancr_tv_videos where id=v_case.target_id for update;
  if v_video.id is not null and (v_video.submitted_by is distinct from v_uploader
    or v_account.id is null or v_profile.id is null or v_video.dancer_id<>v_profile.id
    or (v_case.uploader_id is not null and v_case.uploader_id is distinct from v_uploader)) then
    raise exception 'DMCA_TARGET_OWNERSHIP_CHANGED' using errcode='40001';
  end if;

  if v_video.id is null then
    raise exception 'The reported MyDancr video no longer exists.';
  end if;

  select previous_state into v_before from public.dmca_enforcement_states
    where target_type='tv_video' and target_id=v_video.id and uploader_id=v_uploader and restore_allowed
      and applied_state=jsonb_build_object('status',v_video.status,'published_at',v_video.published_at,'review_notes',v_video.review_notes);
  if not found then
    v_before:=jsonb_build_object('status',v_video.status,'published_at',v_video.published_at,'review_notes',v_video.review_notes);
  end if;
  update public.mydancr_tv_videos
  set
    status = 'hidden',
    published_at = null,
    review_notes = 'Disabled after a validated copyright notice.',
    updated_at = v_now
  where id = v_video.id;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_VIDEO_WRITE_UNCONFIRMED' using errcode='40001';end if;
  select jsonb_build_object('status',status,'published_at',published_at,'review_notes',review_notes)into v_applied
    from public.mydancr_tv_videos where id=v_video.id;
  insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state,enforced_at)
    values('tv_video',v_video.id,v_uploader,v_before,v_applied,v_now)
    on conflict(target_type,target_id)do update set uploader_id=excluded.uploader_id,previous_state=excluded.previous_state,
      applied_state=excluded.applied_state,restore_allowed=true,enforced_at=excluded.enforced_at,invalidated_at=null;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_SNAPSHOT_WRITE_UNCONFIRMED' using errcode='40001';end if;

  insert into public.dmca_strikes (case_id, user_id, active, issued_at)
  values (v_case.id, v_video.submitted_by, true, v_now)
  on conflict (case_id) do update
  set active = true, rescinded_at = null, rescinded_reason = null
  where dmca_strikes.user_id=excluded.user_id;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_STRIKE_WRITE_UNCONFIRMED' using errcode='40001';end if;

  select count(*) into v_strike_count
  from public.dmca_strikes
  where user_id = v_video.submitted_by and active = true;

  select account_state::text into v_account_state
  from public.app_users
  where id = v_video.submitted_by;

  select status::text into v_dancer_status
  from public.dancer_profiles
  where user_id = v_video.submitted_by;

  update public.dmca_cases
  set
    uploader_id = v_video.submitted_by,
    status = 'disabled',
    content_previous_status = coalesce(content_previous_status, v_video.status),
    reviewed_by = p_admin_id,
    reviewed_at = v_now,
    disabled_at = v_now,
    uploader_notified_at = v_now,
    admin_notes = nullif(trim(coalesce(p_admin_notes, '')), ''),
    repeat_infringer_enforced = v_strike_count >= 3,
    account_previous_state = case when v_strike_count >= 3 then v_account_state else account_previous_state end,
    dancer_previous_status = case when v_strike_count >= 3 then v_dancer_status else dancer_previous_status end,
    updated_at = v_now
  where id = v_case.id;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_CASE_WRITE_UNCONFIRMED' using errcode='40001';end if;

  insert into public.notifications (
    recipient_id,
    notification_type,
    channel,
    title,
    body,
    payload,
    sent_at
  )
  values (
    v_video.submitted_by,
    'dmca_status',
    'in_app',
    'Copyright notice received',
    'A MyDancr TV video was disabled after a copyright notice. You may submit a valid counter-notice from the copyright page.',
    jsonb_build_object('caseId', v_case.id, 'videoId', v_video.id, 'status', 'disabled'),
    v_now
  );
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_NOTIFICATION_WRITE_UNCONFIRMED' using errcode='40001';end if;

  if v_strike_count >= 3 then
    -- Preserve the first still-owned pre-enforcement state across later cases.
    -- A deleted account must never be changed back into a disabled account.
    if v_account.account_state<>'deleted' then
      select previous_state into v_before from public.dmca_enforcement_states
        where target_type='account' and target_id=v_account.id and uploader_id=v_uploader and restore_allowed
          and applied_state=jsonb_build_object('account_state',v_account.account_state,'dmca_suspended_at',v_account.dmca_suspended_at);
      if not found then v_before:=jsonb_build_object('account_state',v_account.account_state,'dmca_suspended_at',v_account.dmca_suspended_at);end if;
      update public.app_users set account_state='disabled',dmca_suspended_at=coalesce(dmca_suspended_at,v_now),updated_at=v_now
        where id=v_uploader returning jsonb_build_object('account_state',account_state,'dmca_suspended_at',dmca_suspended_at)into v_applied;
      if not found then raise exception 'DMCA_ACCOUNT_WRITE_UNCONFIRMED' using errcode='40001';end if;
      insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state,enforced_at)
        values('account',v_uploader,v_uploader,v_before,v_applied,v_now)
        on conflict(target_type,target_id)do update set previous_state=excluded.previous_state,applied_state=excluded.applied_state,
          restore_allowed=true,enforced_at=excluded.enforced_at,invalidated_at=null;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_SNAPSHOT_WRITE_UNCONFIRMED' using errcode='40001';end if;
    end if;
    select previous_state into v_before from public.dmca_enforcement_states
      where target_type='dancer_profile' and target_id=v_profile.id and uploader_id=v_uploader and restore_allowed
        and applied_state=jsonb_build_object('status',v_profile.status,'disabled_at',v_profile.disabled_at,'dmca_suspended_at',v_profile.dmca_suspended_at);
    if not found then v_before:=jsonb_build_object('status',v_profile.status,'disabled_at',v_profile.disabled_at,'dmca_suspended_at',v_profile.dmca_suspended_at);end if;
    update public.dancer_profiles set status='disabled',dmca_suspended_at=coalesce(dmca_suspended_at,v_now),disabled_at=v_now,updated_at=v_now
      where id=v_profile.id returning jsonb_build_object('status',status,'disabled_at',disabled_at,'dmca_suspended_at',dmca_suspended_at)into v_applied;
    if not found then raise exception 'DMCA_PROFILE_WRITE_UNCONFIRMED' using errcode='40001';end if;
    insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state,enforced_at)
      values('dancer_profile',v_profile.id,v_uploader,v_before,v_applied,v_now)
      on conflict(target_type,target_id)do update set previous_state=excluded.previous_state,applied_state=excluded.applied_state,
        restore_allowed=true,enforced_at=excluded.enforced_at,invalidated_at=null;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_SNAPSHOT_WRITE_UNCONFIRMED' using errcode='40001';end if;
    for v_item in select * from public.mydancr_tv_videos where submitted_by=v_uploader and status<>'hidden' order by id loop
      if v_item.dancer_id<>v_profile.id then raise exception 'DMCA_TARGET_OWNERSHIP_CHANGED' using errcode='40001';end if;
      v_before:=jsonb_build_object('status',v_item.status,'published_at',v_item.published_at,'review_notes',v_item.review_notes);
      update public.mydancr_tv_videos set status='hidden',published_at=null,updated_at=v_now where id=v_item.id
        returning jsonb_build_object('status',status,'published_at',published_at,'review_notes',review_notes)into v_applied;
      if not found then raise exception 'DMCA_VIDEO_WRITE_UNCONFIRMED' using errcode='40001';end if;
      insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state,enforced_at)
        values('tv_video',v_item.id,v_uploader,v_before,v_applied,v_now)
        on conflict(target_type,target_id)do update set previous_state=excluded.previous_state,applied_state=excluded.applied_state,
          restore_allowed=true,enforced_at=excluded.enforced_at,invalidated_at=null;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_SNAPSHOT_WRITE_UNCONFIRMED' using errcode='40001';end if;
    end loop;

    insert into public.notifications (
      recipient_id,
      notification_type,
      channel,
      title,
      body,
      payload,
      sent_at
    )
    values (
      v_video.submitted_by,
      'dmca_status',
      'in_app',
      'Account suspended for repeated copyright violations',
      'Your account reached three active copyright strikes and has been suspended under the repeat-infringer policy.',
      jsonb_build_object('caseId', v_case.id, 'activeStrikes', v_strike_count, 'status', 'suspended'),
      v_now
    );
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_NOTIFICATION_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'dmca_case',
    v_case.id,
    'apply_dmca_takedown',
    concat('Disabled video ', v_video.id, '; active copyright strikes: ', v_strike_count)
  );
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_AUDIT_WRITE_UNCONFIRMED' using errcode='40001';end if;

  return jsonb_build_object(
    'caseId', v_case.id,
    'videoId', v_video.id,
    'uploaderId', v_video.submitted_by,
    'activeStrikes', v_strike_count,
    'repeatInfringerEnforced', v_strike_count >= 3
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.approve_dancer_venue_affiliation_from_nfc(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tag public.nfc_tags;
  v_affiliation public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_now timestamptz := clock_timestamp();
  v_profile_activated boolean := false;
  v_affiliation_activated boolean := false;
begin
  select * into v_tag from public.nfc_tags where id = p_tag_id for update;
  if not found or v_tag.tag_type <> 'dressing_room'
    or (
      v_tag.status <> 'active'
      and not exists (
        select 1 from public.dancer_nfc_enrollments enrollment
        where enrollment.nfc_tag_id = v_tag.id
          and enrollment.dancer_user_id = p_dancer_user_id
          and enrollment.status = 'pending'
          and enrollment.expires_at > v_now
      )
    )
  then
    raise exception using errcode = '42501', message = 'This dressing-room NFC tag is inactive.';
  end if;

  select venue.* into v_venue
  from public.venues venue
  join public.app_users owner on owner.id = venue.owner_user_id
  where venue.id = v_tag.venue_id
    and venue.is_active = true
    and owner.role = 'venue'
    and owner.account_state = 'active'
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'This venue is not active.';
  end if;

  select * into v_dancer from public.dancer_profiles where user_id = p_dancer_user_id for update;
  if not found
    or v_dancer.status in ('rejected', 'disabled')
    or v_dancer.disabled_at is not null
    or nullif(trim(v_dancer.stage_name), '') is null
    or nullif(trim(v_dancer.city), '') is null
    or not exists (
      select 1 from public.app_users
      where id = p_dancer_user_id and role = 'dancer' and account_state = 'active'
    )
    or (
      not (
        v_dancer.status = 'approved'
        and v_dancer.verification_status = 'approved'
        and v_dancer.is_public = true
      )
      and (
        v_dancer.status <> 'pending_review'
        or nullif(trim(v_dancer.avatar_storage_path), '') is null
        or not exists (
          select 1 from public.dancer_photos photo
          where photo.dancer_id = v_dancer.id and photo.review_status = 'approved'
        )
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Submit Step 2 with an approved avatar and profile picture before tapping to activate.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_dancer.id::text), hashtext(v_venue.id::text));

  select not exists (
    select 1
    from public.venue_dancer_affiliations affiliation
    where affiliation.venue_id = v_venue.id
      and affiliation.dancer_id = v_dancer.id
      and affiliation.status = 'active'
      and affiliation.revoked_at is null
  ) into v_affiliation_activated;

  insert into public.venue_dancer_affiliations (
    venue_id, dancer_id, status, approved_by_user_id, approved_at,
    revoked_by_user_id, revoked_at, revoke_reason, updated_at
  ) values (
    v_venue.id, v_dancer.id, 'active', v_venue.owner_user_id, v_now,
    null, null, null, v_now
  ) on conflict (venue_id, dancer_id) do update set
    status = 'active',
    approved_by_user_id = case
      when public.venue_dancer_affiliations.status = 'active'
        and public.venue_dancer_affiliations.revoked_at is null
      then public.venue_dancer_affiliations.approved_by_user_id
      else excluded.approved_by_user_id
    end,
    approved_at = case
      when public.venue_dancer_affiliations.status = 'active'
        and public.venue_dancer_affiliations.revoked_at is null
      then public.venue_dancer_affiliations.approved_at
      else excluded.approved_at
    end,
    revoked_by_user_id = null,
    revoked_at = null,
    revoke_reason = null,
    updated_at = excluded.updated_at
  returning * into v_affiliation;

  v_profile_activated := v_dancer.venue_approved_at is null or v_dancer.is_public = false;
  update public.dancer_profiles set
    status = 'approved',
    verification_status = 'approved',
    approved_at = coalesce(approved_at, v_now),
    is_public = true,
    venue_approved_at = coalesce(venue_approved_at, v_now),
    venue_approved_by_user_id = coalesce(venue_approved_by_user_id, v_venue.owner_user_id),
    venue_approved_venue_id = coalesce(venue_approved_venue_id, v_venue.id)
  where id = v_dancer.id;

  if v_affiliation_activated then
    insert into public.venue_dancer_affiliation_events (
      affiliation_id, venue_id, dancer_id, actor_user_id, event_type, event_payload
    ) values (
      v_affiliation.id, v_venue.id, v_dancer.id, p_dancer_user_id,
      'affiliation_approved',
      jsonb_build_object(
        'method', 'nfc',
        'tagId', v_tag.id,
        'profileActivated', v_profile_activated,
        'shiftCheckedIn', false
      )
    );

    insert into public.notifications (
      recipient_id, notification_type, channel, title, body, payload, sent_at
    ) values (
      p_dancer_user_id,
      'venue_affiliation_status',
      'in_app',
      'Venue affiliation activated',
      v_venue.name || ' was added from its dressing-room NFC tag. A fresh eligible tap starts Working Now.',
      jsonb_build_object(
        'affiliationId', v_affiliation.id,
        'venueId', v_venue.id,
        'venueSlug', v_venue.slug,
        'status', 'active',
        'method', 'nfc'
      ),
      v_now
    );
  end if;

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_venue.id, v_tag.tag_type,
    case when v_affiliation_activated then 'affiliation_approved' else 'opened' end,
    p_dancer_user_id, p_session_id,
    p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object(
      'dancerId', v_dancer.id,
      'affiliationId', v_affiliation.id,
      'affiliationActivated', v_affiliation_activated,
      'shiftCheckedIn', false
    )
  );

  update public.nfc_tags set
    last_tapped_at = v_now,
    tap_count = tap_count + 1,
    updated_at = v_now
  where id = v_tag.id;

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug,
    'dancerId', v_dancer.id,
    'dancerUserId', p_dancer_user_id,
    'stageName', v_dancer.stage_name,
    'status', v_affiliation.status,
    'approvedAt', v_affiliation.approved_at,
    'affiliationActivated', v_affiliation_activated,
    'profileActivated', v_profile_activated,
    'shiftCheckedIn', false,
    'shiftId', null
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.approve_dancer_venue_affiliation(p_token_digest text, p_manager_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_token public.venue_dancer_verification_tokens;
  v_affiliation public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_now timestamptz := now();
  v_profile_activated boolean := false;
begin
  select * into v_token from public.venue_dancer_verification_tokens where token_digest = p_token_digest for update;
  if not found or v_token.expires_at <= v_now or v_token.used_at is not null or v_token.revoked_at is not null then
    raise exception using errcode = '42501', message = 'This dancer verification link is invalid or expired.';
  end if;

  select * into v_venue from public.venues where id = v_token.venue_id for key share;
  if not found or v_venue.is_active = false or v_venue.owner_user_id is distinct from p_manager_user_id
    or not exists (select 1 from public.app_users where id = p_manager_user_id and role = 'venue' and account_state = 'active')
  then
    raise exception using errcode = '42501', message = 'Only this venue''s verified manager can confirm affiliation.';
  end if;

  select * into v_dancer from public.dancer_profiles where id = v_token.dancer_id for update;
  if not found or v_dancer.status in ('rejected', 'disabled') or v_dancer.disabled_at is not null
    or nullif(trim(v_dancer.stage_name), '') is null or nullif(trim(v_dancer.city), '') is null
    or nullif(trim(v_dancer.avatar_storage_path), '') is null or v_dancer.photo_review_status <> 'approved'
    or not exists (select 1 from public.dancer_photos photo where photo.dancer_id = v_dancer.id and photo.review_status = 'approved')
    or exists (select 1 from public.dancer_photos photo where photo.dancer_id = v_dancer.id and photo.review_status <> 'approved')
    or exists (select 1 from public.mydancr_tv_videos video where video.dancer_id = v_dancer.id and video.status in ('uploading', 'moderating', 'submitted'))
    or not exists (select 1 from public.app_users where id = v_dancer.user_id and role = 'dancer' and account_state = 'active')
  then
    raise exception using errcode = '42501', message = 'This dancer has not completed profile setup and automated media moderation.';
  end if;

  insert into public.venue_dancer_affiliations (
    venue_id, dancer_id, status, approved_by_user_id, approved_at, revoked_by_user_id, revoked_at, revoke_reason, updated_at
  ) values (
    v_token.venue_id, v_token.dancer_id, 'active', p_manager_user_id, v_now, null, null, null, v_now
  ) on conflict (venue_id, dancer_id) do update set
    status = 'active', approved_by_user_id = excluded.approved_by_user_id, approved_at = excluded.approved_at,
    revoked_by_user_id = null, revoked_at = null, revoke_reason = null, updated_at = excluded.updated_at
  returning * into v_affiliation;

  v_profile_activated := v_dancer.venue_approved_at is null;
  update public.dancer_profiles set
    status = 'approved',
    verification_status = 'approved',
    approved_at = coalesce(approved_at, v_now),
    is_public = true,
    venue_approved_at = coalesce(venue_approved_at, v_now),
    venue_approved_by_user_id = coalesce(venue_approved_by_user_id, p_manager_user_id),
    venue_approved_venue_id = coalesce(venue_approved_venue_id, v_token.venue_id)
  where id = v_dancer.id;

  update public.venue_dancer_verification_tokens set used_at = v_now, used_by_user_id = p_manager_user_id where id = v_token.id;
  update public.venue_dancer_verification_tokens set revoked_at = v_now
  where venue_id = v_token.venue_id and dancer_id = v_token.dancer_id and id <> v_token.id and used_at is null and revoked_at is null;

  insert into public.venue_dancer_affiliation_events (affiliation_id, venue_id, dancer_id, actor_user_id, event_type, event_payload)
  values (v_affiliation.id, v_affiliation.venue_id, v_affiliation.dancer_id, p_manager_user_id, 'affiliation_approved', jsonb_build_object('tokenId', v_token.id, 'profileActivated', v_profile_activated));

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_affiliation.venue_id,
    'dancerId', v_affiliation.dancer_id,
    'status', v_affiliation.status,
    'approvedAt', v_affiliation.approved_at,
    'profileActivated', v_profile_activated,
    'dancerUserId', v_dancer.user_id,
    'stageName', v_dancer.stage_name,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.approve_venue_deal_removal(p_request_id uuid, p_venue_id uuid, p_admin_user_id uuid)
 RETURNS venue_club_deal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_request public.venue_club_deal_requests;
begin
if not exists (select 1 from public.app_users where id = p_admin_user_id and role = 'admin' and account_state = 'active') then raise exception 'Admin access required.' using errcode = '42501'; end if;
select * into v_request from public.venue_club_deal_requests where id = p_request_id and venue_id = p_venue_id for update;
if not found or v_request.request_type <> 'remove' or v_request.status not in ('pending', 'under_review') then raise exception 'This deal removal request is no longer available for review.'; end if;
if v_request.target_deal_id is null then raise exception 'The requested Club Deal no longer exists.'; end if;
update public.club_deals set is_active = false, removed_at = coalesce(removed_at, now()), updated_at = now() where id = v_request.target_deal_id and venue_id = p_venue_id;
if not found then raise exception 'Club Deal not found for this venue.'; end if;
update public.venue_club_deal_requests set status = 'approved', linked_deal_id = v_request.target_deal_id, reviewed_by_admin_user_id = p_admin_user_id, reviewed_at = now(), decision_note = 'Removal approved. This Club Deal is no longer available to guests.', updated_at = now() where id = v_request.id returning * into v_request;
return v_request;
end; $function$
;
CREATE OR REPLACE FUNCTION public.assign_admin_venue_sales_agent(p_admin_id uuid, p_venue_id uuid, p_signing_agent_id uuid, p_agreement_reference text, p_effective_from timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_attribution_id uuid; v_signer public.sales_agents%rowtype;
  v_level_1 uuid; v_level_2 uuid; v_level_3 uuid; v_level_4 uuid; v_level_5 uuid;
  v_existing_effective_from timestamptz;
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_id and account.role = 'admin' and account.account_state = 'active'
  ) then raise exception using errcode = '42501', message = 'Admin access required.'; end if;
  if not exists (select 1 from public.venues where id = p_venue_id and is_active = true) then
    raise exception using errcode = '22023', message = 'Select an active venue.';
  end if;
  select * into v_signer from public.sales_agents where id = p_signing_agent_id for update;
  if not found or v_signer.status <> 'active' then
    raise exception using errcode = '22023', message = 'Select an active signing agent.';
  end if;
  if char_length(trim(coalesce(p_agreement_reference, ''))) not between 3 and 180 then
    raise exception using errcode = '22023', message = 'A signed venue agreement reference is required.';
  end if;
  if p_effective_from is null then
    raise exception using errcode = '22023', message = 'An attribution effective time is required.';
  end if;
  select attribution.effective_from into v_existing_effective_from
  from public.venue_sales_attributions attribution
  where attribution.venue_id = p_venue_id and attribution.superseded_at is null
  for update;
  if v_existing_effective_from is not null and p_effective_from <= v_existing_effective_from then
    raise exception using errcode = '22023',
      message = 'The replacement attribution must begin after the current attribution.';
  end if;
  -- Capture every ancestor from one statement snapshot; the signer stays locked.
  with recursive sponsors as (
    select agent.id, agent.sponsor_agent_id, 1 as depth
    from public.sales_agents agent where agent.id = v_signer.sponsor_agent_id
    union all
    select parent.id, parent.sponsor_agent_id, sponsors.depth + 1
    from public.sales_agents parent join sponsors on parent.id = sponsors.sponsor_agent_id
    where sponsors.depth < 5
  )
  select
    (select id from sponsors where depth = 1),
    (select id from sponsors where depth = 2),
    (select id from sponsors where depth = 3),
    (select id from sponsors where depth = 4),
    (select id from sponsors where depth = 5)
  into v_level_1, v_level_2, v_level_3, v_level_4, v_level_5;
  update public.venue_sales_attributions set superseded_at = p_effective_from
  where venue_id = p_venue_id and superseded_at is null;
  insert into public.venue_sales_attributions (
    venue_id, signing_agent_id, sponsor_level_1_agent_id, sponsor_level_2_agent_id,
    sponsor_level_3_agent_id, sponsor_level_4_agent_id, sponsor_level_5_agent_id,
    agreement_reference, effective_from, created_by_admin_user_id
  ) values (
    p_venue_id, p_signing_agent_id, v_level_1, v_level_2, v_level_3, v_level_4, v_level_5,
    trim(p_agreement_reference), p_effective_from, p_admin_id
  ) returning id into v_attribution_id;
  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (p_admin_id, 'venue_sales_attribution', v_attribution_id,
    'assign_venue_signing_agent', trim(p_agreement_reference));
  return v_attribution_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_dancer_profile_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  base_slug text;
  candidate text;
  suffix integer := 1;
begin
  -- Serialize assignments, including reservations of old links.
  perform pg_catalog.pg_advisory_xact_lock(7682451001::bigint);
  if new.slug ~ '^dancer(-[0-9]+|-[0-9a-f]{8}(-[0-9]+)?|-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$'
    and (tg_op = 'INSERT' or new.slug = old.slug) then
    base_slug := trim(both '-' from left(public.slugify(new.stage_name), 70));
    if base_slug <> '' and base_slug <> 'dancer' then
      candidate := base_slug;
      while exists (select 1 from public.dancer_profiles where slug = candidate and id <> new.id)
         or exists (select 1 from public.dancer_profile_slug_aliases where slug = candidate and dancer_id <> new.id) loop
        suffix := suffix + 1;
        candidate := base_slug || '-' || suffix::text;
      end loop;
      new.slug := candidate;
    end if;
  end if;

  if exists (select 1 from public.dancer_profile_slug_aliases where slug = new.slug and dancer_id <> new.id) then
    raise exception 'Profile link is already assigned' using errcode = '23505';
  end if;
  if tg_op = 'UPDATE' and old.slug is distinct from new.slug then
    insert into public.dancer_profile_slug_aliases(slug, dancer_id)
      values (old.slug, new.id) on conflict (slug) do nothing;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.attribute_approved_venue_agent_referral()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_signer public.sales_agents%rowtype;
  v_level_1 uuid;
  v_level_2 uuid;
  v_level_3 uuid;
  v_level_4 uuid;
  v_level_5 uuid;
  v_attribution_id uuid;
  v_effective_from timestamptz;
begin
  if new.status <> 'approved'
    or old.status = 'approved'
    or new.referring_agent_id is null
  then
    return new;
  end if;

  if new.matched_venue_id is null or new.reviewed_by is null then
    raise exception using errcode = '22023',
      message = 'An approved referred venue requires a verified workspace and administrator.';
  end if;

  select * into v_signer
  from public.sales_agents
  where id = new.referring_agent_id
  for update;

  if not found or v_signer.status <> 'active' then
    raise exception using errcode = '22023',
      message = 'The referring sales agent is no longer active. Resolve the referral before approval.';
  end if;

  if exists (
    select 1
    from public.venue_sales_attributions attribution
    where attribution.venue_id = new.matched_venue_id
      and attribution.superseded_at is null
  ) then
    raise exception using errcode = '23505',
      message = 'This venue already has an active sales-agent attribution.';
  end if;

  -- Capture every ancestor from one statement snapshot; the signer stays locked.
  with recursive sponsors as (
    select agent.id, agent.sponsor_agent_id, 1 as depth
    from public.sales_agents agent where agent.id = v_signer.sponsor_agent_id
    union all
    select parent.id, parent.sponsor_agent_id, sponsors.depth + 1
    from public.sales_agents parent join sponsors on parent.id = sponsors.sponsor_agent_id
    where sponsors.depth < 5
  )
  select
    (select id from sponsors where depth = 1),
    (select id from sponsors where depth = 2),
    (select id from sponsors where depth = 3),
    (select id from sponsors where depth = 4),
    (select id from sponsors where depth = 5)
  into v_level_1, v_level_2, v_level_3, v_level_4, v_level_5;
  v_effective_from := coalesce(new.reviewed_at, clock_timestamp());

  insert into public.venue_sales_attributions (
    venue_id,
    signing_agent_id,
    sponsor_level_1_agent_id,
    sponsor_level_2_agent_id,
    sponsor_level_3_agent_id,
    sponsor_level_4_agent_id,
    sponsor_level_5_agent_id,
    agreement_reference,
    effective_from,
    created_by_admin_user_id
  ) values (
    new.matched_venue_id,
    new.referring_agent_id,
    v_level_1,
    v_level_2,
    v_level_3,
    v_level_4,
    v_level_5,
    'verified-venue-request:' || new.id::text,
    v_effective_from,
    new.reviewed_by
  )
  returning id into v_attribution_id;

  insert into public.admin_actions (
    admin_id,
    target_type,
    target_id,
    action,
    notes
  ) values (
    new.reviewed_by,
    'venue_sales_attribution',
    v_attribution_id,
    'confirm_agent_referred_venue',
    'Verified venue request ' || new.id::text || ' attributed to agent ' || new.referring_agent_id::text
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.authorize_dancer_profile_from_nfc(p_dancer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_enrollment public.dancer_nfc_enrollments;
  v_venue public.venues;
  v_profile public.dancer_profiles;
  v_affiliation public.venue_dancer_affiliations;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_dancer_user_id and account.role = 'dancer' and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active dancer account is required.';
  end if;

  select enrollment.* into v_enrollment
  from public.dancer_nfc_enrollments enrollment
  where enrollment.dancer_user_id = p_dancer_user_id
    and (enrollment.status = 'completed' or (enrollment.status = 'pending' and enrollment.expires_at > v_now))
  order by enrollment.tapped_at desc limit 1;
  if not found then return jsonb_build_object('authorized', false, 'reason', 'no_nfc_enrollment'); end if;

  select venue.* into v_venue
  from public.venues venue
  join public.app_users owner on owner.id = venue.owner_user_id
  where venue.id = v_enrollment.venue_id and venue.is_active = true
    and owner.role = 'venue' and owner.account_state = 'active';
  if not found then return jsonb_build_object('authorized', false, 'reason', 'inactive_venue'); end if;

  update public.dancer_profiles dancer set
    venue_approved_at = coalesce(dancer.venue_approved_at, v_enrollment.tapped_at),
    venue_approved_by_user_id = coalesce(dancer.venue_approved_by_user_id, v_venue.owner_user_id),
    venue_approved_venue_id = coalesce(dancer.venue_approved_venue_id, v_venue.id),
    updated_at = v_now
  where dancer.user_id = p_dancer_user_id and dancer.status not in ('rejected', 'disabled') and dancer.disabled_at is null
  returning dancer.* into v_profile;
  if not found then
    return jsonb_build_object('authorized', false, 'reason', 'profile_not_ready', 'enrollmentId', v_enrollment.id, 'venueId', v_venue.id, 'venueName', v_venue.name);
  end if;

  insert into public.venue_dancer_affiliations (
    venue_id, dancer_id, status, approved_by_user_id, approved_at,
    revoked_by_user_id, revoked_at, revoke_reason, updated_at
  ) values (
    v_venue.id, v_profile.id, 'active', v_venue.owner_user_id, v_enrollment.tapped_at,
    null, null, null, v_now
  ) on conflict (venue_id, dancer_id) do update set
    status = 'active', approved_by_user_id = excluded.approved_by_user_id,
    approved_at = case when public.venue_dancer_affiliations.status = 'active' and public.venue_dancer_affiliations.revoked_at is null then public.venue_dancer_affiliations.approved_at else excluded.approved_at end,
    revoked_by_user_id = null, revoked_at = null, revoke_reason = null, updated_at = excluded.updated_at
  returning * into v_affiliation;

  return jsonb_build_object('authorized', true, 'authorizedAt', v_profile.venue_approved_at, 'enrollmentId', v_enrollment.id, 'affiliationId', v_affiliation.id, 'venueId', v_venue.id, 'venueName', v_venue.name, 'profilePublic', v_profile.is_public);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.capture_gallery_media_reference_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind text;
  v_old_id uuid;
  v_new_id uuid;
  v_old_profile uuid;
  v_new_profile uuid;
  v_old_path text;
  v_new_path text;
begin
  -- Restrict this privileged writer to its two fixed source relations.
  if tg_level <> 'ROW' or tg_when <> 'AFTER' or tg_op not in ('INSERT','UPDATE','DELETE') then
    raise exception 'GALLERY_HISTORY_INVALID_TRIGGER' using errcode='42501';
  end if;
  if tg_relid = 'public.dancer_photos'::regclass then
    v_kind := 'photo';
    if tg_op <> 'INSERT' then
      v_old_id := old.id; v_old_profile := old.dancer_id; v_old_path := old.storage_path;
    end if;
    if tg_op <> 'DELETE' then
      v_new_id := new.id; v_new_profile := new.dancer_id; v_new_path := new.storage_path;
    end if;
  elsif tg_relid = 'public.dancer_profiles'::regclass then
    v_kind := 'avatar';
    if tg_op <> 'INSERT' then
      v_old_id := old.id; v_old_profile := old.id; v_old_path := old.avatar_storage_path;
    end if;
    if tg_op <> 'DELETE' then
      v_new_id := new.id; v_new_profile := new.id; v_new_path := new.avatar_storage_path;
    end if;
  else
    raise exception 'GALLERY_HISTORY_INVALID_SOURCE' using errcode='42501';
  end if;
  if tg_op = 'UPDATE' and v_old_id is not distinct from v_new_id
    and v_old_profile is not distinct from v_new_profile and v_old_path is not distinct from v_new_path then
    return null;
  end if;
  if v_old_path is not null and v_old_path <> '' then
    insert into public.gallery_media_reference_history(source_kind,source_id,profile_id,storage_path,event_kind)
      values(v_kind,v_old_id,v_old_profile,v_old_path,'released');
  end if;
  if v_new_path is not null and v_new_path <> '' then
    insert into public.gallery_media_reference_history(source_kind,source_id,profile_id,storage_path,event_kind)
      values(v_kind,v_new_id,v_new_profile,v_new_path,'referenced');
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.change_venue_publication_safely(p_actor_user_id uuid, p_venue_id uuid, p_action text, p_changes jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_actor public.app_users%rowtype;
  v_venue public.venues%rowtype;
  v_owner uuid;
  v_changes jsonb;
  v_expected jsonb;
  v_result jsonb;
  v_columns text;
  v_notes text;
  v_affected bigint;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'VENUE_PUBLICATION_SERVICE_REQUIRED' using errcode='42501';end if;
  if p_actor_user_id is null or p_venue_id is null or p_action is null
    or p_action not in('admin_edit','admin_publish','owner_approve','owner_request_changes')
    or p_changes is null or jsonb_typeof(p_changes)<>'object' or octet_length(p_changes::text)>65536 then
    raise exception 'VENUE_PUBLICATION_INVALID_INPUT' using errcode='22023';
  end if;
  select owner_user_id into v_owner from public.venues where id=p_venue_id;
  if not found then raise exception 'VENUE_PUBLICATION_NOT_FOUND' using errcode='42501';end if;
  -- The same account-before-venue order as self-pause, with stable ordering for
  -- a manager and owner. Recheck ownership after acquiring the venue lock.
  perform id from public.app_users where id=p_actor_user_id or id=v_owner order by id for share;
  select * into v_actor from public.app_users where id=p_actor_user_id;
  if not found or v_actor.account_state<>'active' or v_actor.dmca_suspended_at is not null then
    raise exception 'VENUE_PUBLICATION_ACTIVE_ACTOR_REQUIRED' using errcode='42501';
  end if;
  select * into v_venue from public.venues where id=p_venue_id for update;
  if not found or v_venue.owner_user_id is distinct from v_owner then raise exception 'VENUE_PUBLICATION_OWNER_CHANGED' using errcode='40001';end if;
  if p_action in('admin_edit','admin_publish') then
    if v_actor.role<>'admin' then raise exception 'VENUE_PUBLICATION_ADMIN_REQUIRED' using errcode='42501';end if;
    if p_action='admin_edit' then
      if p_changes->'is_active'is distinct from 'false'::jsonb
        or exists(select 1 from jsonb_object_keys(p_changes)k where k<>all(array[
          'name','slug','city','state','address','latitude','longitude','phone','website','timezone','opens_at','closes_at',
          'is_active','page_review_status','page_review_sent_at','page_reviewed_at','page_reviewed_by_user_id','page_review_notes'])) then
        raise exception 'VENUE_PUBLICATION_INVALID_ADMIN_EDIT' using errcode='22023';
      end if;
      v_changes:=p_changes;
    else
      if p_changes<>'{}'::jsonb or v_venue.page_review_status<>'venue_approved' or v_owner is null then
        raise exception 'VENUE_PUBLICATION_REVIEW_CHANGED' using errcode='40001';
      end if;
      v_changes:=jsonb_build_object('is_active',true,'published_at',v_now,'page_review_status','published','page_review_notes',null);
    end if;
  else
    if v_actor.role<>'venue' or v_owner is null or not exists(select 1 from public.app_users where id=v_owner and account_state='active'and dmca_suspended_at is null) then
      raise exception 'VENUE_PUBLICATION_OWNER_REQUIRED' using errcode='42501';
    end if;
    if p_actor_user_id<>v_owner then
      perform id from public.venue_team_members where venue_id=p_venue_id and user_id=p_actor_user_id and role='manager'and status='active'for share;
      if not found then raise exception 'VENUE_PUBLICATION_MANAGER_REQUIRED' using errcode='42501';end if;
    end if;
    if v_venue.page_review_status<>'venue_review' then raise exception 'VENUE_PUBLICATION_REVIEW_CHANGED' using errcode='40001';end if;
    if exists(select 1 from jsonb_object_keys(p_changes)k where k<>'notes')or(p_changes?'notes'and jsonb_typeof(p_changes->'notes')<>'string')then
      raise exception 'VENUE_PUBLICATION_INVALID_REVIEW' using errcode='22023';
    end if;
    v_notes:=btrim(coalesce(p_changes->>'notes',''));
    if p_action='owner_request_changes'and length(v_notes)<10 then raise exception 'VENUE_PUBLICATION_NOTES_REQUIRED' using errcode='22023';end if;
    v_changes:=jsonb_build_object('is_active',p_action='owner_approve',
      'published_at',case when p_action='owner_approve'then v_now else null end,
      'page_review_status',case when p_action='owner_approve'then 'published'else 'changes_requested'end,
      'page_reviewed_at',v_now,'page_reviewed_by_user_id',p_actor_user_id,
      'page_review_notes',case when p_action='owner_approve'then null else v_notes end);
  end if;
  v_expected:=to_jsonb(jsonb_populate_record(v_venue,v_changes));
  select string_agg(format('%I',k),','order by k)into v_columns from jsonb_object_keys(v_changes)k;
  execute format('update public.venues as v set (%s)=(select %s from jsonb_populate_record(null::public.venues,$1))where id=$2 returning to_jsonb(v)',v_columns,v_columns)
    into v_result using v_changes,p_venue_id;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'VENUE_PUBLICATION_WRITE_MISMATCH' using errcode='40001';end if;
  select to_jsonb(v)into v_result from public.venues v where id=p_venue_id;
  if not found or exists(select 1 from jsonb_object_keys(v_changes)k where v_result->k is distinct from v_expected->k)then
    raise exception 'VENUE_PUBLICATION_WRITE_MISMATCH' using errcode='40001';
  end if;
  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_dancer_payout_dispatch(p_payout_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_before public.dancer_payout_batches%rowtype;
  v_after public.dancer_payout_batches%rowtype;
  v_mark jsonb;
  v_key text;
begin
  if p_payout_id is null then
    raise exception using errcode = '22023', message = 'A payout ID is required.';
  end if;
  select * into v_before from public.dancer_payout_batches where id = p_payout_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payout not found.';
  end if;
  if v_before.status <> 'requested' then
    return pg_catalog.jsonb_build_object('id',v_before.id,'status',v_before.status,'claimed',false);
  end if;
  if v_before.is_test or v_before.currency <> 'usd' or v_before.payment_provider = 'bitsafe' then
    raise exception using errcode = '22023', message = 'This payout cannot be dispatched.';
  end if;
  if v_before.provider_reference_id is not null or v_before.external_reference is not null
    or v_before.stripe_transfer_id is not null or v_before.processing_at is not null
    or v_before.paid_at is not null or v_before.failed_at is not null or v_before.canceled_at is not null
    or v_before.metadata @> '{"dispatch_review_required":true}'::jsonb
  then
    raise exception using errcode = '40001', message = 'Payout requires reconciliation before dispatch.';
  end if;

  v_key := 'mydancr-payout-' || p_payout_id::text;
  v_mark := public.mark_dancer_payout_processing(p_payout_id,v_key);
  select * into v_after from public.dancer_payout_batches where id = p_payout_id;
  if not found or v_mark is null
    or v_mark->>'id' is distinct from p_payout_id::text
    or v_mark->>'status' is distinct from 'processing'
    or v_after.status <> 'processing' or v_after.processing_at is null
    or v_after.provider_reference_id is distinct from v_key
    or v_after.external_reference is distinct from v_key
    or (v_before.payment_provider = 'stripe' and v_after.stripe_transfer_id is distinct from v_key)
    or (pg_catalog.to_jsonb(v_after) - array['status','processing_at','provider_reference_id','external_reference','stripe_transfer_id','failure_message','metadata','updated_at'])
       is distinct from (pg_catalog.to_jsonb(v_before) - array['status','processing_at','provider_reference_id','external_reference','stripe_transfer_id','failure_message','metadata','updated_at'])
  then
    raise exception using errcode = '40001', message = 'Payout dispatch claim could not be confirmed.';
  end if;
  return pg_catalog.jsonb_build_object(
    'id',v_after.id,'status',v_after.status,'claimed',true,
    'dancerId',v_after.dancer_id,'amountCents',v_after.amount_cents,
    'currency',v_after.currency,'paymentProvider',v_after.payment_provider,'dispatchKey',v_key
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_gallery_storage_retirement(p_profile_id uuid, p_storage_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_retirement public.gallery_storage_retirements%rowtype;
begin
  if p_profile_id is null or p_storage_path is null then
    raise exception 'GALLERY_RETIREMENT_INPUT_REQUIRED' using errcode='22023';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'GALLERY_RETIREMENT_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  -- Only a canonical master in the previously published profile directory can
  -- retire. Unrecognized/variant/external paths remain available for recovery.
  if p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(avatar/)?[A-Za-z0-9][A-Za-z0-9._-]*[.](jpg|jpeg|png|webp)$'
    or position('..' in p_storage_path)>0
    or split_part(p_storage_path,'/',2)<>p_profile_id::text
    or public.gallery_storage_family(p_storage_path)<>p_storage_path then
    return jsonb_build_object('status','retained','reason','unrecognized_path','storage_path',p_storage_path,'profile_id',p_profile_id);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mydancr:gallery-retirement:' || p_storage_path,0));
  if not exists(select 1 from public.gallery_media_reference_history
    where profile_id=p_profile_id and public.gallery_storage_family(storage_path)=p_storage_path) then
    return jsonb_build_object('status','retained','reason','no_reference_history','storage_path',p_storage_path,'profile_id',p_profile_id);
  end if;
  if exists(select 1 from public.dancer_photos where public.gallery_storage_family(storage_path)=p_storage_path)
    or exists(select 1 from public.dancer_profiles where public.gallery_storage_family(avatar_storage_path)=p_storage_path)
    or exists(select 1 from public.image_moderation_records where public.gallery_storage_family(final_storage_path)=p_storage_path) then
    return jsonb_build_object('status','retained','reason','referenced','storage_path',p_storage_path,'profile_id',p_profile_id);
  end if;
  select * into v_retirement from public.gallery_storage_retirements where storage_path=p_storage_path;
  if not found then
    insert into public.gallery_storage_retirements(storage_path,profile_id)
      values(p_storage_path,p_profile_id) returning * into v_retirement;
  end if;
  return jsonb_build_object('status','retired','storage_path',v_retirement.storage_path,
    'profile_id',v_retirement.profile_id,'retirement_id',v_retirement.retirement_id,'retired_at',v_retirement.retired_at);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_nats_agent_commission_exports(p_limit integer DEFAULT 100)
 RETURNS TABLE(export_id uuid, agent_commission_event_id uuid, agent_id uuid, login_id bigint, amount_cents bigint, currency text, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'NATS agent export limit must be between 1 and 500.';
  end if;
  update public.nats_agent_commission_exports
  set status = 'reconciliation_required', failed_at = clock_timestamp(),
      last_error = 'The NATS export worker stopped with an unknown outcome. Verify the affiliate invoice in NATS before retrying.',
      updated_at = clock_timestamp()
  where status = 'processing'
    and processing_started_at < clock_timestamp() - interval '20 minutes';

  return query
  with candidates as (
    select export.id
    from public.nats_agent_commission_exports export
    join public.nats_agent_affiliate_accounts account
      on account.agent_id = export.agent_id and account.status = 'active'
    join public.agent_commission_events earning
      on earning.id = export.agent_commission_event_id
    where export.status = 'pending' and earning.status = 'payable'
    order by export.created_at, export.id
    for update of export skip locked
    limit p_limit
  ), claimed as (
    update public.nats_agent_commission_exports export
    set status = 'processing', processing_started_at = clock_timestamp(),
        attempt_count = export.attempt_count + 1, last_error = null,
        updated_at = clock_timestamp()
    where export.id in (select candidates.id from candidates)
    returning export.*
  )
  select claimed.id, claimed.agent_commission_event_id, claimed.agent_id,
    account.login_id, claimed.amount_cents, claimed.currency, claimed.attempt_count
  from claimed
  join public.nats_agent_affiliate_accounts account on account.agent_id = claimed.agent_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_nats_commission_exports(p_limit integer DEFAULT 100)
 RETURNS TABLE(export_id uuid, commission_event_id uuid, dancer_id uuid, login_id bigint, amount_cents bigint, currency text, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'NATS export limit must be between 1 and 500.';
  end if;

  -- NATS manual invoices do not accept an idempotency key. A worker can die
  -- after NATS accepts an invoice but before MyDancr records success, so an
  -- expired processing lease must be reconciled by an administrator and must
  -- never be dispatched automatically a second time.
  update public.nats_commission_exports
  set status = 'reconciliation_required',
      failed_at = clock_timestamp(),
      last_error = 'The NATS export worker stopped with an unknown outcome. Verify the affiliate invoice in NATS before retrying.',
      updated_at = clock_timestamp()
  where status = 'processing'
    and processing_started_at < clock_timestamp() - interval '20 minutes';

  return query
  with candidates as (
    select export.id
    from public.nats_commission_exports export
    join public.nats_affiliate_accounts account
      on account.dancer_id = export.dancer_id and account.status = 'active'
    join public.commission_events earning
      on earning.id = export.commission_event_id
    where export.status = 'pending'
      and earning.status = 'available'
      and earning.is_test = false
      and earning.held_at is null
      and earning.review_flag is null
      and (earning.qr_redemption_id is null
        or public.is_nats_eligible_club_deal_earning(earning.id))
    order by export.created_at, export.id
    for update of export skip locked
    limit p_limit
  ), claimed as (
    update public.nats_commission_exports export
    set status = 'processing',
        processing_started_at = clock_timestamp(),
        attempt_count = export.attempt_count + 1,
        last_error = null,
        updated_at = clock_timestamp()
    where export.id in (select candidates.id from candidates)
    returning export.*
  )
  select claimed.id, claimed.commission_event_id, claimed.dancer_id,
    account.login_id, claimed.amount_cents, claimed.currency, claimed.attempt_count
  from claimed
  join public.nats_affiliate_accounts account on account.dancer_id = claimed.dancer_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_payment_provider_webhook(p_payment_provider text, p_provider_event_id text, p_event_type text, p_object_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_event_id uuid;
begin
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other')
    or nullif(trim(coalesce(p_provider_event_id, '')), '') is null
    or nullif(trim(coalesce(p_event_type, '')), '') is null
  then
    raise exception using errcode = '22023', message = 'A valid provider webhook event is required.';
  end if;

  insert into public.payment_provider_webhook_events (
    payment_provider, provider_event_id, event_type, object_id
  ) values (
    p_payment_provider, trim(p_provider_event_id), trim(p_event_type), nullif(trim(coalesce(p_object_id, '')), '')
  )
  on conflict (payment_provider, provider_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is not null then return true; end if;

  -- A failed delivery may retry immediately. A processing delivery is leased
  -- for ten minutes so concurrent duplicates cannot run, while a process crash
  -- cannot strand the provider event forever.
  update public.payment_provider_webhook_events
  set processing_status = 'processing', failure_reason = null, processed_at = null,
      processing_started_at = clock_timestamp(), attempt_count = attempt_count + 1
  where payment_provider = p_payment_provider
    and provider_event_id = trim(p_provider_event_id)
    and (
      processing_status = 'failed'
      or (processing_status = 'processing' and processing_started_at <= clock_timestamp() - interval '10 minutes')
    )
  returning id into v_event_id;
  return v_event_id is not null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_payment_webhook_attempt(p_payment_provider text, p_provider_event_id text, p_event_type text, p_object_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_claimed boolean;
  v_event public.payment_provider_webhook_events%rowtype;
begin
  if p_payment_provider is null then
    raise exception using errcode = '22023', message = 'A valid provider webhook event is required.';
  end if;

  v_claimed := public.claim_payment_provider_webhook(
    p_payment_provider, p_provider_event_id, p_event_type, p_object_id
  );
  -- The nested insert/update retains its lock until this transaction ends.
  -- Returning ownership in that same transaction avoids a claim-then-read race.
  select * into v_event from public.payment_provider_webhook_events
  where payment_provider = p_payment_provider
    and provider_event_id = pg_catalog.btrim(p_provider_event_id)
  for update;

  if not found or v_claimed is null
    or (v_claimed and v_event.processing_status <> 'processing')
  then
    raise exception using errcode = '40001', message = 'Provider event claim could not be confirmed.';
  end if;
  if v_event.event_type is distinct from pg_catalog.btrim(p_event_type)
    or v_event.object_id is distinct from nullif(pg_catalog.btrim(coalesce(p_object_id, '')), '')
  then
    raise exception using errcode = '40001', message = 'Provider event identity changed.';
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_event.id,
    'paymentProvider', v_event.payment_provider,
    'eventId', v_event.provider_event_id,
    'eventType', v_event.event_type,
    'objectId', v_event.object_id,
    'claimed', v_claimed,
    'status', v_event.processing_status,
    'attemptCount', v_event.attempt_count,
    'processingStartedAt', v_event.processing_started_at
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.clear_dancer_avatar_safely(p_user_id uuid, p_profile_id uuid, p_expected_avatar_path text, p_expected_avatar_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_records jsonb;
  v_ids uuid[];
  v_previous text;
  v_affected integer;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'AVATAR_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_user_id is null or p_profile_id is null
    or (p_expected_avatar_updated_at is not null and not isfinite(p_expected_avatar_updated_at)) then
    raise exception 'AVATAR_INVALID_INPUT' using errcode='22023';
  end if;
  select * into v_account from public.app_users where id=p_user_id for update;
  if not found or v_account.role is distinct from 'dancer' or v_account.account_state is distinct from 'active' then
    raise exception 'AVATAR_ACCOUNT_UNAVAILABLE' using errcode='42501';
  end if;
  select * into v_profile from public.dancer_profiles where id=p_profile_id and user_id=p_user_id for update;
  if not found then raise exception 'AVATAR_PROFILE_UNAVAILABLE' using errcode='42501';end if;
  if v_profile.avatar_storage_path is distinct from p_expected_avatar_path
    or v_profile.avatar_updated_at is distinct from p_expected_avatar_updated_at then
    raise exception 'AVATAR_CHANGED' using errcode='40001';
  end if;
  -- Every new avatar reservation takes this same profile lock first.
  if (select count(*) from public.image_moderation_records where user_id=p_user_id and upload_context='profile_avatar')>1000 then
    raise exception 'AVATAR_REVIEW_LIMIT' using errcode='54000';
  end if;
  perform 1 from public.image_moderation_records where user_id=p_user_id and upload_context='profile_avatar' order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,
    'temporary_storage_path',temporary_storage_path,'final_storage_path',final_storage_path) order by id),'[]'::jsonb),
    coalesce(array_agg(id order by id),'{}'::uuid[]) into v_records,v_ids
    from public.image_moderation_records where user_id=p_user_id and upload_context='profile_avatar';
  if cardinality(v_ids)>1000 then raise exception 'AVATAR_REVIEW_LIMIT' using errcode='54000';end if;
  delete from public.image_moderation_records where id=any(v_ids) and user_id=p_user_id and upload_context='profile_avatar';
  get diagnostics v_affected=row_count;
  if v_affected<>cardinality(v_ids) then raise exception 'AVATAR_DELETE_UNCONFIRMED' using errcode='40001';end if;
  v_previous:=v_profile.avatar_storage_path;
  update public.dancer_profiles set avatar_storage_path=null,avatar_updated_at=clock_timestamp()
    where id=p_profile_id returning * into v_profile;
  return jsonb_build_object('profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
    'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
    'deleted_records',v_records,'previous_storage_path',v_previous);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.club_deal_is_liquor_related(p_offer_type text, p_deal_title text, p_deal_description text, p_deal_terms text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    lower(coalesce(p_offer_type, '')) in ('drink', 'bottle_service')
    or concat_ws(' ', p_deal_title, p_deal_description, p_deal_terms) ~*
      '(^|[^[:alnum:]_])(alcohol(ic)?|liquor|beer|wine|champagne|cocktails?|vodka|tequila|whisk(e)?y|bourbon|scotch|rum|gin|cognac|brandy|mezcal|lager|ale|hard[[:space:]]+seltzer|sake|bottle[[:space:]]+service|bar[[:space:]]+(tab|credit)|happy[[:space:]]+hour)([^[:alnum:]_]|$)'
    or concat_ws(' ', p_deal_title, p_deal_description, p_deal_terms) ~*
      '(^|[^[:alnum:]_])((free|complimentary|discounted|reduced|two[-[:space:]]?for[-[:space:]]?one|2[-[:space:]]?for[-[:space:]]?1)[[:space:]]+(alcoholic[[:space:]]+)?drinks?|drinks?[[:space:]]+(special|ticket|credit|voucher)|(free|complimentary|discounted|reduced)[[:space:]]+shots?)([^[:alnum:]_]|$)';
$function$
;
CREATE OR REPLACE FUNCTION public.complete_dancer_payout_batch(p_batch_id uuid, p_transfer_id text, p_paid_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_payout public.dancer_payout_batches%rowtype;
begin
  if char_length(trim(coalesce(p_transfer_id, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A valid provider payout reference is required.';
  end if;
  select * into v_payout from public.dancer_payout_batches where id = p_batch_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status <> 'processing' then
    raise exception using errcode = '22023', message = 'Only a processing payout can be marked paid.';
  end if;
  update public.dancer_payout_batches set status = 'paid', provider_reference_id = trim(p_transfer_id),
    external_reference = trim(p_transfer_id), paid_at = p_paid_at, failure_message = null, updated_at = now()
  where id = p_batch_id;
  update public.commission_events set status = 'paid', paid_at = p_paid_at
  where payout_batch_id = p_batch_id and status = 'payout_processing';
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, after_state)
  values ('provider', 'payout_paid', 'payout', p_batch_id::text,
    jsonb_build_object('status', 'paid', 'provider_reference_id', trim(p_transfer_id), 'paid_at', p_paid_at));
  return jsonb_build_object('id', p_batch_id, 'status', 'paid', 'provider_reference_id', trim(p_transfer_id));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.complete_nats_agent_commission_export(p_export_id uuid, p_nats_result text, p_response_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_event_id uuid;
begin
  update public.nats_agent_commission_exports
  set status = 'exported', exported_at = clock_timestamp(),
      nats_result = left(nullif(trim(coalesce(p_nats_result, '')), ''), 500),
      response_metadata = coalesce(p_response_metadata, '{}'::jsonb),
      updated_at = clock_timestamp()
  where id = p_export_id and status = 'processing'
  returning agent_commission_event_id into v_event_id;
  if v_event_id is not null then
    update public.agent_commission_events
    set status = 'paid', paid_at = clock_timestamp(),
        payout_reference = 'NATS:' || p_export_id::text,
        audit = audit || jsonb_build_object('nats_export_id', p_export_id)
    where id = v_event_id and status = 'payable';
    insert into public.financial_audit_events (
      actor_type, action, target_type, target_id, after_state, metadata
    ) values (
      'provider', 'nats_agent_commission_exported', 'agent_earning', v_event_id::text,
      jsonb_build_object('status', 'paid'),
      jsonb_build_object('commission_platform', 'nats', 'export_id', p_export_id)
    );
  end if;
  return v_event_id is not null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.complete_nats_commission_export(p_export_id uuid, p_nats_result text, p_response_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_commission_event_id uuid;
begin
  update public.nats_commission_exports
  set status = 'exported',
      exported_at = clock_timestamp(),
      nats_result = left(nullif(trim(coalesce(p_nats_result, '')), ''), 500),
      response_metadata = coalesce(p_response_metadata, '{}'::jsonb),
      updated_at = clock_timestamp()
  where id = p_export_id and status = 'processing'
  returning commission_event_id into v_commission_event_id;
  if v_commission_event_id is not null then
    insert into public.financial_audit_events (
      actor_type, action, target_type, target_id, after_state, metadata
    ) values (
      'provider', 'nats_commission_exported', 'earning', v_commission_event_id::text,
      jsonb_build_object('status', 'exported'),
      jsonb_build_object('commission_platform', 'nats')
    );
  end if;
  return v_commission_event_id is not null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.confirm_deal_redemption_from_nfc(p_token text, p_tag_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_redemption public.qr_redemptions;
  v_deal public.club_deals;
  v_venue public.venues;
  v_tag public.nfc_tags;
  v_referral_term public.venue_referral_fee_terms;
  v_month date;
  v_success_number integer;
  v_share_bps integer := 0;
  v_gross_cents integer := 0;
  v_dancer_cents integer := 0;
  v_agent_cents integer := 0;
  v_agent_allocations jsonb;
  v_platform_cents integer := 0;
  v_revenue_id uuid;
  v_attribution_id uuid;
  v_nats_activated_at timestamptz;
  v_policy_version constant text := 'nats-enrolled-dancer-30-40-50+sales-agent-v2';
begin
  select * into v_tag from public.nfc_tags where id = p_tag_id for update;
  if not found or v_tag.status <> 'active' or v_tag.tag_type <> 'cashier' then
    raise exception using errcode = '42501', message = 'This cashier NFC tag is inactive.';
  end if;

  select redemption.* into v_redemption
  from public.qr_redemptions redemption
  where redemption.redemption_token = p_token
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Club Deal redemption not found.';
  end if;

  if v_redemption.source_type = 'dancer_profile' then
    perform pg_advisory_xact_lock(hashtext(v_redemption.dancer_id::text), hashtext('nats-dancer-enrollment'));
    v_now := clock_timestamp();
    select account.activated_at into v_nats_activated_at
    from public.nats_affiliate_accounts account
    where account.dancer_id = v_redemption.dancer_id
      and account.status = 'active' and account.activated_at <= v_now;
  end if;

  select * into v_deal from public.club_deals where id = v_redemption.club_deal_id;
  select venue.* into v_venue
  from public.venues venue
  join public.app_users account on account.id = venue.owner_user_id
  where venue.id = v_tag.venue_id and venue.is_active = true
    and account.role = 'venue' and account.account_state = 'active';
  if not found or v_redemption.venue_id <> v_tag.venue_id then
    raise exception using errcode = '42501', message = 'This Club Deal belongs to a different venue.';
  end if;
  if not v_deal.is_active or v_deal.venue_id <> v_tag.venue_id then
    raise exception using errcode = '22023', message = 'This Club Deal is no longer active.';
  end if;
  if v_redemption.status = 'redeemed' then
    raise exception using errcode = '23505', message = 'This Club Deal was already redeemed.';
  end if;
  if v_redemption.status in ('voided', 'expired') or v_redemption.expires_at <= v_now then
    update public.qr_redemptions set status = 'expired'
    where id = v_redemption.id and status = 'generated';
    raise exception using errcode = '22023', message = 'This Club Deal is no longer valid.';
  end if;

  select term.* into v_referral_term
  from public.venue_referral_fee_terms term
  where term.venue_id = v_redemption.venue_id
    and term.superseded_at is null
    and term.effective_from <= v_now
    and (term.effective_until is null or term.effective_until > v_now)
  order by term.effective_from desc limit 1;
  if not found then
    raise exception using errcode = '22023', message = 'This venue does not have an active MyDancr referral fee agreement.';
  end if;

  if v_redemption.source_type = 'dancer_profile'
    and (v_redemption.dancer_id is null or v_redemption.shift_id is null) then
    raise exception using errcode = '22023', message = 'Dancer attribution is incomplete for this Club Deal.';
  end if;
  if exists (
    select 1 from public.qr_redemptions previous
    where previous.id <> v_redemption.id
      and previous.club_deal_id = v_redemption.club_deal_id
      and previous.venue_id = v_redemption.venue_id
      and previous.status = 'redeemed'
      and previous.redeemed_at >= v_now - interval '24 hours'
      and (
        (v_redemption.customer_id is not null and previous.customer_id = v_redemption.customer_id)
        or (v_redemption.customer_id is null and v_redemption.session_id is not null
          and previous.session_id = v_redemption.session_id)
      )
  ) then
    raise exception using errcode = '23505', message = 'This Club Deal has already been used in the last 24 hours.';
  end if;

  v_month := date_trunc('month', timezone(coalesce(nullif(v_venue.timezone, ''), 'UTC'), v_now))::date;
  v_gross_cents := v_referral_term.fee_cents;
  if v_nats_activated_at is not null then
    perform pg_advisory_xact_lock(hashtext(v_redemption.dancer_id::text), hashtext(v_month::text));
    select count(*)::integer + 1 into v_success_number
    from public.deal_revenue_events revenue
    where revenue.dancer_id = v_redemption.dancer_id
      and revenue.commission_month = v_month
      and revenue.dancer_commission_eligible
      and revenue.status not in ('refunded', 'voided');
    v_share_bps := case
      when v_success_number >= 25 then 5000
      when v_success_number >= 10 then 4000
      else 3000
    end;
    v_dancer_cents := round(v_gross_cents * v_share_bps / 10000.0)::integer;
  else
    v_success_number := null;
  end if;

  -- Capture the total, recipients and attribution in one statement snapshot.
  -- The STABLE allocation helper uses that same snapshot. Later writes must
  -- consume these captured rows even if agent eligibility changes meanwhile.
  select coalesce(sum(allocation.amount_cents), 0)::integer,
    coalesce(jsonb_agg(to_jsonb(allocation)
      order by allocation.sponsor_level, allocation.recipient_agent_id), '[]'::jsonb),
    (
      select attribution.id
      from public.venue_sales_attributions attribution
      where attribution.venue_id = v_redemption.venue_id
        and attribution.effective_from <= v_now
        and (attribution.superseded_at is null or attribution.superseded_at > v_now)
      order by attribution.effective_from desc limit 1
    )
  into v_agent_cents, v_agent_allocations, v_attribution_id
  from public.agent_allocations_for_venue(v_redemption.venue_id, v_gross_cents, v_now) allocation;

  v_platform_cents := v_gross_cents - v_dancer_cents - v_agent_cents;
  if v_platform_cents < 0 then
    raise exception using errcode = '22023', message = 'Commission allocations exceed the venue referral fee.';
  end if;

  update public.qr_redemptions set
    status = 'redeemed', redeemed_at = v_now, confirmed_at = v_now,
    first_scanned_at = coalesce(first_scanned_at, v_now), nfc_tag_id = v_tag.id,
    audit = coalesce(audit, '{}'::jsonb)
      || jsonb_build_object('nfc_confirmed', p_audit, 'nfc_tag_id', v_tag.id)
  where id = v_redemption.id;

  insert into public.qr_redemption_events (qr_redemption_id, event_type, session_id, audit)
  values (v_redemption.id, 'venue_confirmed', p_session_id::text,
    p_audit || jsonb_build_object('method', 'nfc', 'tagId', v_tag.id));

  insert into public.deal_revenue_events (
    qr_redemption_id, venue_id, club_deal_id, dancer_id, source_type, currency,
    gross_commission_cents, dancer_share_bps, dancer_commission_cents,
    agent_commission_cents, platform_commission_cents, venue_sales_attribution_id,
    successful_redemption_number, commission_month, policy_version, audit, confirmed_at,
    dancer_commission_eligible, dancer_nats_activated_at
  ) values (
    v_redemption.id, v_redemption.venue_id, v_redemption.club_deal_id,
    v_redemption.dancer_id, v_redemption.source_type, v_referral_term.currency,
    v_gross_cents, v_share_bps, v_dancer_cents,
    v_agent_cents, v_platform_cents, v_attribution_id,
    v_success_number, v_month, v_policy_version,
    jsonb_build_object(
      'source', 'cashier_nfc_tap', 'nfc_tag_id', v_tag.id,
      'shift_id', v_redemption.shift_id,
      'referral_fee_term_id', v_referral_term.id,
      'agreement_reference', v_referral_term.agreement_reference,
      'sales_agent_policy', 'direct-15_l1-3_l2-2.5_l3-2_l4-1.5_l5-1',
      'dancer_commission_reason', case when v_nats_activated_at is not null
        then 'enrolled_at_redemption' else 'not_enrolled_in_nats' end
    ), v_now, v_nats_activated_at is not null, v_nats_activated_at
  ) returning id into v_revenue_id;

  insert into public.agent_commission_events (
    deal_revenue_event_id, qr_redemption_id, venue_id, venue_sales_attribution_id,
    recipient_agent_id, signing_agent_id, sponsor_level, share_bps,
    amount_cents, currency, commission_month, audit
  )
  select v_revenue_id, v_redemption.id, v_redemption.venue_id,
    allocation.venue_sales_attribution_id, allocation.recipient_agent_id,
    allocation.signing_agent_id, allocation.sponsor_level, allocation.share_bps,
    allocation.amount_cents, lower(v_referral_term.currency), v_month,
    jsonb_build_object('source', 'verified_cashier_nfc', 'nfc_tag_id', v_tag.id)
  from jsonb_to_recordset(v_agent_allocations) as allocation(
    venue_sales_attribution_id uuid, signing_agent_id uuid, recipient_agent_id uuid,
    sponsor_level smallint, share_bps integer, amount_cents integer
  );

  if v_nats_activated_at is not null and v_dancer_cents > 0 then
    insert into public.commission_events (
      qr_redemption_id, venue_id, club_deal_id, dancer_id, status, amount_cents,
      payout_type, gross_commission_cents, dancer_share_bps, platform_amount_cents,
      successful_redemption_number, commission_month, currency, policy_version, audit
    ) values (
      v_redemption.id, v_redemption.venue_id, v_redemption.club_deal_id,
      v_redemption.dancer_id, 'pending_club_payment', v_dancer_cents, 'flat',
      v_gross_cents, v_share_bps, v_platform_cents, v_success_number, v_month,
      lower(v_referral_term.currency), v_policy_version,
      jsonb_build_object(
        'source', 'deal_revenue_event', 'deal_revenue_event_id', v_revenue_id,
        'nfc_tag_id', v_tag.id, 'referral_fee_term_id', v_referral_term.id,
        'agent_commission_cents', v_agent_cents
      )
    );
  end if;

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_tag.venue_id, v_tag.tag_type, 'deal_redeemed', v_redemption.customer_id,
    p_session_id, p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object('redemptionId', v_redemption.id,
      'dealId', v_deal.id, 'revenueEventId', v_revenue_id)
  );
  update public.nfc_tags
  set last_tapped_at = v_now, tap_count = tap_count + 1, updated_at = v_now
  where id = v_tag.id;

  return jsonb_build_object(
    'redemptionId', v_redemption.id, 'revenueEventId', v_revenue_id,
    'dealTitle', v_deal.deal_title, 'venueName', v_venue.name,
    'sourceType', v_redemption.source_type,
    'grossCommissionCents', v_gross_cents,
    'dancerCommissionEligible', v_nats_activated_at is not null,
    'dancerShareBps', v_share_bps,
    'dancerCommissionCents', v_dancer_cents,
    'agentCommissionCents', v_agent_cents,
    'platformCommissionCents', v_platform_cents,
    'successfulRedemptionNumber', v_success_number,
    'referralFeeTermId', v_referral_term.id, 'status', 'redeemed'
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.confirm_deal_redemption_with_financial_details(p_token text, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_redemption public.qr_redemptions%rowtype;
  v_deal public.club_deals%rowtype;
  v_venue public.venues%rowtype;
  v_month date;
  v_success_number integer;
  v_share_bps integer := 0;
  v_gross_cents integer := 0;
  v_dancer_cents integer := 0;
  v_platform_cents integer := 0;
  v_revenue_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Active venue account required.';
  end if;

  select redemption.*
    into v_redemption
  from public.qr_redemptions redemption
  where redemption.redemption_token = p_token
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'QR code not found.';
  end if;

  select deal.*
    into v_deal
  from public.club_deals deal
  where deal.id = v_redemption.club_deal_id;

  select venue.*
    into v_venue
  from public.venues venue
  join public.app_users account on account.id = venue.owner_user_id
  where venue.id = v_redemption.venue_id
    and venue.owner_user_id = v_user_id
    and venue.is_active = true
    and account.role = 'venue'
    and account.account_state = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'This venue account cannot redeem that QR code.';
  end if;

  if not v_deal.is_active then
    raise exception using errcode = '22023', message = 'This deal is no longer active.';
  end if;

  if v_deal.venue_id <> v_redemption.venue_id then
    raise exception using errcode = '22023', message = 'This deal does not belong to the redemption venue.';
  end if;

  if v_redemption.status = 'redeemed' then
    raise exception using errcode = '23505', message = 'This QR code was already redeemed.';
  end if;

  if v_redemption.status in ('voided', 'expired') then
    raise exception using errcode = '22023', message = 'This QR code is no longer valid.';
  end if;

  if v_redemption.expires_at <= v_now then
    update public.qr_redemptions
    set status = 'expired'
    where id = v_redemption.id;

    insert into public.qr_redemption_events (
      qr_redemption_id,
      event_type,
      actor_user_id,
      audit
    )
    values (v_redemption.id, 'expired', v_user_id, p_audit);

    return jsonb_build_object(
      'ok', false,
      'status', 400,
      'error', 'This QR code has expired.'
    );
  end if;

  if v_deal.payout_type <> 'flat' or v_deal.payout_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'This venue has not configured a referral commission.';
  end if;

  if v_redemption.source_type = 'dancer_profile'
    and (v_redemption.dancer_id is null or v_redemption.shift_id is null) then
    raise exception using errcode = '22023', message = 'Dancer attribution is incomplete for this QR code.';
  end if;

  v_month := date_trunc(
    'month',
    timezone(coalesce(nullif(v_venue.timezone, ''), 'UTC'), v_now)
  )::date;
  v_gross_cents := v_deal.payout_amount_cents;

  if v_redemption.source_type = 'dancer_profile' then
    -- Different QR tokens for one dancer may be confirmed concurrently. Serialize
    -- the monthly counter so tier boundaries and successful redemption numbers
    -- remain exact under load.
    perform pg_advisory_xact_lock(
      hashtext(v_redemption.dancer_id::text),
      hashtext(v_month::text)
    );

    select count(*)::integer + 1
      into v_success_number
    from public.deal_revenue_events revenue
    where revenue.dancer_id = v_redemption.dancer_id
      and revenue.commission_month = v_month
      and revenue.status not in ('refunded', 'voided');

    v_share_bps := case
      when v_success_number >= 75 then 5000
      when v_success_number >= 25 then 4000
      else 3000
    end;
    v_dancer_cents := round(v_gross_cents * v_share_bps / 10000.0)::integer;
  else
    v_success_number := null;
    v_share_bps := 0;
    v_dancer_cents := 0;
  end if;

  v_platform_cents := v_gross_cents - v_dancer_cents;

  update public.qr_redemptions
  set
    status = 'redeemed',
    redeemed_at = v_now,
    confirmed_at = v_now,
    redeemed_by_club_user = v_user_id,
    first_scanned_at = coalesce(first_scanned_at, v_now),
    audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object('venue_confirmed', p_audit)
  where id = v_redemption.id;

  insert into public.qr_redemption_events (
    qr_redemption_id,
    event_type,
    actor_user_id,
    audit
  )
  values (v_redemption.id, 'venue_confirmed', v_user_id, p_audit);

  insert into public.deal_revenue_events (
    qr_redemption_id,
    venue_id,
    club_deal_id,
    dancer_id,
    source_type,
    currency,
    gross_commission_cents,
    dancer_share_bps,
    dancer_commission_cents,
    platform_commission_cents,
    successful_redemption_number,
    commission_month,
    policy_version,
    audit,
    confirmed_at
  )
  values (
    v_redemption.id,
    v_redemption.venue_id,
    v_redemption.club_deal_id,
    v_redemption.dancer_id,
    v_redemption.source_type,
    v_deal.currency,
    v_gross_cents,
    v_share_bps,
    v_dancer_cents,
    v_platform_cents,
    v_success_number,
    v_month,
    'monthly-tier-v1',
    jsonb_build_object(
      'source', 'authenticated_venue_confirmation',
      'venue_user_id', v_user_id,
      'shift_id', v_redemption.shift_id
    ),
    v_now
  )
  returning id into v_revenue_id;

  if v_redemption.source_type = 'dancer_profile' then
    insert into public.commission_events (
      qr_redemption_id,
      venue_id,
      club_deal_id,
      dancer_id,
      status,
      amount_cents,
      payout_type,
      gross_commission_cents,
      dancer_share_bps,
      platform_amount_cents,
      successful_redemption_number,
      commission_month,
      currency,
      policy_version,
      audit
    )
    values (
      v_redemption.id,
      v_redemption.venue_id,
      v_redemption.club_deal_id,
      v_redemption.dancer_id,
      'pending_club_payment',
      v_dancer_cents,
      'flat',
      v_gross_cents,
      v_share_bps,
      v_platform_cents,
      v_success_number,
      v_month,
      v_deal.currency,
      'monthly-tier-v1',
      jsonb_build_object(
        'source', 'deal_revenue_event',
        'deal_revenue_event_id', v_revenue_id,
        'venue_user_id', v_user_id
      )
    );
  end if;

  return jsonb_build_object(
    'redemption_id', v_redemption.id,
    'revenue_event_id', v_revenue_id,
    'source_type', v_redemption.source_type,
    'gross_commission_cents', v_gross_cents,
    'dancer_share_bps', v_share_bps,
    'dancer_commission_cents', v_dancer_cents,
    'platform_commission_cents', v_platform_cents,
    'successful_redemption_number', v_success_number,
    'commission_month', v_month,
    'status', 'redeemed'
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.confirm_deal_redemption(p_token text, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_result jsonb;
begin
  v_result := public.confirm_deal_redemption_with_financial_details(p_token, p_audit);

  if coalesce((v_result ->> 'ok')::boolean, true) = false then
    return jsonb_build_object(
      'ok', false,
      'status', coalesce((v_result ->> 'status')::integer, 400),
      'error', coalesce(v_result ->> 'error', 'Unable to redeem this QR code.')
    );
  end if;

  return jsonb_build_object(
    'redemption_id', v_result ->> 'redemption_id',
    'revenue_event_id', v_result ->> 'revenue_event_id',
    'source_type', v_result ->> 'source_type',
    'status', v_result ->> 'status'
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.confirm_dmca_counter_forwarding(p_counter_id uuid, p_case_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
 v_case public.dmca_cases%rowtype;
 v_counter public.dmca_counter_notices%rowtype;
 v_now timestamptz;
begin
 if p_counter_id is null or p_case_id is null then raise exception 'INVALID_COUNTER_FORWARDING_IDENTITY' using errcode='22023';end if;
 select * into v_case from public.dmca_cases where id=p_case_id for update;
 if not found then raise exception 'COUNTER_FORWARDING_CASE_MISSING' using errcode='P0002';end if;
 select * into v_counter from public.dmca_counter_notices where id=p_counter_id and case_id=p_case_id for update;
 if not found or v_counter.uploader_id is distinct from v_case.uploader_id then raise exception 'COUNTER_FORWARDING_IDENTITY_CHANGED' using errcode='40001';end if;
 v_now:=clock_timestamp();
 if v_counter.status in('forwarded','completed') and v_counter.forwarded_to_claimant_at is not null
   and isfinite(v_counter.forwarded_to_claimant_at) and v_counter.forwarded_to_claimant_at<=v_now then
  return jsonb_build_object('id',v_counter.id,'case_id',v_counter.case_id,'status',v_counter.status,'forwarded_to_claimant_at',v_counter.forwarded_to_claimant_at);
 end if;
 if v_case.status not in('countered','court_hold','closed') or v_counter.status<>'submitted' or v_counter.forwarded_to_claimant_at is not null then
  raise exception 'COUNTER_FORWARDING_STATE_CHANGED' using errcode='40001';
 end if;
 update public.dmca_counter_notices set status='forwarded',forwarded_to_claimant_at=v_now,updated_at=v_now
  where id=p_counter_id and case_id=p_case_id and status='submitted' and forwarded_to_claimant_at is null returning * into v_counter;
 if not found or v_counter.id is distinct from p_counter_id or v_counter.case_id is distinct from p_case_id
  or v_counter.uploader_id is distinct from v_case.uploader_id or v_counter.status<>'forwarded'
  or v_counter.forwarded_to_claimant_at is distinct from v_now or v_counter.updated_at is distinct from v_now then
  raise exception 'COUNTER_FORWARDING_WRITE_UNCONFIRMED' using errcode='40001';
 end if;
 return jsonb_build_object('id',v_counter.id,'case_id',v_counter.case_id,'status',v_counter.status,'forwarded_to_claimant_at',v_counter.forwarded_to_claimant_at);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.confirm_venue_request_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.email_confirmed_at is not null then
    update public.venue_signup_requests set status='pending'
      where requester_user_id=new.id and status='awaiting_email_confirmation';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.consume_request_rate_limit(p_namespace text, p_ip_hash uuid, p_subject_hash uuid, p_window_seconds integer, p_ip_limit integer, p_subject_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval;
  v_ip_count integer;
  v_subject_count integer;
  v_ip_expires_at timestamptz;
  v_subject_expires_at timestamptz;
  v_allowed boolean;
  v_retry_after integer;
begin
  if p_namespace !~ '^[a-z0-9_]{1,40}$'
     or p_window_seconds < 60
     or p_window_seconds > 86400
     or p_ip_limit < 1
     or p_subject_limit < 1 then
    raise exception using errcode = '22023', message = 'Invalid request rate limit configuration.';
  end if;

  v_window := make_interval(secs => p_window_seconds);

  insert into public.request_rate_limit_buckets as bucket (
    namespace,
    key_type,
    key_hash,
    window_started_at,
    request_count,
    expires_at
  ) values (
    p_namespace,
    'ip',
    p_ip_hash,
    v_now,
    1,
    v_now + v_window
  )
  on conflict (namespace, key_type, key_hash) do update
  set window_started_at = case
        when bucket.expires_at <= v_now then v_now
        else bucket.window_started_at
      end,
      request_count = case
        when bucket.expires_at <= v_now then 1
        else bucket.request_count + 1
      end,
      expires_at = case
        when bucket.expires_at <= v_now then v_now + v_window
        else bucket.expires_at
      end
  returning request_count, expires_at into v_ip_count, v_ip_expires_at;

  insert into public.request_rate_limit_buckets as bucket (
    namespace,
    key_type,
    key_hash,
    window_started_at,
    request_count,
    expires_at
  ) values (
    p_namespace,
    'subject',
    p_subject_hash,
    v_now,
    1,
    v_now + v_window
  )
  on conflict (namespace, key_type, key_hash) do update
  set window_started_at = case
        when bucket.expires_at <= v_now then v_now
        else bucket.window_started_at
      end,
      request_count = case
        when bucket.expires_at <= v_now then 1
        else bucket.request_count + 1
      end,
      expires_at = case
        when bucket.expires_at <= v_now then v_now + v_window
        else bucket.expires_at
      end
  returning request_count, expires_at into v_subject_count, v_subject_expires_at;

  v_allowed := v_ip_count <= p_ip_limit and v_subject_count <= p_subject_limit;
  v_retry_after := case
    when v_allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from greatest(v_ip_expires_at, v_subject_expires_at) - v_now))::integer
    )
  end;

  return jsonb_build_object(
    'allowed', v_allowed,
    'retry_after_seconds', v_retry_after
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_club_invoice_draft(p_venue_id uuid, p_period_start date, p_period_end date, p_due_at timestamp with time zone, p_revenue_event_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_invoice_id uuid;
  v_sequence integer;
  v_expected integer := coalesce(cardinality(p_revenue_event_ids), 0);
  v_count integer;
  v_amount bigint;
  v_currency text;
  v_currency_count integer;
begin
  if v_expected = 0 or array_ndims(p_revenue_event_ids) <> 1 then
    raise exception using errcode = '22023', message = 'At least one revenue event is required.';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start or p_due_at is null then
    raise exception using errcode = '22023', message = 'A valid invoice period and due date are required.';
  end if;

  -- Serialize sequence allocation even when no invoice exists yet.
  perform 1 from public.venues where id = p_venue_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Invoice venue not found.';
  end if;

  -- Lock before inspecting eligibility; caller selections are only snapshots.
  perform revenue.id from public.deal_revenue_events revenue
  where revenue.id = any(p_revenue_event_ids)
  order by revenue.id for update;

  select count(*)::integer, coalesce(sum(revenue.gross_commission_cents), 0)::bigint,
         min(revenue.currency), count(distinct revenue.currency)::integer
    into v_count, v_amount, v_currency, v_currency_count
  from public.deal_revenue_events revenue
  where revenue.id = any(p_revenue_event_ids)
    and revenue.venue_id = p_venue_id
    and revenue.status = 'pending_venue_payment'
    and revenue.club_invoice_id is null
    and not exists (select 1 from public.club_invoice_items item where item.revenue_event_id = revenue.id);

  if v_count <> v_expected or v_amount <= 0 or v_amount > 2147483647 or v_currency_count <> 1 then
    raise exception using errcode = '22023', message = 'Revenue events are no longer invoiceable.';
  end if;

  select coalesce(max(invoice.sequence), 0) + 1 into v_sequence
  from public.club_invoices invoice
  where invoice.venue_id = p_venue_id
    and invoice.period_start = p_period_start
    and invoice.period_end = p_period_end;

  insert into public.club_invoices (
    venue_id, period_start, period_end, sequence, currency, amount_due_cents, due_at
  ) values (
    p_venue_id, p_period_start, p_period_end, v_sequence, v_currency, v_amount::integer, p_due_at
  ) returning id into v_invoice_id;
  if v_invoice_id is null then
    raise exception using errcode = '40001', message = 'Invoice creation could not be confirmed.';
  end if;

  insert into public.club_invoice_items (invoice_id, revenue_event_id, amount_cents)
  select v_invoice_id, revenue.id, revenue.gross_commission_cents
  from public.deal_revenue_events revenue
  where revenue.id = any(p_revenue_event_ids);
  get diagnostics v_count = row_count;
  if v_count <> v_expected then
    raise exception using errcode = '40001', message = 'Invoice items could not be confirmed.';
  end if;

  update public.deal_revenue_events
  set club_invoice_id = v_invoice_id
  where id = any(p_revenue_event_ids)
    and status = 'pending_venue_payment' and club_invoice_id is null;
  get diagnostics v_count = row_count;
  if v_count <> v_expected then
    raise exception using errcode = '40001', message = 'Invoice revenue assignment could not be confirmed.';
  end if;

  select count(*)::integer, coalesce(sum(item.amount_cents), 0)::bigint into v_count, v_amount
  from public.club_invoice_items item
  join public.deal_revenue_events revenue on revenue.id = item.revenue_event_id
  where item.invoice_id = v_invoice_id and revenue.id = any(p_revenue_event_ids)
    and revenue.club_invoice_id = v_invoice_id and revenue.venue_id = p_venue_id
    and revenue.status = 'pending_venue_payment' and revenue.currency = v_currency
    and revenue.gross_commission_cents = item.amount_cents;
  if v_count <> v_expected
    or (select count(*) from public.club_invoice_items where invoice_id = v_invoice_id) <> v_expected
    or not exists (
    select 1 from public.club_invoices invoice where invoice.id = v_invoice_id
      and invoice.venue_id = p_venue_id and invoice.amount_due_cents = v_amount
      and invoice.currency = v_currency and invoice.status = 'draft'
      and invoice.period_start = p_period_start and invoice.period_end = p_period_end
      and invoice.due_at = p_due_at and invoice.sequence = v_sequence
  ) then
    raise exception using errcode = '40001', message = 'Invoice totals and revenue could not be confirmed.';
  end if;
  return v_invoice_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_dancer_avatar_review(p_user_id uuid, p_profile_id uuid, p_expected_avatar_path text, p_expected_avatar_updated_at timestamp with time zone, p_temporary_storage_path text, p_idempotency_key text, p_provider_model text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_record public.image_moderation_records%rowtype;
  v_prefix text;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'AVATAR_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_user_id is null or p_profile_id is null or p_temporary_storage_path is null
    or length(p_temporary_storage_path)>1024 or p_temporary_storage_path<>btrim(p_temporary_storage_path)
    or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 256
    or p_provider_model is null or length(p_provider_model) not between 1 and 128
    or (p_expected_avatar_updated_at is not null and not isfinite(p_expected_avatar_updated_at)) then
    raise exception 'AVATAR_INVALID_INPUT' using errcode='22023';
  end if;
  select * into v_account from public.app_users where id=p_user_id for update;
  if not found or v_account.role is distinct from 'dancer' or v_account.account_state is distinct from 'active' or v_account.dmca_suspended_at is not null then
    raise exception 'AVATAR_ACCOUNT_UNAVAILABLE' using errcode='42501';
  end if;
  select * into v_profile from public.dancer_profiles where id=p_profile_id and user_id=p_user_id for update;
  if not found then raise exception 'AVATAR_PROFILE_UNAVAILABLE' using errcode='42501';end if;
  if exists(select 1 from public.image_moderation_records where user_id=p_user_id and idempotency_key=p_idempotency_key) then
    raise exception 'AVATAR_REVIEW_ALREADY_EXISTS' using errcode='23505';
  end if;
  if v_profile.avatar_storage_path is distinct from p_expected_avatar_path
    or v_profile.avatar_updated_at is distinct from p_expected_avatar_updated_at then
    raise exception 'AVATAR_CHANGED' using errcode='40001';
  end if;
  v_prefix:=p_user_id::text || '/' || p_profile_id::text || '/';
  if left(p_temporary_storage_path,length(v_prefix))<>v_prefix
    or p_temporary_storage_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'AVATAR_STORAGE_OWNER_MISMATCH' using errcode='42501';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='dancr-image-moderation-temp' and name=p_temporary_storage_path) then
    raise exception 'AVATAR_SOURCE_MISSING' using errcode='P0002';
  end if;
  -- Reserving intent changes only the version. Keep the currently displayed avatar.
  update public.dancer_profiles set avatar_updated_at=clock_timestamp()
    where id=p_profile_id returning * into v_profile;
  insert into public.image_moderation_records(user_id,temporary_storage_path,upload_context,
    provider,provider_model,provider_flagged,decision,status,reason_codes,category_flags,category_scores,
    idempotency_key,photo_publication_mode,replacement_photo_id,attempt_count,
    avatar_expected_path,avatar_expected_updated_at)
  values(p_user_id,p_temporary_storage_path,'profile_avatar','openai',p_provider_model,false,'review','moderating',
    '[]','{}','{}',p_idempotency_key,'legacy',null,1,v_profile.avatar_storage_path,v_profile.avatar_updated_at)
  returning * into v_record;
  return jsonb_build_object('profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
    'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
    'record',to_jsonb(v_record));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_dancer_payout_batch(p_dancer_id uuid, p_currency text, p_commission_event_ids uuid[], p_payment_provider text DEFAULT 'stripe'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_count integer;
  v_amount bigint;
  v_settings public.payout_settings%rowtype;
  v_account public.dancer_payout_accounts%rowtype;
begin
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other') then
    raise exception using errcode = '22023', message = 'Unsupported payout provider.';
  end if;
  if lower(p_currency) <> 'usd' then
    raise exception using errcode = '22023', message = 'Only USD payouts are currently supported.';
  end if;
  select * into v_settings from public.payout_settings where id = 'default' for share;
  if v_settings.payout_mode not in ('scheduled', 'both') then
    raise exception using errcode = '22023', message = 'Scheduled payouts are not enabled.';
  end if;
  select * into v_account from public.dancer_payout_accounts
  where dancer_id = p_dancer_id and payment_provider = p_payment_provider;
  if not found or v_account.onboarding_status <> 'complete'
    or v_account.payout_eligibility <> 'eligible'
    or v_account.verification_status <> 'verified'
  then
    raise exception using errcode = '22023', message = 'Payout setup and verification must be completed first.';
  end if;
  with locked_earnings as (
    select id, amount_cents
    from public.commission_events
    where id = any(p_commission_event_ids) and dancer_id = p_dancer_id
      and status = 'available' and payout_batch_id is null and currency = lower(p_currency)
      and held_at is null and review_flag is null
    order by created_at, id
    for update
  )
  select count(*)::integer, coalesce(sum(amount_cents), 0)::bigint into v_count, v_amount
  from locked_earnings;
  if v_count <> coalesce(array_length(p_commission_event_ids, 1), 0)
    or v_amount < v_settings.minimum_payout_cents
  then
    raise exception using errcode = '22023', message = 'Earnings are no longer available.';
  end if;
  insert into public.dancer_payout_batches (dancer_id, status, currency, amount_cents, payment_provider, requested_at)
  values (p_dancer_id, 'requested', lower(p_currency), v_amount::integer, p_payment_provider, now()) returning id into v_id;
  insert into public.dancer_payout_items (payout_batch_id, commission_event_id, amount_cents)
  select v_id, id, amount_cents from public.commission_events where id = any(p_commission_event_ids);
  update public.commission_events set status = 'payout_processing', payout_batch_id = v_id
  where id = any(p_commission_event_ids) and status = 'available'
    and payout_batch_id is null and held_at is null and review_flag is null;
  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_support_message_safely(p_user_id uuid, p_role text, p_thread_id uuid, p_subject text, p_body text, p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_message_id uuid := coalesce(p_message_id,gen_random_uuid()); v_thread public.support_threads%rowtype; v_existing public.support_messages%rowtype; v_duplicate boolean := false; v_subject text := coalesce(nullif(trim(p_subject),''),'Message to admin'); v_body text := trim(p_body); v_count integer; v_notifications jsonb := '[]'::jsonb;
begin
 if p_user_id is null or p_role is null or p_role not in ('customer','dancer','venue','admin') or not exists(select 1 from public.app_users where id=p_user_id and role::text=p_role and account_state='active') then raise exception using errcode='42501',message='Active support account required.'; end if;
 if p_role='admin' and p_thread_id is null then raise exception using errcode='22023',message='An existing thread is required.'; end if;
 if v_body is null or length(v_body)<1 or length(v_body)>4000 or length(v_subject)>160 then raise exception using errcode='22023',message='Invalid support message.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('support:'||p_user_id::text,0));
 select * into v_existing from public.support_messages where id=v_message_id;
 if found then
 if v_existing.sender_id is distinct from p_user_id or v_existing.body is distinct from v_body or v_existing.sender_role::text is distinct from p_role or (p_thread_id is not null and v_existing.thread_id<>p_thread_id) then raise exception using errcode='22023',message='Message request ID already has different content.'; end if;
 select * into v_thread from public.support_threads where id=v_existing.thread_id and (p_role='admin' or user_id=p_user_id);
 if not found then raise exception using errcode='42501',message='Support thread not found.'; end if;
 v_duplicate := true;
 else
 select count(*) into v_count from public.support_messages where sender_id=p_user_id and sender_kind='human' and created_at>=now()-interval '60 seconds';
 if v_count>=12 then raise exception using errcode='P0001',message='Support message rate limit reached.'; end if;
 if p_thread_id is not null then
 select * into v_thread from public.support_threads where id=p_thread_id and (p_role='admin' or user_id=p_user_id) for update;
 if not found then raise exception using errcode='42501',message='Support thread not found.'; end if;
 else
 insert into public.support_threads(user_id,user_role,subject,status,last_message_at) values(p_user_id,p_role::public.user_role,v_subject,'open',now()) returning * into v_thread;
 end if;
 insert into public.support_messages(id,thread_id,sender_id,sender_role,sender_kind,body) values(v_message_id,v_thread.id,p_user_id,p_role::public.user_role,'human',v_body);
 update public.support_threads set status=case when p_role='admin' then 'answered' else 'open' end,assigned_admin_id=case when p_role='admin' then p_user_id else assigned_admin_id end,last_message_at=now(),updated_at=now() where id=v_thread.id and (p_role='admin' or user_id=p_user_id) returning * into v_thread;
 if p_role='admin' then
 with inserted as (insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at) values(v_thread.user_id,'support_message','in_app','Admin replied',case when length(v_body)>140 then left(v_body,137)||'...' else v_body end,jsonb_build_object('threadId',v_thread.id,'subject',v_thread.subject),now()) returning *) select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) into v_notifications from inserted i;
 else
 with inserted as (insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at) select a.id,'support_message','in_app','New '||p_role||' support message',left(v_subject||': '||v_body,500),jsonb_build_object('threadId',v_thread.id,'userRole',p_role),now() from public.app_users a where a.role='admin' and a.account_state='active' returning *) select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) into v_notifications from inserted i;
 end if;
 end if;
 return jsonb_build_object('duplicate',v_duplicate,'notifications',v_notifications,'thread',to_jsonb(v_thread)||jsonb_build_object('app_users',case when p_role='admin' then (select jsonb_build_object('display_name',a.display_name,'email',a.email,'role',a.role) from public.app_users a where a.id=v_thread.user_id) else null end,'support_messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (select * from public.support_messages where thread_id=v_thread.id order by created_at desc,id desc limit 1000) m),'[]'::jsonb)));
end; $function$
;
CREATE OR REPLACE FUNCTION public.create_venue_default_club_deal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.club_deals (
    venue_id,
    deal_title,
    deal_description,
    deal_terms,
    is_active,
    redemption_rules,
    payout_type,
    payout_amount_cents,
    currency
  )
  values (
    new.id,
    'Tonight''s venue offer',
    'Show your unique MyDancr QR to venue staff for the active offer.',
    'Offer is subject to venue availability and house rules.',
    false,
    jsonb_build_object(
      'one_per_guest', true,
      'authenticated_venue_confirmation_required', true,
      'attribution_policy', 'locked_at_issue',
      'commission_policy', 'monthly-tier-v1'
    ),
    'flat',
    0,
    'usd'
  )
  on conflict do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_venue_nfc_support_safely(p_user_id uuid, p_venue_id uuid, p_tag_id uuid, p_request_type text, p_notes text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_owner uuid;
  v_venue_name text;
  v_label text;
  v_tag_type text;
  v_notes text := nullif(btrim(coalesce(p_notes,'')),'');
  v_request public.venue_nfc_support_requests%rowtype;
  v_thread_id uuid;
  v_support jsonb;
  v_body text;
begin
  if p_user_id is null or p_venue_id is null or p_tag_id is null or p_request_id is null
    or p_request_type is null or p_request_type not in ('damaged','lost','relocate','replacement')
    or char_length(v_notes)>1000 then
    raise exception 'INVALID_NFC_SUPPORT_REQUEST' using errcode='22023';
  end if;

  select owner_user_id into v_owner from public.venues where id=p_venue_id;
  -- Account-before-venue locking avoids reversing account lifecycle lock order.
  perform a.id from public.app_users a where a.id in (p_user_id,v_owner) order by a.id for share;
  if not exists(select 1 from public.app_users where id=p_user_id and role='venue' and account_state='active')
    or not exists(select 1 from public.app_users where id=v_owner and account_state='active') then
    raise exception 'NFC_SUPPORT_FORBIDDEN' using errcode='42501';
  end if;
  select name into v_venue_name from public.venues
    where id=p_venue_id and owner_user_id=v_owner for share;
  if not found then raise exception 'NFC_SUPPORT_FORBIDDEN' using errcode='42501'; end if;
  if v_owner<>p_user_id then
    perform id from public.venue_team_members where venue_id=p_venue_id and user_id=p_user_id
      and status='active' and role in ('manager','staff') for share;
    if not found then raise exception 'NFC_SUPPORT_FORBIDDEN' using errcode='42501'; end if;
  end if;
  select label,tag_type::text into v_label,v_tag_type from public.nfc_tags
    where id=p_tag_id and venue_id=p_venue_id for share;
  if not found then raise exception 'NFC_SUPPORT_TAG_NOT_FOUND' using errcode='P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended('nfc-support:'||p_request_id::text,0));
  select * into v_request from public.venue_nfc_support_requests where id=p_request_id for update;
  if found then
    if v_request.requested_by_user_id is distinct from p_user_id or v_request.venue_id is distinct from p_venue_id
      or v_request.nfc_tag_id is distinct from p_tag_id or v_request.request_type is distinct from p_request_type
      or v_request.notes is distinct from v_notes then
      raise exception 'NFC_SUPPORT_REQUEST_CONFLICT' using errcode='22023';
    end if;
    select t.id into v_thread_id from public.support_messages m join public.support_threads t on t.id=m.thread_id
      where m.id=p_request_id and m.sender_id=p_user_id and m.sender_role='venue'
        and m.sender_kind='human' and t.user_id=p_user_id and t.user_role='venue';
    if not found then raise exception 'NFC_SUPPORT_LINK_UNCONFIRMED' using errcode='40001'; end if;
    return jsonb_build_object('request',to_jsonb(v_request),'threadId',v_thread_id,'notifications','[]'::jsonb,'duplicate',true);
  end if;

  insert into public.venue_nfc_support_requests(id,venue_id,nfc_tag_id,requested_by_user_id,request_type,notes)
    values(p_request_id,p_venue_id,p_tag_id,p_user_id,p_request_type,v_notes) returning * into v_request;
  v_body := v_venue_name||' requested '||p_request_type||' tap-sticker support.'||E'\n'
    ||'Sticker: '||v_label||' ('||replace(v_tag_type,'_',' ')||')'||E'\n'
    ||'Request ID: '||p_request_id::text||E'\n'
    ||case when v_notes is null then 'Notes: None provided.' else 'Notes: '||v_notes end;
  v_support := public.create_support_message_safely(p_user_id,'venue',null,
    left('Tap-sticker support · '||v_label,160),v_body,p_request_id);
  select t.id into v_thread_id from public.support_messages m join public.support_threads t on t.id=m.thread_id
    where m.id=p_request_id and m.sender_id=p_user_id and m.sender_role='venue'
      and m.sender_kind='human' and t.user_id=p_user_id and t.user_role='venue';
  if v_thread_id is null or (v_support#>>'{thread,id}')::uuid is distinct from v_thread_id then
    raise exception 'NFC_SUPPORT_MESSAGE_UNCONFIRMED' using errcode='40001';
  end if;
  return jsonb_build_object('request',to_jsonb(v_request),'threadId',v_thread_id,
    'notifications',coalesce(v_support->'notifications','[]'::jsonb),'duplicate',false);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.app_users where id = auth.uid();
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_active_venue_nfc_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  active_tag_count integer;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.venue_id = new.venue_id and old.status = 'active' then
      return new;
    end if;
  end if;
  if current_setting('transaction_isolation') = 'repeatable read' then
    raise exception using errcode = '25000',
      message = 'Active NFC sticker changes require Read Committed or Serializable isolation.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('mydancr:venue-active-nfc-slots:' || new.venue_id::text, 0)
  );
  -- A separate VOLATILE query refreshes Read Committed visibility after waiting.
  select count(*) into active_tag_count
  from public.nfc_tags
  where venue_id = new.venue_id and status = 'active';
  if active_tag_count > 25 then
    raise exception using errcode = '54000',
      message = 'This venue already has the maximum of 25 active NFC stickers.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_available_venue_ownership_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_owner_user_id uuid;
  v_claim_code public.venue_claim_codes;
begin
  select owner_user_id into v_owner_user_id
  from public.venues
  where id = new.venue_id
  for key share;

  if not found then
    raise exception using errcode = '23503', message = 'Venue not found.';
  end if;
  if v_owner_user_id is not null then
    raise exception using errcode = '23505', message = 'This venue is already managed by a verified account.';
  end if;
  if not exists (
    select 1 from public.app_users
    where id = new.claimant_user_id and role = 'venue' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active venue account is required.';
  end if;
  if exists (
    select 1 from public.venues
    where owner_user_id = new.claimant_user_id and id <> new.venue_id
  ) then
    raise exception using errcode = '23505', message = 'This account already manages another venue.';
  end if;

  if new.claim_code_id is null then
    raise exception using errcode = '42501', message = 'A valid venue claim code is required.';
  end if;

  select * into v_claim_code
  from public.venue_claim_codes
  where id = new.claim_code_id
  for update;

  if not found
    or v_claim_code.venue_id <> new.venue_id
    or v_claim_code.expires_at <= now()
    or v_claim_code.used_at is not null
    or v_claim_code.revoked_at is not null
  then
    raise exception using errcode = '42501', message = 'This venue claim code is invalid or no longer active.';
  end if;

  update public.venue_claim_codes
  set used_at = now(), used_by = new.claimant_user_id
  where id = v_claim_code.id;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_mydancr_tv_profile_video_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  current_video_count integer;
begin
  if new.distribution_scope <> 'profile_and_feed'
    or new.status not in ('uploading', 'moderating', 'submitted', 'approved', 'rejected')
  then
    return new;
  end if;

  -- Transitions inside the same occupied slot do not acquire another slot.
  if tg_op = 'UPDATE' then
    if old.dancer_id = new.dancer_id
      and old.distribution_scope = 'profile_and_feed'
      and old.status in ('uploading', 'moderating', 'submitted', 'approved', 'rejected')
    then
      return new;
    end if;
  end if;

  -- Repeatable Read can retain a snapshot taken before an advisory-lock wait.
  -- Current PostgREST callers use Read Committed; Serializable uses SSI.
  if current_setting('transaction_isolation') = 'repeatable read' then
    raise exception using errcode = '25000',
      message = 'Profile video reservations require Read Committed or Serializable isolation.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('mydancr:profile-video-slots:' || new.dancer_id::text, 0)
  );

  -- AFTER observes the final row and excludes ignored ON CONFLICT inserts.
  -- VOLATILE PL/pgSQL takes a fresh Read Committed snapshot after the lock.
  select count(*) into current_video_count
  from public.mydancr_tv_videos
  where dancer_id = new.dancer_id
    and distribution_scope = 'profile_and_feed'
    and status in ('uploading', 'moderating', 'submitted', 'approved', 'rejected');

  if current_video_count > 50 then
    raise exception using errcode = '23514',
      message = 'You can upload up to 50 profile videos. Remove one before adding another.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_shift_verification_server_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Service-role requests are the only application path allowed to mutate proof.
  -- Direct database maintenance remains available to the database owner.
  if auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.location_status <> 'self_reported'
      or new.checked_in_at is not null
      or new.checked_out_at is not null
      or new.checkin_latitude is not null
      or new.checkin_longitude is not null
      or new.checkin_distance_feet is not null
      or new.checkin_accuracy_meters is not null
      or new.checkin_captured_at is not null
      or new.last_location_latitude is not null
      or new.last_location_longitude is not null
      or new.last_location_accuracy_meters is not null
      or new.last_location_captured_at is not null
      or new.last_location_verified_at is not null
      or new.location_verification_expires_at is not null
      or new.working_status <> 'self_reported'
      or new.commission_tracking_started_at is not null
      or new.commission_tracking_stopped_at is not null
      or new.ended_at is not null
      or new.ended_reason is not null
      or new.checkout_latitude is not null
      or new.checkout_longitude is not null
      or new.shift_summary <> '{}'::jsonb then
      raise exception using
        errcode = '42501',
        message = 'Shift verification state can only be set by the check-in service.';
    end if;
    return new;
  end if;

  if new.location_status is distinct from old.location_status
    or new.checked_in_at is distinct from old.checked_in_at
    or new.checked_out_at is distinct from old.checked_out_at
    or new.checkin_latitude is distinct from old.checkin_latitude
    or new.checkin_longitude is distinct from old.checkin_longitude
    or new.checkin_distance_feet is distinct from old.checkin_distance_feet
    or new.checkin_accuracy_meters is distinct from old.checkin_accuracy_meters
    or new.checkin_captured_at is distinct from old.checkin_captured_at
    or new.last_location_latitude is distinct from old.last_location_latitude
    or new.last_location_longitude is distinct from old.last_location_longitude
    or new.last_location_accuracy_meters is distinct from old.last_location_accuracy_meters
    or new.last_location_captured_at is distinct from old.last_location_captured_at
    or new.last_location_verified_at is distinct from old.last_location_verified_at
    or new.location_verification_expires_at is distinct from old.location_verification_expires_at
    or new.working_status is distinct from old.working_status
    or new.commission_tracking_started_at is distinct from old.commission_tracking_started_at
    or new.commission_tracking_stopped_at is distinct from old.commission_tracking_stopped_at
    or new.ended_at is distinct from old.ended_at
    or new.ended_reason is distinct from old.ended_reason
    or new.checkout_latitude is distinct from old.checkout_latitude
    or new.checkout_longitude is distinct from old.checkout_longitude
    or new.shift_summary is distinct from old.shift_summary then
    raise exception using
      errcode = '42501',
      message = 'Shift verification state can only be changed by the check-in service.';
  end if;

  if old.checked_in_at is not null
    and old.checked_out_at is null
    and (
      new.venue_id is distinct from old.venue_id
      or new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at
      or new.timezone is distinct from old.timezone
      or new.status is distinct from old.status
    ) then
    raise exception using
      errcode = '42501',
      message = 'An active checked-in shift cannot be edited or cancelled.';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_unique_nats_affiliate_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtext('nats-login'), hashtext(new.login_id::text));
  if tg_table_name = 'nats_agent_affiliate_accounts' and exists (
    select 1 from public.nats_affiliate_accounts dancer where dancer.login_id = new.login_id
  ) then
    raise exception using errcode = '23505', message = 'That NATS affiliate login is already linked to a dancer.';
  end if;
  if tg_table_name = 'nats_affiliate_accounts' and exists (
    select 1 from public.nats_agent_affiliate_accounts agent where agent.login_id = new.login_id
  ) then
    raise exception using errcode = '23505', message = 'That NATS affiliate login is already linked to an agent.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_verified_venue_affiliation_for_checkin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_affiliation_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.checked_in_at is not null
    and new.checked_out_at is null
    and (old.checked_in_at is null or old.checked_out_at is not null)
  then
    select affiliation.id into v_affiliation_id
    from public.venue_dancer_affiliations affiliation
    where affiliation.venue_id = new.venue_id
      and affiliation.dancer_id = new.dancer_id
      and affiliation.status = 'active'
    for key share;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'Tap this venue''s official dressing-room NFC sticker before checking in.';
    end if;

    new.venue_affiliation_id = v_affiliation_id;
  elsif new.venue_affiliation_id is distinct from old.venue_affiliation_id
    and auth.role() <> 'service_role'
    and session_user not in ('postgres', 'supabase_admin')
  then
    raise exception using
      errcode = '42501',
      message = 'Venue affiliation proof can only be set by the NFC check-in service.';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_dancer_content_reviews(p_dancer_id uuid, p_actor_user_id uuid, p_target_type text, p_target_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_owner uuid;
  v_ids uuid[];
  v_found integer;
  v_added integer;
begin
  if p_dancer_id is null or p_actor_user_id is null or p_target_type is null
    or p_target_type not in ('photo','social_link') or p_target_ids is null
    or array_ndims(p_target_ids) is distinct from 1 or cardinality(p_target_ids) not between 1 and 50 then
    raise exception 'CONTENT_REVIEW_INVALID_INPUT' using errcode = '22023';
  end if;
  if array_position(p_target_ids, null) is not null then
    raise exception 'CONTENT_REVIEW_INVALID_INPUT' using errcode = '22023';
  end if;
  select array_agg(distinct x.id order by x.id) into v_ids from unnest(p_target_ids) x(id);

  select d.user_id into v_owner from public.dancer_profiles d where d.id = p_dancer_id for update;
  if not found then
    raise exception 'CONTENT_REVIEW_PROFILE_MISSING' using errcode = 'P0002';
  end if;
  if p_actor_user_id <> v_owner or not exists(select 1 from public.app_users a
    where a.id = p_actor_user_id and a.role = 'dancer' and a.account_state = 'active' and a.dmca_suspended_at is null) then
    raise exception 'CONTENT_REVIEW_FORBIDDEN' using errcode = '42501';
  end if;

  -- Lock the profile before its targets, matching gallery publication order.
  -- Recheck eligibility after locking; do not queue an already-reviewed photo.
  if p_target_type = 'photo' then
    perform p.id from public.dancer_photos p where p.dancer_id = p_dancer_id and p.id = any(v_ids)
      order by p.id for update;
    get diagnostics v_found = row_count;
    if v_found <> cardinality(v_ids) then
      raise exception 'CONTENT_REVIEW_TARGET_CHANGED' using errcode = 'P0002';
    end if;
    insert into public.approval_reviews(dancer_id, review_type, status, reviewer_id, notes, reviewed_at)
      select p_dancer_id, 'photo:' || p.id::text, 'pending', null, 'Submitted by dancer.', null
      from public.dancer_photos p where p.dancer_id = p_dancer_id and p.id = any(v_ids) and p.review_status = 'pending'
      order by p.id
      on conflict (dancer_id, review_type) where status = 'pending' and (review_type like 'photo:%' or review_type like 'social_link:%')
      do nothing;
  else
    perform s.id from public.social_links s where s.dancer_id = p_dancer_id and s.id = any(v_ids)
      order by s.id for update;
    get diagnostics v_found = row_count;
    if v_found <> cardinality(v_ids) then
      raise exception 'CONTENT_REVIEW_TARGET_CHANGED' using errcode = 'P0002';
    end if;
    insert into public.approval_reviews(dancer_id, review_type, status, reviewer_id, notes, reviewed_at)
      select p_dancer_id, 'social_link:' || s.id::text, 'pending', null, 'Submitted by dancer.', null
      from public.social_links s where s.dancer_id = p_dancer_id and s.id = any(v_ids) and s.is_active
      order by s.id
      on conflict (dancer_id, review_type) where status = 'pending' and (review_type like 'photo:%' or review_type like 'social_link:%')
      do nothing;
  end if;
  get diagnostics v_added = row_count;
  return v_added;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_nats_agent_commission_export()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_account_active boolean;
begin
  if new.status <> 'payable' or new.amount_cents <= 0 or lower(new.currency) <> 'usd' then
    return new;
  end if;
  select exists (
    select 1 from public.nats_agent_affiliate_accounts account
    where account.agent_id = new.recipient_agent_id and account.status = 'active'
  ) into v_account_active;
  insert into public.nats_agent_commission_exports (
    agent_commission_event_id, agent_id, amount_cents, currency, status
  ) values (
    new.id, new.recipient_agent_id, new.amount_cents, lower(new.currency),
    case when v_account_active then 'pending' else 'waiting_for_affiliate' end
  ) on conflict (agent_commission_event_id) do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.enqueue_nats_commission_export()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_account_active boolean;
begin
  if new.status <> 'available' or new.is_test or new.held_at is not null
    or new.review_flag is not null or new.amount_cents <= 0 or lower(new.currency) <> 'usd'
  then return new; end if;

  if new.qr_redemption_id is not null
    and not public.is_nats_eligible_club_deal_earning(new.id)
  then return new; end if;

  select exists (
    select 1 from public.nats_affiliate_accounts account
    where account.dancer_id = new.dancer_id and account.status = 'active'
  ) into v_account_active;

  insert into public.nats_commission_exports (
    commission_event_id, dancer_id, amount_cents, currency, status
  ) values (
    new.id, new.dancer_id, new.amount_cents, lower(new.currency),
    case when new.qr_redemption_id is not null or v_account_active
      then 'pending' else 'waiting_for_affiliate' end
  ) on conflict (commission_event_id) do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ensure_dancer_primary_photo(p_dancer_id uuid, p_actor_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_owner uuid;
  v_primary uuid;
  v_active_count integer;
  v_next uuid;
begin
  if p_dancer_id is null or p_actor_user_id is null then
    raise exception 'PRIMARY_PHOTO_INVALID_INPUT' using errcode = '22023';
  end if;

  -- Match the gallery publisher's profile-before-photo lock order.
  select d.user_id into v_owner from public.dancer_profiles d
    where d.id = p_dancer_id for update;
  if not found then
    raise exception 'PRIMARY_PHOTO_PROFILE_MISSING' using errcode = 'P0002';
  end if;
  if not exists(select 1 from public.app_users a where a.id = p_actor_user_id
    and a.account_state = 'active'
    and (a.role = 'admin' or (a.role = 'dancer' and a.id = v_owner and a.dmca_suspended_at is null))) then
    raise exception 'PRIMARY_PHOTO_FORBIDDEN' using errcode = '42501';
  end if;

  -- Lock even rejected primaries before checking state, so a simultaneous
  -- moderation decision cannot revive an obsolete primary during selection.
  perform p.id from public.dancer_photos p
    where p.dancer_id = p_dancer_id and p.is_primary
    order by p.id for update;
  select count(*) into v_active_count from public.dancer_photos p
    where p.dancer_id = p_dancer_id and p.is_primary and p.review_status in ('approved','pending');
  if v_active_count > 1 then
    raise exception 'PRIMARY_PHOTO_CONFLICT' using errcode = '40001';
  end if;
  if v_active_count = 1 then
    select p.id into v_primary from public.dancer_photos p
      where p.dancer_id = p_dancer_id and p.is_primary and p.review_status in ('approved','pending');
    return v_primary;
  end if;

  select p.id into v_next from public.dancer_photos p
    where p.dancer_id = p_dancer_id and p.review_status = 'approved'
    order by p.sort_order, p.created_at, p.id
    limit 1 for update;
  if v_next is null then return null; end if;

  update public.dancer_photos set is_primary = false
    where dancer_id = p_dancer_id and is_primary and review_status = 'rejected';
  update public.dancer_photos set is_primary = true, sort_order = 0
    where id = v_next and dancer_id = p_dancer_id and review_status = 'approved';
  if not found then
    raise exception 'PRIMARY_PHOTO_CONFLICT' using errcode = '40001';
  end if;
  return v_next;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.ensure_mydancr_funded_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'pending_club_payment' then
    new.status := 'payable';
    new.payable_at := coalesce(new.payable_at, clock_timestamp());
    new.club_payment_received_at := null;
    new.audit := coalesce(new.audit, '{}'::jsonb) || jsonb_build_object(
      'commission_funder', 'mydancr',
      'venue_payment_dependency', false
    );
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.fail_nats_agent_commission_export(p_export_id uuid, p_status text, p_error text, p_response_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_updated integer;
begin
  if p_status not in ('failed', 'reconciliation_required')
    or char_length(trim(coalesce(p_error, ''))) < 3 then
    raise exception using errcode = '22023', message = 'A valid NATS agent export failure is required.';
  end if;
  update public.nats_agent_commission_exports
  set status = p_status, failed_at = clock_timestamp(), last_error = left(trim(p_error), 500),
      response_metadata = coalesce(p_response_metadata, '{}'::jsonb), updated_at = clock_timestamp()
  where id = p_export_id and status = 'processing';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.fail_nats_commission_export(p_export_id uuid, p_status text, p_error text, p_response_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_updated integer;
begin
  if p_status not in ('failed', 'reconciliation_required')
    or char_length(trim(coalesce(p_error, ''))) < 3
  then
    raise exception using errcode = '22023', message = 'A valid NATS export failure is required.';
  end if;
  update public.nats_commission_exports
  set status = p_status,
      failed_at = clock_timestamp(),
      last_error = left(trim(p_error), 500),
      response_metadata = coalesce(p_response_metadata, '{}'::jsonb),
      updated_at = clock_timestamp()
  where id = p_export_id and status = 'processing';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.finalize_pending_dancer_nfc_enrollment(p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_enrollment public.dancer_nfc_enrollments;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  -- Both fresh taps and deferred completion take this lock before any
  -- tag or enrollment row lock, so their opposite row access orders cannot
  -- deadlock each other for the same dancer. Released with the transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mydancr:dancer-nfc-enrollment:' || p_dancer_user_id::text, 0)
  );

  update public.dancer_nfc_enrollments set status = 'expired', updated_at = v_now
  where dancer_user_id = p_dancer_user_id and status = 'pending' and expires_at <= v_now;

  select * into v_enrollment
  from public.dancer_nfc_enrollments
  where dancer_user_id = p_dancer_user_id and status = 'pending' and expires_at > v_now
  order by tapped_at asc
  limit 1
  for update;
  if not found then
    return jsonb_build_object('enrollmentStatus', 'none');
  end if;

  update public.dancer_nfc_enrollments set last_attempted_at = v_now, updated_at = v_now where id = v_enrollment.id;
  begin
    v_result := public.approve_dancer_venue_affiliation_from_nfc(
      v_enrollment.nfc_tag_id, p_dancer_user_id, p_session_id,
      p_audit || jsonb_build_object('enrollmentId', v_enrollment.id, 'finalizedAfterSetup', true)
    );
  exception when insufficient_privilege then
    return jsonb_build_object(
      'enrollmentStatus', 'pending',
      'enrollmentId', v_enrollment.id,
      'venueId', v_enrollment.venue_id
    );
  end;
  update public.dancer_nfc_enrollments set
    status = 'completed', completed_at = v_now, last_attempted_at = v_now, updated_at = v_now
  where id = v_enrollment.id;
  return v_result || jsonb_build_object('enrollmentStatus', 'completed', 'enrollmentId', v_enrollment.id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.finalize_platform_import_safely(p_admin_id uuid, p_video_id uuid, p_batch_id text, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
 v_video public.mydancr_tv_videos%rowtype;
 v_before public.mydancr_tv_videos%rowtype;
 v_audit public.admin_actions%rowtype;
 v_expected jsonb := p_expected;
 v_current jsonb;
 v_desired jsonb;
 v_marker text;
 v_note text;
 v_audit_note text;
 v_field text;
 v_count integer;
 v_replayed boolean := false;
 v_keys text[] := array['dancer_id','submitted_by','storage_path','status','review_notes','reviewed_by',
   'submitted_at','reviewed_at','published_at','updated_at','moderation_started_at','moderation_completed_at'];
begin
 if p_admin_id is null or p_video_id is null or p_batch_id is null
   or p_batch_id !~ '^[a-z0-9][a-z0-9-]{7,79}$' or jsonb_typeof(p_expected) is distinct from 'object' then
   raise exception 'IMPORT_FINALIZATION_INVALID_INPUT' using errcode='22023';
 end if;
 perform id from public.app_users where id=p_admin_id and role='admin' and account_state='active' for share;
 if not found then raise exception 'IMPORT_FINALIZATION_FORBIDDEN' using errcode='42501'; end if;
 select * into v_video from public.mydancr_tv_videos where id=p_video_id for update;
 if not found then raise exception 'IMPORT_FINALIZATION_MISSING' using errcode='P0002'; end if;
 v_before := v_video;
 foreach v_field in array array['submitted_at','reviewed_at','published_at','updated_at','moderation_started_at','moderation_completed_at'] loop
   if not(v_expected ? v_field) or jsonb_typeof(v_expected->v_field) not in('string','null')
     or length(v_expected->>v_field)>64 then
     raise exception 'IMPORT_FINALIZATION_INVALID_VERSION' using errcode='22023';
   end if;
   if v_expected->v_field<>'null'::jsonb then
     if not isfinite((v_expected->>v_field)::timestamptz) then
       raise exception 'IMPORT_FINALIZATION_INVALID_VERSION' using errcode='22023';
     end if;
     v_expected := jsonb_set(v_expected,array[v_field],to_jsonb((v_expected->>v_field)::timestamptz));
   end if;
 end loop;
 if not(v_expected ?& v_keys) or (select count(*) from jsonb_object_keys(v_expected))<>cardinality(v_keys)
   or jsonb_typeof(v_expected->'review_notes') not in('string','null') then
   raise exception 'IMPORT_FINALIZATION_INVALID_VERSION' using errcode='22023';
 end if;
 select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_video)) where key=any(v_keys);
 if v_video.status='uploading' then raise exception 'IMPORT_FINALIZATION_NOT_SUBMITTED' using errcode='40001'; end if;
 v_marker := 'platform-import:'||p_batch_id||':'||(v_expected->>'status');
 v_note := case when split_part(coalesce(v_expected->>'review_notes',''),E'\n',1)=v_marker
   then v_expected->>'review_notes'
   else v_marker||case when coalesce(v_expected->>'review_notes','')='' then '' else E'\n'||(v_expected->>'review_notes') end end;
 v_desired := jsonb_set(v_expected,'{review_notes}',to_jsonb(v_note));
 -- Permit the original pre-write snapshot or the exact committed result after a lost response.
 if v_current is distinct from v_expected and v_current is distinct from v_desired then
   raise exception 'IMPORT_FINALIZATION_CHANGED' using errcode='40001';
 end if;
 v_audit_note := 'Batch '||p_batch_id||'; status '||v_video.status||'; version '||md5(v_desired::text);
 select count(*) into v_count from public.admin_actions where target_type='mydancr_tv_video'
   and target_id=p_video_id and action='finalize_platform_tv_import' and notes=v_audit_note;
 if v_count>1 then raise exception 'IMPORT_FINALIZATION_DUPLICATE_RECEIPTS' using errcode='40001'; end if;
 if v_count=1 and v_current=v_desired then
   select * into v_audit from public.admin_actions where target_type='mydancr_tv_video'
     and target_id=p_video_id and action='finalize_platform_tv_import' and notes=v_audit_note;
   v_replayed := true;
 elsif v_count<>0 then
   raise exception 'IMPORT_FINALIZATION_CHANGED' using errcode='40001';
 else
   update public.mydancr_tv_videos set review_notes=v_note where id=p_video_id returning * into v_video;
   if v_video.id is null or v_video.review_notes is distinct from v_note
     or (to_jsonb(v_video)-'review_notes') is distinct from (to_jsonb(v_before)-'review_notes') then
     raise exception 'IMPORT_FINALIZATION_NOTE_NOT_CONFIRMED' using errcode='40001';
   end if;
   insert into public.admin_actions(admin_id,target_type,target_id,action,notes,created_at)
     values(p_admin_id,'mydancr_tv_video',p_video_id,'finalize_platform_tv_import',v_audit_note,clock_timestamp())
     returning * into v_audit;
   if v_audit.id is null or v_audit.admin_id is distinct from p_admin_id
     or v_audit.target_type is distinct from 'mydancr_tv_video' or v_audit.target_id is distinct from p_video_id
     or v_audit.action is distinct from 'finalize_platform_tv_import' or v_audit.notes is distinct from v_audit_note then
     raise exception 'IMPORT_FINALIZATION_AUDIT_NOT_CONFIRMED' using errcode='40001';
   end if;
 end if;
 return jsonb_build_object('video_id',p_video_id,'batch_id',p_batch_id,'status',v_video.status,
   'audit_id',v_audit.id,'recorded_at',v_audit.created_at,'already_recorded',v_replayed,'version',v_desired);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.flag_dancer_payout_dispatch_review(p_payout_id uuid, p_failure_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_payout public.dancer_payout_batches%rowtype;
begin
  select * into v_payout from public.dancer_payout_batches where id = p_payout_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status <> 'processing' then
    return jsonb_build_object('id', p_payout_id, 'status', v_payout.status, 'unchanged', true);
  end if;
  update public.dancer_payout_batches
  set failure_message = left('Provider dispatch needs reconciliation: ' || coalesce(p_failure_message, 'Unknown provider response'), 500),
      metadata = metadata || jsonb_build_object(
        'dispatch_review_required', true,
        'dispatch_last_error', left(coalesce(p_failure_message, 'Unknown provider response'), 500)
      ),
      updated_at = now()
  where id = p_payout_id;
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, reason, after_state)
  values ('system', 'payout_dispatch_review', 'payout', p_payout_id::text,
    left(coalesce(p_failure_message, 'Unknown provider response'), 500),
    jsonb_build_object('status', 'processing', 'reservation_released', false));
  return jsonb_build_object('id', p_payout_id, 'status', 'processing', 'review_required', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.flag_paid_payout_recovery_safely(p_payout_id uuid, p_provider_reference_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_payout public.dancer_payout_batches%rowtype;
  v_count integer;
  v_amount bigint;
  v_ids uuid[];
  v_expected jsonb;
  v_actual jsonb;
  v_audit_id bigint;
  v_has_audit boolean;
begin
  if p_payout_id is null or p_provider_reference_id is null
    or char_length(p_provider_reference_id) not between 3 and 255
    or p_provider_reference_id <> btrim(p_provider_reference_id)
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500
  then
    raise exception using errcode='22023',message='A valid payout, provider reference and recovery reason are required.';
  end if;
  select * into v_payout from public.dancer_payout_batches where id=p_payout_id for update;
  if not found then raise exception using errcode='P0002',message='Payout not found.';end if;
  if v_payout.status <> 'paid' or v_payout.payment_provider <> 'stripe'
    or v_payout.provider_reference_id is distinct from p_provider_reference_id
  then raise exception using errcode='40001',message='The paid provider payout could not be confirmed.';end if;

  perform 1 from public.commission_events where payout_batch_id=p_payout_id order by id for update;
  if exists(select 1 from public.commission_events where payout_batch_id=p_payout_id
    and (status<>'paid' or dancer_id is distinct from v_payout.dancer_id
      or currency is distinct from v_payout.currency or payment_provider is distinct from v_payout.payment_provider))
  then raise exception using errcode='40001',message='Paid payout earnings could not be confirmed.';end if;
  select count(*)::integer,coalesce(sum(amount_cents),0)::bigint,array_agg(id order by id),
    jsonb_agg(to_jsonb(e)||jsonb_build_object('recovery_required',true,
      'review_flag',coalesce(e.review_flag,'paid_payout_reversed_by_provider')) order by id)
    into v_count,v_amount,v_ids,v_expected
    from public.commission_events e where payout_batch_id=p_payout_id;
  if v_count=0 or v_amount<>v_payout.amount_cents then
    raise exception using errcode='40001',message='Paid payout total could not be confirmed.';
  end if;
  perform 1 from public.dancer_payout_items where payout_batch_id=p_payout_id order by id for update;
  if (select count(*) from public.dancer_payout_items where payout_batch_id=p_payout_id)<>v_count
    or exists(select 1 from public.dancer_payout_items i
      left join public.commission_events e on e.id=i.commission_event_id
      where i.payout_batch_id=p_payout_id and
        (e.payout_batch_id is distinct from p_payout_id or i.amount_cents is distinct from e.amount_cents))
  then raise exception using errcode='40001',message='Paid payout items could not be confirmed.';end if;

  select exists(select 1 from public.financial_audit_events
    where actor_type='provider' and action='paid_payout_recovery_required'
      and target_type='payout' and target_id=p_payout_id::text
      and metadata->>'provider_reference_id'=p_provider_reference_id
      and metadata->'automatic_debit_attempted'='false'::jsonb) into v_has_audit;
  select jsonb_agg(to_jsonb(e) order by id) into v_actual
    from public.commission_events e where payout_batch_id=p_payout_id;
  if v_has_audit and v_actual=v_expected then
    return jsonb_build_object('id',p_payout_id,'status','paid','providerReferenceId',p_provider_reference_id,
      'recoveryRequired',true,'earningCount',v_count,'duplicate',true);
  end if;

  update public.commission_events set recovery_required=true,
    review_flag=coalesce(review_flag,'paid_payout_reversed_by_provider')
    where id=any(v_ids);
  select jsonb_agg(to_jsonb(e) order by id) into v_actual
    from public.commission_events e where payout_batch_id=p_payout_id;
  if v_actual is distinct from v_expected then
    raise exception using errcode='40001',message='Payout recovery update could not be confirmed.';
  end if;
  insert into public.financial_audit_events(actor_type,action,target_type,target_id,reason,metadata)
    values('provider','paid_payout_recovery_required','payout',p_payout_id::text,btrim(p_reason),
      jsonb_build_object('provider_reference_id',p_provider_reference_id,'automatic_debit_attempted',false))
    returning id into v_audit_id;
  if v_audit_id is null or not exists(select 1 from public.financial_audit_events
    where id=v_audit_id and actor_type='provider' and action='paid_payout_recovery_required'
      and target_type='payout' and target_id=p_payout_id::text and reason=btrim(p_reason)
      and metadata=jsonb_build_object('provider_reference_id',p_provider_reference_id,'automatic_debit_attempted',false))
  then raise exception using errcode='40001',message='Payout recovery audit could not be confirmed.';end if;
  return jsonb_build_object('id',p_payout_id,'status','paid','providerReferenceId',p_provider_reference_id,
    'recoveryRequired',true,'earningCount',v_count,'duplicate',false);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.flag_reversed_nats_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status <> 'reversed' and new.status = 'reversed' then
    update public.nats_commission_exports
    set status = case when status = 'exported' then 'reconciliation_required' else 'canceled' end,
        last_error = case when status = 'exported'
          then 'The source earning was reversed after export. Reconcile the matching manual invoice in NATS.'
          else 'The source earning was reversed before NATS export.' end,
        failed_at = case when status = 'exported' then clock_timestamp() else failed_at end,
        updated_at = clock_timestamp()
    where commission_event_id = new.id
      and status in ('waiting_for_affiliate', 'pending', 'failed', 'exported');
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.flag_voided_nats_agent_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status <> 'voided' and new.status = 'voided' then
    update public.nats_agent_commission_exports
    set status = case when status = 'exported' then 'reconciliation_required' else 'canceled' end,
        last_error = case when status = 'exported'
          then 'The source agent earning was voided after export. Reconcile the matching manual invoice in NATS.'
          else 'The source agent earning was voided before NATS export.' end,
        failed_at = case when status = 'exported' then clock_timestamp() else failed_at end,
        updated_at = clock_timestamp()
    where agent_commission_event_id = new.id
      and status in ('waiting_for_affiliate', 'pending', 'failed', 'exported');
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.gallery_storage_family(p_storage_path text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select pg_catalog.regexp_replace(p_storage_path, '[.]w[1-9][0-9]*[.]webp$', '');
$function$
;
CREATE OR REPLACE FUNCTION public.get_admin_dancer_financial_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'pending_cents', coalesce((select sum(amount_cents) from public.commission_events where status = 'pending'), 0),
    'available_cents', coalesce((select sum(amount_cents) from public.commission_events
      where status = 'available' and held_at is null and review_flag is null), 0),
    'processing_cents', coalesce((select sum(amount_cents) from public.commission_events where status = 'payout_processing'), 0),
    'paid_cents', coalesce((select sum(amount_cents) from public.dancer_payout_batches where status = 'paid'), 0),
    'reversed_cents', coalesce((select sum(amount_cents) from public.commission_events where status = 'reversed'), 0),
    'failed_payout_count', coalesce((select count(*) from public.dancer_payout_batches where status = 'failed'), 0),
    'completed_payout_count', coalesce((select count(*) from public.dancer_payout_batches where status = 'paid'), 0)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.get_dancer_earnings_summary(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'pending_cents', coalesce(sum(earning.amount_cents) filter (where earning.status = 'pending'), 0),
    'available_cents', coalesce(sum(earning.amount_cents) filter (
      where earning.status = 'available' and earning.held_at is null and earning.review_flag is null
    ), 0),
    'processing_cents', coalesce(sum(earning.amount_cents) filter (where earning.status = 'payout_processing'), 0),
    'paid_cents', coalesce(sum(earning.amount_cents) filter (where earning.status = 'paid'), 0),
    'lifetime_cents', coalesce(sum(earning.amount_cents) filter (
      where earning.status in ('available', 'payout_processing', 'paid')
    ), 0)
  )
  from public.dancer_profiles dancer
  left join public.commission_events earning on earning.dancer_id = dancer.id
  where dancer.user_id = p_user_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_due_club_invoice_reminders(p_now timestamp with time zone, p_limit integer DEFAULT 250)
 RETURNS TABLE(id uuid, status text, due_at timestamp with time zone, stripe_invoice_id text, reminder_count integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if p_now is null or not isfinite(p_now) or p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception 'Invalid reminder selection bounds' using errcode = '22023';
  end if;
  return query
  select i.id, i.status::text, i.due_at, i.stripe_invoice_id, i.reminder_count
  from public.club_invoices i
  cross join lateral (
    select case when isfinite(i.due_at)
      then ceil(extract(epoch from (i.due_at - p_now)) / 86400) end as days_from_due
  ) d
  cross join lateral (
    select case when d.days_from_due between 0 and 3 then 'due_soon'
      when d.days_from_due < 0 then 'overdue_' || (floor(abs(d.days_from_due) / 7) * 7)::bigint::text
      else null end as reminder_key
  ) r
  where i.status in ('open', 'overdue') and i.stripe_invoice_id is not null
    and r.reminder_key is not null
    and not exists (
      select 1 from public.club_invoice_reminders sent
      where sent.invoice_id = i.id and sent.reminder_key = r.reminder_key
    )
  order by i.due_at, i.id
  limit p_limit;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_mydancr_tv_metric_counts(p_video_ids uuid[], p_since timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_counts jsonb;
begin
  if p_video_ids is null or cardinality(p_video_ids) > 100 or array_ndims(p_video_ids) > 1 then
    raise exception using errcode = '22023', message = 'Provide at most 100 video identifiers.';
  end if;
  if array_position(p_video_ids, null) is not null then
    raise exception using errcode = '22023', message = 'Video identifiers cannot be empty.';
  end if;
  if p_since is null or not isfinite(p_since)
    or p_since < statement_timestamp() - interval '31 days'
    or p_since > statement_timestamp()
  then
    raise exception using errcode = '22023', message = 'A recent metric cutoff is required.';
  end if;
  if cardinality(p_video_ids) = 0 then return '{}'::jsonb; end if;

  with selected as (
    select distinct unnest(p_video_ids) as video_id
  ), counts as (
    select event.video_id, event.event_type, count(*) as total
    from public.mydancr_tv_events event
    where event.video_id = any(p_video_ids) and event.occurred_at >= p_since
    group by event.video_id, event.event_type
  ), grouped as (
    select video_id, jsonb_object_agg(event_type, total) as metrics
    from counts group by video_id
  )
  select jsonb_object_agg(selected.video_id::text, coalesce(grouped.metrics, '{}'::jsonb))
    into v_counts
  from selected left join grouped using(video_id);
  return coalesce(v_counts, '{}'::jsonb);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_dancer_metric_counts(p_dancer_ids uuid[], p_shift_ids uuid[], p_profile_views_since timestamp with time zone)
 RETURNS TABLE(metric text, entity_id uuid, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select 'followers'::text, follow.dancer_id, count(*)::bigint
  from public.follows as follow
  where follow.dancer_id = any(coalesce(p_dancer_ids, '{}'::uuid[]))
  group by follow.dancer_id

  union all

  select 'notifications'::text, follow.dancer_id, count(*)::bigint
  from public.follows as follow
  where follow.dancer_id = any(coalesce(p_dancer_ids, '{}'::uuid[]))
    and follow.notifications_enabled = true
  group by follow.dancer_id

  union all

  select 'profile_views'::text, view.dancer_id, count(*)::bigint
  from public.profile_views as view
  where view.dancer_id = any(coalesce(p_dancer_ids, '{}'::uuid[]))
    and view.viewed_at >= p_profile_views_since
  group by view.dancer_id

  union all

  select 'going'::text, signal.shift_id, count(*)::bigint
  from public.going_signals as signal
  where signal.shift_id = any(coalesce(p_shift_ids, '{}'::uuid[]))
  group by signal.shift_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_venue_metric_counts(p_venue_ids uuid[], p_activity_since timestamp with time zone)
 RETURNS TABLE(metric text, entity_id uuid, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select 'followers'::text, follow.venue_id, count(*)::bigint
  from public.venue_follows as follow
  where follow.venue_id = any(coalesce(p_venue_ids, '{}'::uuid[]))
  group by follow.venue_id

  union all

  select 'directions'::text, request.venue_id, count(*)::bigint
  from public.direction_requests as request
  where request.venue_id = any(coalesce(p_venue_ids, '{}'::uuid[]))
    and request.requested_at >= p_activity_since
  group by request.venue_id

  union all

  select 'profile_views'::text, event.venue_id, count(*)::bigint
  from public.venue_page_events as event
  where event.venue_id = any(coalesce(p_venue_ids, '{}'::uuid[]))
    and event.event_type = 'page_view'
    and event.occurred_at >= p_activity_since
  group by event.venue_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_ranking_metric_batch(p_dancer_ids uuid[], p_since timestamp with time zone)
 RETURNS TABLE(dancer_id uuid, metrics jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if p_since is null or p_dancer_ids is null or cardinality(p_dancer_ids)>200 then raise exception using errcode='22023',message='Ranking batch must contain at most 200 dancers and a start time.'; end if;
 return query select d.id,jsonb_build_object(
 'profileViews',(select count(*) from public.profile_views x where x.dancer_id=d.id and x.viewed_at>=p_since),
 'scheduleViews',(select count(*) from public.schedule_views x where x.dancer_id=d.id and x.viewed_at>=p_since),
 'followers',(select count(*) from public.follows x where x.dancer_id=d.id and x.created_at>=p_since),
 'favorites',(select count(*) from public.favorites x where x.dancer_id=d.id and x.created_at>=p_since),
 'directionRequests',(select count(*) from public.direction_requests x where x.dancer_id=d.id and x.requested_at>=p_since),
 'goingSignals',(select count(*) from public.going_signals x join public.shifts s on s.id=x.shift_id where s.dancer_id=d.id and x.created_at>=p_since),
 'notificationOpens',(select count(*) from public.notifications x where x.payload->>'dancerId'=d.id::text and x.read_at is not null and x.created_at>=p_since),
 'socialClicks',(select count(*) from public.social_clicks x where x.dancer_id=d.id and x.clicked_at>=p_since)
 ) from public.dancer_profiles d where d.id=any(p_dancer_ids);
end; $function$
;
CREATE OR REPLACE FUNCTION public.guard_gallery_storage_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_path text;
  v_old_path text;
  v_family text;
begin
  if tg_level <> 'ROW' or tg_when <> 'AFTER' or tg_op not in ('INSERT','UPDATE') then
    raise exception 'GALLERY_RETIREMENT_INVALID_TRIGGER' using errcode='42501';
  end if;
  if tg_relid = 'public.dancer_photos'::regclass then
    v_path := new.storage_path;
    if tg_op = 'UPDATE' then v_old_path := old.storage_path; end if;
  elsif tg_relid = 'public.dancer_profiles'::regclass then
    v_path := new.avatar_storage_path;
    if tg_op = 'UPDATE' then v_old_path := old.avatar_storage_path; end if;
  elsif tg_relid = 'public.image_moderation_records'::regclass then
    v_path := new.final_storage_path;
    if tg_op = 'UPDATE' then v_old_path := old.final_storage_path; end if;
  else
    raise exception 'GALLERY_RETIREMENT_INVALID_SOURCE' using errcode='42501';
  end if;
  if v_path is null or v_path = '' or (tg_op = 'UPDATE' and v_path is not distinct from v_old_path) then
    return null;
  end if;
  -- A repeatable snapshot cannot establish the absence of a committed marker.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'GALLERY_REFERENCE_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  v_family := public.gallery_storage_family(v_path);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mydancr:gallery-retirement:' || v_family,0));
  -- Keep this a separate VOLATILE query after the lock to refresh visibility.
  if exists(select 1 from public.gallery_storage_retirements where storage_path=v_family) then
    raise exception 'GALLERY_STORAGE_RETIRED' using errcode='23514';
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  requested_role public.user_role;
  public_role text := lower(trim(coalesce(new.raw_user_meta_data->>'role', '')));
  trusted_role text := lower(trim(coalesce(new.raw_app_meta_data->>'mydancr_provisioned_role', '')));
  display_name text;
  real_name text;
  stage_name text;
  city_name text;
begin
  requested_role := case
    when trusted_role in ('admin', 'venue') then trusted_role::public.user_role
    when public_role in ('customer', 'dancer') then public_role::public.user_role
    else 'customer'::public.user_role
  end;

  display_name := nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
  real_name := nullif(trim(coalesce(new.raw_user_meta_data->>'real_name', '')), '');
  stage_name := nullif(trim(coalesce(new.raw_user_meta_data->>'stage_name', '')), '');
  city_name := nullif(trim(coalesce(new.raw_user_meta_data->>'city', '')), '');

  insert into public.app_users (id, role, display_name, email)
  values (
    new.id,
    requested_role,
    case
      when requested_role = 'dancer' then coalesce(display_name, 'Dancer')
      else coalesce(display_name, split_part(new.email, '@', 1))
    end,
    new.email
  )
  on conflict (id) do update set
    role = excluded.role,
    display_name = excluded.display_name,
    email = excluded.email,
    updated_at = now();

  if requested_role = 'customer' then
    insert into public.customer_profiles (user_id, city)
    values (new.id, coalesce(city_name, 'Las Vegas'))
    on conflict (user_id) do nothing;
  end if;

  if requested_role = 'dancer' then
    insert into public.dancer_profiles (
      user_id,
      real_name,
      stage_name,
      slug,
      city,
      status,
      identity_saved_at
    )
    values (
      new.id,
      coalesce(real_name, 'Verification pending'),
      coalesce(stage_name, ''),
      public.unique_dancer_slug(coalesce(stage_name, ''), new.id),
      coalesce(city_name, ''),
      'draft',
      null
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.handoff_club_shuttle_request(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  request_row public.club_shuttle_requests%rowtype;
  item jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Server access required.';
  end if;
  select * into request_row from public.club_shuttle_requests
    where id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Shuttle request not found.';
  end if;
  if request_row.handed_off_at is not null then
    return jsonb_build_object('request_id', request_row.id, 'newly_handed_off', false);
  end if;
  for item in select value from jsonb_array_elements(request_row.notification_rows) loop
    insert into public.notifications (id, recipient_id, notification_type, channel, title, body, payload)
      values ((item->>'id')::uuid, (item->>'recipient_id')::uuid,
        'support_message', 'in_app', item->>'title', item->>'body', item->'payload')
      on conflict (id) do nothing;
    if not exists (select 1 from public.notifications n where n.id = (item->>'id')::uuid
      and n.recipient_id = (item->>'recipient_id')::uuid and n.body = item->>'body'
      and n.payload = item->'payload') then
      raise exception using errcode = '23505', message = 'Shuttle handoff conflict.';
    end if;
  end loop;
  update public.club_shuttle_requests set handed_off_at = now() where id = request_row.id;
  return jsonb_build_object('request_id', request_row.id, 'newly_handed_off', true);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.has_active_club_deal(venues)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ select exists (select 1 from public.club_deals d where d.venue_id = $1.id and d.is_active and d.payout_type = 'flat' and d.payout_amount_cents > 0 and d.offer_type = 'admission' and d.deal_title in ('Half-off admission', 'Skip the line', 'Free admission')); $function$
;
CREATE OR REPLACE FUNCTION public.invalidate_account_self_pause()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_level <> 'ROW' or tg_when <> 'AFTER' or tg_op not in ('UPDATE','DELETE') then
    raise exception 'ACCOUNT_PAUSE_INVALID_TRIGGER' using errcode='42501';
  end if;
  if tg_relid = 'public.app_users'::regclass then
    delete from public.account_self_pauses where user_id = old.id;
  elsif tg_relid = 'public.venues'::regclass then
    update public.account_self_pauses set venue_was_active = null where venue_id = old.id;
  elsif tg_relid = 'public.dancer_profiles'::regclass then
    update public.account_self_pauses set dancer_previous_state = null where dancer_id = old.id;
  else
    raise exception 'ACCOUNT_PAUSE_INVALID_SOURCE' using errcode='42501';
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.invalidate_dmca_enforcement_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text;
  v_id uuid;
begin
  if tg_level<>'ROW' or tg_when<>'AFTER' or tg_op not in('UPDATE','DELETE') then
    raise exception 'INVALID_DMCA_STATE_TRIGGER' using errcode='42501';
  end if;
  if tg_relid='public.app_users'::regclass then v_type:='account';
  elsif tg_relid='public.dancer_profiles'::regclass then v_type:='dancer_profile';
  elsif tg_relid='public.mydancr_tv_videos'::regclass then v_type:='tv_video';
  else raise exception 'INVALID_DMCA_STATE_SOURCE' using errcode='42501';
  end if;
  v_id:=old.id;
  if tg_op='DELETE' then
    delete from public.dmca_enforcement_states where target_type=v_type and target_id=v_id;
  else
    -- UPDATE OF attachments deliberately include a same-value decision. An
    -- unrelated caption, display-name or metadata edit does not claim status.
    update public.dmca_enforcement_states set restore_allowed=false,invalidated_at=pg_catalog.clock_timestamp()
      where target_type=v_type and target_id=v_id;
  end if;
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.app_users
    where id = auth.uid()
      and role = 'admin'
      and account_state = 'active'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_current_dancer_owner(p_dancer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when auth.uid() is null then false else exists(
   select 1 from public.dancer_profiles d where d.id=p_dancer_id and d.user_id=auth.uid()
 )end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_current_venue_owner(p_venue_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when auth.uid() is null then false else exists(
   select 1 from public.venues v where v.id=p_venue_id and v.owner_user_id=auth.uid()
 )end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_nats_eligible_club_deal_earning(p_earning_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.commission_events earning
    join public.deal_revenue_events revenue on revenue.qr_redemption_id = earning.qr_redemption_id
    where earning.id = p_earning_id
      and revenue.dancer_id = earning.dancer_id
      and revenue.dancer_commission_eligible
      and revenue.dancer_nats_activated_at <= revenue.confirmed_at
      and revenue.dancer_commission_cents = earning.amount_cents
      and revenue.status not in ('refunded', 'voided')
  );
$function$
;
CREATE OR REPLACE FUNCTION public.issue_and_confirm_deal_redemption_from_nfc(p_redemption_token text, p_tag_id uuid, p_session_id uuid, p_venue_id uuid, p_club_deal_id uuid, p_source_type text, p_dancer_id uuid, p_shift_id uuid, p_customer_id uuid, p_expires_at timestamp with time zone, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_confirmation jsonb;
begin
  if p_redemption_token !~ '^[A-Za-z0-9_-]{40,120}$' then
    raise exception using errcode = '22023', message = 'A valid Club Deal redemption token is required.';
  end if;
  if p_source_type not in ('club_page', 'dancer_profile') then
    raise exception using errcode = '22023', message = 'A valid Club Deal source is required.';
  end if;
  if p_expires_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'The Club Deal redemption expiration must be in the future.';
  end if;
  if p_source_type = 'dancer_profile' and (p_dancer_id is null or p_shift_id is null) then
    raise exception using errcode = '22023', message = 'Dancer attribution is incomplete for this Club Deal.';
  end if;
  if p_source_type = 'club_page' and (p_dancer_id is not null or p_shift_id is not null) then
    raise exception using errcode = '22023', message = 'Club-page redemptions cannot include dancer attribution.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_club_deal_id::text),
    hashtext(coalesce(p_customer_id::text, p_session_id::text))
  );

  insert into public.qr_redemptions (
    redemption_token,
    venue_id,
    club_deal_id,
    source_type,
    dancer_id,
    shift_id,
    attribution_locked_at,
    customer_id,
    session_id,
    nfc_tag_id,
    expires_at,
    ip_address,
    user_agent,
    device_fingerprint,
    audit
  ) values (
    p_redemption_token,
    p_venue_id,
    p_club_deal_id,
    p_source_type,
    p_dancer_id,
    p_shift_id,
    case when p_source_type = 'dancer_profile' then clock_timestamp() else null end,
    p_customer_id,
    p_session_id::text,
    p_tag_id,
    p_expires_at,
    p_audit->>'ip_address',
    p_audit->>'user_agent',
    p_audit->>'device_fingerprint',
    coalesce(p_audit, '{}'::jsonb)
  );

  v_confirmation := public.confirm_deal_redemption_from_nfc(
    p_redemption_token,
    p_tag_id,
    p_session_id,
    coalesce(p_audit, '{}'::jsonb)
  );

  return v_confirmation;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_dancer_venue_verification_token(p_dancer_id uuid, p_user_id uuid, p_venue_id uuid, p_token_digest text, p_request_ip_hash text, p_expires_at timestamp with time zone)
 RETURNS venue_dancer_verification_tokens
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_token public.venue_dancer_verification_tokens;
  v_now timestamptz := now();
begin
  if p_token_digest !~ '^[0-9a-f]{64}$' or p_request_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid dancer verification token.';
  end if;
  if p_expires_at < v_now + interval '5 minutes' or p_expires_at > v_now + interval '15 minutes' then
    raise exception using errcode = '22023', message = 'Dancer verification links must expire in 5 to 15 minutes.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_dancer_id::text), hashtext(p_venue_id::text));

  if not exists (
    select 1
    from public.dancer_profiles dancer
    join public.app_users account on account.id = dancer.user_id
    where dancer.id = p_dancer_id
      and dancer.user_id = p_user_id
      and dancer.status not in ('rejected', 'disabled')
      and dancer.disabled_at is null
      and nullif(trim(dancer.stage_name), '') is not null
      and nullif(trim(dancer.city), '') is not null
      and nullif(trim(dancer.avatar_storage_path), '') is not null
      and dancer.photo_review_status = 'approved'
      and exists (
        select 1 from public.dancer_photos photo
        where photo.dancer_id = dancer.id and photo.review_status = 'approved'
      )
      and not exists (
        select 1 from public.dancer_photos photo
        where photo.dancer_id = dancer.id and photo.review_status <> 'approved'
      )
      and not exists (
        select 1 from public.mydancr_tv_videos video
        where video.dancer_id = dancer.id and video.status in ('uploading', 'moderating', 'submitted')
      )
      and account.role = 'dancer'
      and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Profile setup and automated media moderation must be complete before venue affiliation.';
  end if;

  if not exists (
    select 1 from public.venues venue
    join public.app_users owner on owner.id = venue.owner_user_id
    where venue.id = p_venue_id and venue.is_active = true and owner.role = 'venue' and owner.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'This venue does not have a verified manager yet.';
  end if;

  if (select count(*) from public.venue_dancer_verification_tokens token where token.created_by_user_id = p_user_id and token.created_at >= v_now - interval '1 hour') >= 5 then
    raise exception using errcode = '42901', message = 'Too many verification links were created. Try again later.';
  end if;
  if (select count(*) from public.venue_dancer_verification_tokens token where token.request_ip_hash = p_request_ip_hash and token.created_at >= v_now - interval '24 hours') >= 20 then
    raise exception using errcode = '42901', message = 'Too many verification links were created from this connection.';
  end if;

  update public.venue_dancer_verification_tokens set revoked_at = v_now
  where venue_id = p_venue_id and dancer_id = p_dancer_id and used_at is null and revoked_at is null;

  insert into public.venue_dancer_verification_tokens (
    venue_id, dancer_id, created_by_user_id, token_digest, request_ip_hash, expires_at
  ) values (
    p_venue_id, p_dancer_id, p_user_id, p_token_digest, p_request_ip_hash, p_expires_at
  ) returning * into v_token;

  insert into public.venue_dancer_affiliation_events (venue_id, dancer_id, actor_user_id, event_type, event_payload)
  values (p_venue_id, p_dancer_id, p_user_id, 'token_issued', jsonb_build_object('tokenId', v_token.id, 'expiresAt', p_expires_at));

  return v_token;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_venue_claim_code(p_venue_id uuid, p_admin_id uuid, p_code_digest text, p_expires_at timestamp with time zone)
 RETURNS venue_claim_codes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_venue public.venues;
  v_code public.venue_claim_codes;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.app_users
    where id = p_admin_id and role = 'admin' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active admin account required.';
  end if;
  if p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid venue claim code digest.';
  end if;
  if p_expires_at <= v_now + interval '5 minutes'
    or p_expires_at > v_now + interval '30 days'
  then
    raise exception using errcode = '22023', message = 'Venue claim codes must expire between 5 minutes and 30 days from now.';
  end if;

  select * into v_venue
  from public.venues
  where id = p_venue_id
  for update;

  if not found or v_venue.is_active = false then
    raise exception using errcode = 'P0002', message = 'Active venue not found.';
  end if;
  if v_venue.owner_user_id is not null then
    raise exception using errcode = '23505', message = 'This venue already has a verified manager.';
  end if;

  update public.venue_claim_codes
  set revoked_at = v_now, revoked_by = p_admin_id
  where venue_id = p_venue_id
    and used_at is null
    and revoked_at is null;

  insert into public.venue_claim_codes (
    venue_id,
    code_digest,
    created_by,
    expires_at
  )
  values (
    p_venue_id,
    p_code_digest,
    p_admin_id,
    p_expires_at
  )
  returning * into v_code;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue',
    p_venue_id,
    'issue_venue_claim_code',
    'Claim code expires ' || p_expires_at::text
  );

  return v_code;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.lock_sales_agent_hierarchy_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET lock_timeout TO '3s'
AS $function$
begin
  if tg_relid <> 'public.sales_agents'::regclass
    or tg_level <> 'STATEMENT' or tg_when <> 'BEFORE'
    or tg_op not in ('INSERT', 'UPDATE') then
    raise exception using errcode = '22023', message = 'Invalid sales-agent hierarchy trigger context.';
  end if;
  if current_setting('transaction_isolation') = 'repeatable read' then
    raise exception using errcode = '25000',
      message = 'Sales-agent hierarchy changes require Read Committed or Serializable isolation.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:sales-agent-hierarchy', 0));
  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.log_qr_redemption_issued()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.qr_redemption_events (
    qr_redemption_id,
    event_type,
    actor_user_id,
    session_id,
    ip_address,
    user_agent,
    audit
  )
  values (
    new.id,
    'issued',
    new.customer_id,
    new.session_id,
    new.ip_address,
    new.user_agent,
    jsonb_build_object(
      'source_type', new.source_type,
      'dancer_id', new.dancer_id,
      'shift_id', new.shift_id
    )
  );
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_dancer_payout_processing(p_payout_id uuid, p_provider_reference_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_payout public.dancer_payout_batches%rowtype;
begin
  if char_length(trim(coalesce(p_provider_reference_id, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Provider reference is required.';
  end if;
  select * into v_payout from public.dancer_payout_batches where id = p_payout_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status = 'paid' and v_payout.provider_reference_id = trim(p_provider_reference_id) then
    return jsonb_build_object('id', p_payout_id, 'status', 'paid', 'duplicate', true);
  end if;
  if v_payout.status not in ('requested', 'processing') then
    raise exception using errcode = '22023', message = 'Payout cannot enter processing from its current status.';
  end if;
  update public.dancer_payout_batches set status = 'processing', processing_at = coalesce(processing_at, now()),
    provider_reference_id = trim(p_provider_reference_id),
    stripe_transfer_id = case when payment_provider = 'stripe' then trim(p_provider_reference_id) else stripe_transfer_id end,
    external_reference = trim(p_provider_reference_id), failure_message = null,
    metadata = metadata - 'dispatch_review_required' - 'dispatch_last_error', updated_at = now()
  where id = p_payout_id;
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, before_state, after_state)
  values ('system', 'payout_processing', 'payout', p_payout_id::text,
    jsonb_build_object('status', v_payout.status),
    jsonb_build_object('status', 'processing', 'provider_reference_id', trim(p_provider_reference_id)));
  return jsonb_build_object('id', p_payout_id, 'status', 'processing');
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mydancr_placeholder_venue_address(venue_city text, venue_state text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select concat_ws(
    ', ',
    '0000 MyDancr Ave',
    nullif(btrim(venue_city), ''),
    case
      when nullif(btrim(venue_state), '') is not null
        then btrim(venue_state) || ' 55555'
      else '55555'
    end
  );
$function$
;
CREATE OR REPLACE FUNCTION public.notify_dancer_profile_live()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_venue_name text;
begin
  if new.status = 'approved'
    and new.verification_status = 'approved'
    and new.is_public = true
    and new.venue_approved_at is not null
    and (
      old.status is distinct from new.status
      or old.verification_status is distinct from new.verification_status
      or old.is_public is distinct from new.is_public
    )
  then
    select venue.name
    into v_venue_name
    from public.venues venue
    where venue.id = new.venue_approved_venue_id;

    insert into public.notifications (
      recipient_id,
      notification_type,
      channel,
      title,
      body,
      payload,
      sent_at
    ) values (
      new.user_id,
      'venue_affiliation_status',
      'in_app',
      'Your profile is live',
      case
        when v_venue_name is not null then 'Approved through ' || v_venue_name || '. Customers can now discover your profile on MyDancr.'
        else 'Your dressing-room tap was approved. Customers can now discover your profile on MyDancr.'
      end,
      jsonb_build_object(
        'kind', 'dancer_profile_live',
        'dancerId', new.id,
        'dancerSlug', new.slug,
        'venueId', new.venue_approved_venue_id,
        'venueName', v_venue_name
      ),
      coalesce(new.approved_at, now())
    );
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_venue_card_live()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.is_active is true
    and new.page_review_status = 'published'
    and new.published_at is not null
    and old.published_at is null
  then
    insert into public.notifications (
      recipient_id,
      notification_type,
      channel,
      title,
      body,
      payload,
      sent_at
    )
    select
      recipients.user_id,
      'venue_publication_status',
      'in_app',
      'Your venue card is live',
      new.name || ' is now visible in MyDancr venue discovery and on its public venue page.',
      jsonb_build_object(
        'kind', 'venue_card_live',
        'status', 'live',
        'venueId', new.id,
        'venueSlug', new.slug,
        'venueName', new.name,
        'publishedAt', new.published_at
      ),
      new.published_at
    from (
      select new.owner_user_id as user_id
      union
      select member.user_id
      from public.venue_team_members as member
      where member.venue_id = new.id
        and member.status = 'active'
    ) as recipients
    join public.app_users as account
      on account.id = recipients.user_id
     and account.role = 'venue'
     and account.account_state = 'active'
    where recipients.user_id is not null
      and not exists (
        select 1
        from public.notifications as existing
        where existing.recipient_id = recipients.user_id
          and existing.notification_type = 'venue_publication_status'
          and existing.payload @> jsonb_build_object(
            'kind', 'venue_card_live',
            'venueId', new.id
          )
      );
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.prepare_dancer_earning()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_hold_days integer;
begin
  if tg_op = 'INSERT' then
    select earnings_hold_days into v_hold_days from public.payout_settings where id = 'default';
    new.status := case new.status
      when 'pending_club_payment' then 'pending'
      when 'payable' then 'pending'
      when 'rejected' then 'reversed'
      when 'voided' then 'reversed'
      else new.status
    end;
    new.pending_until := coalesce(new.pending_until, clock_timestamp() + make_interval(days => coalesce(v_hold_days, 7)));
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'commission_funder', 'mydancr',
      'venue_payment_dependency', false
    );
    if new.status = 'reversed' then
      new.reversed_at := coalesce(new.reversed_at, clock_timestamp());
      new.reversal_reason := coalesce(nullif(trim(new.reversal_reason), ''), 'Earning invalidated during creation');
    end if;
    return new;
  end if;

  new.status := case new.status
    when 'pending_club_payment' then 'pending'
    when 'payable' then 'pending'
    when 'rejected' then 'reversed'
    when 'voided' then 'reversed'
    else new.status
  end;
  if new.status = 'reversed' and old.status <> 'reversed' then
    new.reversed_at := coalesce(new.reversed_at, clock_timestamp());
    new.reversal_reason := coalesce(nullif(trim(new.reversal_reason), ''), 'Earning invalidated by the originating workflow');
  end if;

  if (new.qr_redemption_id, new.venue_id, new.club_deal_id, new.dancer_id, new.amount_cents,
      new.gross_commission_cents, new.dancer_share_bps, new.platform_amount_cents, new.currency,
      new.earning_type, new.created_at, new.is_test)
     is distinct from
     (old.qr_redemption_id, old.venue_id, old.club_deal_id, old.dancer_id, old.amount_cents,
      old.gross_commission_cents, old.dancer_share_bps, old.platform_amount_cents, old.currency,
      old.earning_type, old.created_at, old.is_test)
  then
    raise exception using errcode = '22023', message = 'Core earning fields are immutable.';
  end if;

  if old.status = 'paid' and new.status <> 'paid' then
    raise exception using errcode = '22023', message = 'Paid earnings cannot be reversed or silently debited.';
  end if;

  if old.status <> new.status and not (
    (old.status = 'pending' and new.status in ('available', 'reversed', 'failed')) or
    (old.status = 'available' and new.status in ('payout_processing', 'reversed', 'failed')) or
    (old.status = 'payout_processing' and new.status in ('paid', 'available', 'failed')) or
    (old.status = 'failed' and new.status in ('pending', 'available', 'reversed'))
  ) then
    raise exception using errcode = '22023', message = 'Invalid earning status transition.';
  end if;

  if new.status = 'available' and old.status <> 'available' then
    new.available_at := coalesce(new.available_at, clock_timestamp());
  end if;
  if new.status = 'paid' and old.status <> 'paid' then
    new.paid_at := coalesce(new.paid_at, clock_timestamp());
  end if;
  if new.status = 'reversed' and old.status <> 'reversed' then
    new.reversed_at := coalesce(new.reversed_at, clock_timestamp());
    if char_length(trim(coalesce(new.reversal_reason, ''))) < 3 then
      raise exception using errcode = '22023', message = 'A reversal reason is required.';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.preserve_dancer_commission_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if (new.dancer_commission_eligible, new.dancer_nats_activated_at, new.confirmed_at)
    is distinct from
    (old.dancer_commission_eligible, old.dancer_nats_activated_at, old.confirmed_at)
  then
    raise exception using errcode = '22023', message = 'Redemption commission eligibility is immutable.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.process_dancer_location_verification(p_user_id uuid, p_shift_id uuid, p_event_type text, p_latitude numeric, p_longitude numeric, p_accuracy_meters numeric, p_captured_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_dancer_id uuid;
  v_shift public.shifts%rowtype;
  v_venue_latitude numeric;
  v_venue_longitude numeric;
  v_venue_active boolean;
  v_attempt_count integer;
  v_a double precision;
  v_distance_feet numeric;
  v_expires_at timestamptz;
  v_shift_json jsonb;
begin
  if p_event_type not in ('check_in', 'refresh') then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid_event', 'error', 'Unknown location verification action.');
  end if;

  select dp.id
  into v_dancer_id
  from public.dancer_profiles dp
  where dp.user_id = p_user_id
    and dp.status = 'approved'
  limit 1;

  if v_dancer_id is null then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'profile_not_approved', 'error', 'An approved dancer profile is required to check in.');
  end if;

  select s.*
  into v_shift
  from public.shifts s
  where s.id = p_shift_id
    and s.dancer_id = v_dancer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 404, 'code', 'shift_not_found', 'error', 'Shift not found.');
  end if;

  select v.latitude, v.longitude, v.is_active
  into v_venue_latitude, v_venue_longitude, v_venue_active
  from public.venues v
  where v.id = v_shift.venue_id;

  if v_shift.status <> 'posted' then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'shift_not_posted', 'error', 'Only posted shifts can be checked in.');
  end if;

  if v_venue_active is distinct from true or v_venue_latitude is null or v_venue_longitude is null then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'venue_location_missing', 'error', 'The venue location is not available for check-in.');
  end if;

  if p_latitude is null or p_latitude not between -90 and 90
    or p_longitude is null or p_longitude not between -180 and 180 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'invalid_coordinates', 'error', 'A valid location reading is required to check in.');
  end if;

  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 75 then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'poor_accuracy', 'error', 'Location accuracy must be within 75 meters. Move near an entrance or window and try again.');
  end if;

  if p_captured_at is null
    or p_captured_at < v_now - interval '30 seconds'
    or p_captured_at > v_now + interval '10 seconds' then
    return jsonb_build_object('ok', false, 'status', 400, 'code', 'stale_location', 'error', 'A fresh phone location reading is required. Try again.');
  end if;

  select count(*)::integer
  into v_attempt_count
  from public.shift_location_events e
  where e.dancer_id = v_dancer_id
    and e.occurred_at >= v_now - interval '1 minute';

  if v_attempt_count >= 10 then
    return jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited', 'error', 'Too many location checks. Wait one minute and try again.');
  end if;

  if p_event_type = 'check_in' and v_shift.checked_in_at is not null and v_shift.checked_out_at is null then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'already_checked_in', 'error', 'This shift is already checked in.');
  end if;

  if p_event_type = 'refresh' and (v_shift.checked_in_at is null or v_shift.checked_out_at is not null) then
    return jsonb_build_object('ok', false, 'status', 409, 'code', 'not_checked_in', 'error', 'Check in before refreshing your location.');
  end if;

  -- Timestamptz comparison correctly supports shifts that cross midnight.
  if v_now < v_shift.starts_at or v_now > v_shift.ends_at then
    return jsonb_build_object('ok', false, 'status', 403, 'code', 'outside_shift_hours', 'error', 'Check-in is only available during your posted shift hours.');
  end if;

  v_a :=
    power(sin(radians((v_venue_latitude::double precision - p_latitude::double precision) / 2)), 2)
    + cos(radians(p_latitude::double precision))
      * cos(radians(v_venue_latitude::double precision))
      * power(sin(radians((v_venue_longitude::double precision - p_longitude::double precision) / 2)), 2);
  v_distance_feet := round((20902231 * 2 * asin(least(1, sqrt(greatest(0, v_a)))))::numeric, 2);

  if v_distance_feet > 300 then
    insert into public.shift_location_events (
      shift_id, dancer_id, user_id, event_type, latitude, longitude,
      accuracy_meters, captured_at, distance_feet, accepted, reason_code
    ) values (
      v_shift.id, v_dancer_id, p_user_id, p_event_type, p_latitude, p_longitude,
      p_accuracy_meters, p_captured_at, v_distance_feet, false, 'outside_geofence'
    );

    if p_event_type = 'refresh' then
      update public.shifts
      set
        location_status = 'self_reported',
        working_status = 'self_reported',
        location_verification_expires_at = v_now,
        commission_tracking_stopped_at = v_now,
        updated_at = v_now
      where id = v_shift.id;
    end if;

    return jsonb_build_object(
      'ok', false,
      'status', 403,
      'code', 'outside_geofence',
      'error', 'Outside the club check-in radius. Move closer to the club and try again.',
      'distanceFeet', round(v_distance_feet),
      'requiredRadiusFeet', 300
    );
  end if;

  v_expires_at := least(v_shift.ends_at, v_now + interval '30 minutes');

  update public.shifts
  set
    checked_in_at = case when p_event_type = 'check_in' then v_now else checked_in_at end,
    checked_out_at = null,
    checkin_latitude = case when p_event_type = 'check_in' then p_latitude else checkin_latitude end,
    checkin_longitude = case when p_event_type = 'check_in' then p_longitude else checkin_longitude end,
    checkin_distance_feet = case when p_event_type = 'check_in' then v_distance_feet else checkin_distance_feet end,
    checkin_accuracy_meters = case when p_event_type = 'check_in' then p_accuracy_meters else checkin_accuracy_meters end,
    checkin_captured_at = case when p_event_type = 'check_in' then p_captured_at else checkin_captured_at end,
    last_location_latitude = p_latitude,
    last_location_longitude = p_longitude,
    last_location_accuracy_meters = p_accuracy_meters,
    last_location_captured_at = p_captured_at,
    last_location_verified_at = v_now,
    location_verification_expires_at = v_expires_at,
    location_status = 'location_confirmed',
    working_status = 'checked_in',
    commission_tracking_started_at = coalesce(commission_tracking_started_at, v_now),
    commission_tracking_stopped_at = null,
    ended_at = null,
    ended_reason = null,
    updated_at = v_now
  where id = v_shift.id
  returning jsonb_build_object(
    'id', id,
    'checked_in_at', checked_in_at,
    'checked_out_at', checked_out_at,
    'checkin_distance_feet', checkin_distance_feet,
    'checkin_accuracy_meters', checkin_accuracy_meters,
    'last_location_verified_at', last_location_verified_at,
    'location_verification_expires_at', location_verification_expires_at,
    'location_status', location_status,
    'working_status', working_status,
    'commission_tracking_started_at', commission_tracking_started_at,
    'commission_tracking_stopped_at', commission_tracking_stopped_at,
    'ended_at', ended_at,
    'ended_reason', ended_reason,
    'shift_summary', shift_summary
  ) into v_shift_json;

  insert into public.shift_location_events (
    shift_id, dancer_id, user_id, event_type, latitude, longitude,
    accuracy_meters, captured_at, distance_feet, accepted, reason_code
  ) values (
    v_shift.id, v_dancer_id, p_user_id, p_event_type, p_latitude, p_longitude,
    p_accuracy_meters, p_captured_at, v_distance_feet, true, null
  );

  return jsonb_build_object('ok', true, 'status', 200, 'shift', v_shift_json);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.prohibit_financial_record_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
begin
  raise exception using errcode = '22023', message = 'Financial records cannot be deleted.';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.provision_admin_venue_nfc_tag(p_tag_id uuid, p_venue_id uuid, p_admin_user_id uuid, p_tag_type text, p_label text, p_token_digest text)
 RETURNS nfc_tags
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tag public.nfc_tags;
  v_venue public.venues;
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_user_id and account.role = 'admin' and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;
  if p_tag_type not in ('dressing_room', 'cashier') then
    raise exception using errcode = '22023', message = 'Choose a dressing-room or cashier NFC sticker.';
  end if;
  if char_length(trim(p_label)) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'NFC sticker label must be 2 to 80 characters.';
  end if;
  if p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid NFC sticker secret.';
  end if;

  select venue.* into v_venue
  from public.venues venue
  where venue.id = p_venue_id and venue.is_active = true
  for key share;
  if not found then
    raise exception using errcode = 'P0002', message = 'An active venue is required.';
  end if;
  if (select count(*) from public.nfc_tags tag where tag.venue_id = p_venue_id and tag.status = 'active') >= 25 then
    raise exception using errcode = '54000', message = 'This venue already has the maximum of 25 active NFC stickers.';
  end if;

  insert into public.nfc_tags (
    id, venue_id, tag_type, label, token_digest, status, created_by_user_id
  ) values (
    p_tag_id, p_venue_id, p_tag_type, trim(p_label), p_token_digest, 'active', p_admin_user_id
  ) returning * into v_tag;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (p_admin_user_id, 'nfc_tag', v_tag.id, 'provision_nfc_sticker', v_venue.name || ' · ' || p_tag_type || ' · ' || trim(p_label));

  return v_tag;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.provision_app_account_safely(p_user_id uuid, p_role text, p_email text, p_display_name text, p_city text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_role public.user_role;
  v_state public.account_state;
begin
  if p_user_id is null or p_role is null or p_role not in ('customer','dancer','venue','admin') then
    raise exception using errcode = '22023', message = 'Invalid account provisioning input.';
  end if;
  insert into public.app_users(id, role, email, display_name)
  values(p_user_id, p_role::public.user_role, p_email, case when p_role = 'dancer' then 'Dancer' else p_display_name end)
  on conflict(id) do nothing;
  select role, account_state into v_role, v_state
    from public.app_users where id = p_user_id for update;
  if v_role::text <> p_role then
    raise exception using errcode = '22023', message = 'Existing account type must be preserved.';
  end if;
  -- Preserve lifecycle state and do not recreate children while an account is inactive.
  if v_state <> 'active' then return true; end if;

  if p_role = 'customer' and not exists(select 1 from public.customer_profiles where user_id = p_user_id) then
    insert into public.customer_profiles(user_id, city) values(p_user_id, coalesce(p_city, ''))
    on conflict(user_id) do nothing;
  elsif p_role = 'dancer' and not exists(select 1 from public.dancer_profiles where user_id = p_user_id) then
    insert into public.dancer_profiles(user_id, real_name, stage_name, slug, city, status,
      verification_status, photo_review_status, is_public, approved_at, disabled_at, identity_saved_at)
    values(p_user_id, 'Verification pending', '', 'dancer-' || p_user_id::text, coalesce(p_city, ''),
      'draft', 'pending', 'pending', false, null, null, null)
    on conflict(user_id) do nothing;
  end if;
  return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.publish_approved_dancer_avatar(p_record_id uuid, p_expected_updated_at timestamp with time zone, p_storage_path text, p_reason_codes jsonb, p_category_flags jsonb, p_category_scores jsonb, p_provider_flagged boolean, p_reviewer_id uuid DEFAULT NULL::uuid, p_review_notes text DEFAULT NULL::text, p_legacy_avatar_path text DEFAULT NULL::text, p_legacy_avatar_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_owner uuid;
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_record public.image_moderation_records%rowtype;
  v_previous text;
  v_prefix text;
  v_now timestamptz;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'AVATAR_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_record_id is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or p_storage_path is null or length(p_storage_path)>1024 or p_storage_path<>btrim(p_storage_path)
    or coalesce(jsonb_typeof(p_reason_codes),'')<>'array' or coalesce(jsonb_typeof(p_category_flags),'')<>'object'
    or coalesce(jsonb_typeof(p_category_scores),'')<>'object'
    or octet_length(p_reason_codes::text)+octet_length(p_category_flags::text)+octet_length(p_category_scores::text)>65536
    or length(coalesce(p_review_notes,''))>4000
    or (p_legacy_avatar_updated_at is not null and not isfinite(p_legacy_avatar_updated_at)) then
    raise exception 'AVATAR_INVALID_INPUT' using errcode='22023';
  end if;
  select user_id into v_owner from public.image_moderation_records where id=p_record_id;
  if not found then raise exception 'AVATAR_REVIEW_MISSING' using errcode='P0002';end if;
  select * into v_account from public.app_users where id=v_owner for update;
  if not found or v_account.role is distinct from 'dancer' then raise exception 'AVATAR_OWNER_INVALID' using errcode='42501';end if;
  if p_reviewer_id is null then
    if v_account.account_state is distinct from 'active' or v_account.dmca_suspended_at is not null then
      raise exception 'AVATAR_ACCOUNT_UNAVAILABLE' using errcode='42501';
    end if;
  else
    perform 1 from public.app_users where id=p_reviewer_id and role='admin' and account_state='active' for share;
    if not found then raise exception 'AVATAR_REVIEWER_FORBIDDEN' using errcode='42501';end if;
  end if;
  select * into v_profile from public.dancer_profiles where user_id=v_owner for update;
  if not found then raise exception 'AVATAR_PROFILE_MISSING' using errcode='P0002';end if;
  select * into v_record from public.image_moderation_records where id=p_record_id and user_id=v_owner for update;
  if not found or v_record.upload_context<>'profile_avatar' or v_record.image_id is not null then
    raise exception 'AVATAR_REVIEW_CHANGED' using errcode='40001';
  end if;
  -- A replay can only acknowledge the result that is still the current avatar.
  if v_record.decision='approved' and v_record.status='approved' then
    if v_record.final_storage_path is null or v_profile.avatar_storage_path is distinct from v_record.final_storage_path
      or not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=v_record.final_storage_path) then
      raise exception 'AVATAR_RESULT_UNAVAILABLE' using errcode='40001';
    end if;
    return jsonb_build_object('record',to_jsonb(v_record),'profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
      'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
      'previous_storage_path',null,'already_published',true);
  end if;
  if v_record.updated_at is distinct from p_expected_updated_at or v_record.decision<>'review'
    or v_record.status in('approved','rejected') then
    raise exception 'AVATAR_REVIEW_CHANGED' using errcode='40001';
  end if;
  if v_record.avatar_expected_updated_at is null then
    -- Historical pending reviews have no trustworthy upload intent. Only a fresh
    -- explicit administrator decision may bind them to the initial profile snapshot.
    if p_reviewer_id is null then raise exception 'AVATAR_INTENT_MISSING' using errcode='40001';end if;
    if v_profile.avatar_storage_path is distinct from p_legacy_avatar_path
      or v_profile.avatar_updated_at is distinct from p_legacy_avatar_updated_at then
      raise exception 'AVATAR_CHANGED' using errcode='40001';
    end if;
  elsif v_profile.avatar_storage_path is distinct from v_record.avatar_expected_path
    or v_profile.avatar_updated_at is distinct from v_record.avatar_expected_updated_at then
    raise exception 'AVATAR_CHANGED' using errcode='40001';
  end if;
  v_prefix:=v_owner::text || '/' || v_profile.id::text || '/avatar/';
  if left(p_storage_path,length(v_prefix))<>v_prefix or p_storage_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'AVATAR_STORAGE_OWNER_MISMATCH' using errcode='42501';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=p_storage_path) then
    raise exception 'AVATAR_STORAGE_MISSING' using errcode='P0002';
  end if;
  v_previous:=v_profile.avatar_storage_path;v_now:=clock_timestamp();
  update public.dancer_profiles set avatar_storage_path=p_storage_path,avatar_updated_at=v_now
    where id=v_profile.id returning * into v_profile;
  update public.image_moderation_records set final_storage_path=p_storage_path,image_id=null,
    decision='approved',status='approved',reason_codes=p_reason_codes,category_flags=p_category_flags,
    category_scores=p_category_scores,provider_flagged=coalesce(p_provider_flagged,false),
    error_code=null,last_error_code=null,last_error_message=null,next_attempt_at=null,locked_at=null,
    completed_at=v_now,updated_at=v_now,
    reviewed_by=coalesce(p_reviewer_id,reviewed_by),
    reviewed_at=case when p_reviewer_id is not null then v_now else reviewed_at end,
    review_decision=case when p_reviewer_id is not null then 'approved' else review_decision end,
    review_notes=case when p_reviewer_id is not null then nullif(p_review_notes,'') else review_notes end
    where id=p_record_id returning * into v_record;
  return jsonb_build_object('record',to_jsonb(v_record),'profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
    'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
    'previous_storage_path',v_previous,'already_published',false);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.publish_approved_dancer_gallery_photo(p_record_id uuid, p_expected_updated_at timestamp with time zone, p_storage_path text, p_reason_codes jsonb, p_category_flags jsonb, p_category_scores jsonb, p_provider_flagged boolean, p_alt_text text DEFAULT NULL::text, p_reviewer_id uuid DEFAULT NULL::uuid, p_review_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_owner uuid;
  v_profile public.dancer_profiles%rowtype;
  v_record public.image_moderation_records%rowtype;
  v_photo public.dancer_photos%rowtype;
  v_old_photo public.dancer_photos%rowtype;
  v_context text;
  v_primary boolean;
  v_sort integer;
  v_preferred numeric;
  v_superseded jsonb := '[]'::jsonb;
  v_now timestamptz;
begin
  if p_record_id is null or p_expected_updated_at is null or p_storage_path is null
    or length(p_storage_path) > 1024 or p_storage_path <> btrim(p_storage_path)
    or coalesce(jsonb_typeof(p_reason_codes), '') <> 'array'
    or coalesce(jsonb_typeof(p_category_flags), '') <> 'object'
    or coalesce(jsonb_typeof(p_category_scores), '') <> 'object'
    or octet_length(p_reason_codes::text) + octet_length(p_category_flags::text)
      + octet_length(p_category_scores::text) > 65536
    or length(coalesce(p_alt_text, '')) > 2000
    or length(coalesce(p_review_notes, '')) > 4000 then
    raise exception 'PHOTO_PUBLICATION_INVALID_INPUT' using errcode = '22023';
  end if;

  select r.user_id into v_owner from public.image_moderation_records r where r.id = p_record_id;
  if not found then
    raise exception 'PHOTO_PUBLICATION_RECORD_MISSING' using errcode = 'P0002';
  end if;

  -- Every publication takes the profile lock before the review lock. Do not
  -- hold a database lock while uploading bytes or calling a moderation vendor.
  select d.* into v_profile from public.dancer_profiles d where d.user_id = v_owner for update;
  if not found then
    raise exception 'PHOTO_PUBLICATION_PROFILE_MISSING' using errcode = 'P0002';
  end if;
  select r.* into v_record from public.image_moderation_records r
    where r.id = p_record_id and r.user_id = v_owner for update;
  if not found then
    raise exception 'PHOTO_PUBLICATION_CONFLICT' using errcode = '40001';
  end if;
  v_now := clock_timestamp();
  if not exists(select 1 from public.app_users a where a.id=v_owner and a.role='dancer') then
    raise exception 'PHOTO_PUBLICATION_OWNER_INVALID' using errcode = '42501';
  end if;

  if p_reviewer_id is not null then
    if not exists(select 1 from public.app_users a where a.id = p_reviewer_id
      and a.role = 'admin' and a.account_state = 'active') then
      raise exception 'PHOTO_PUBLICATION_REVIEWER_FORBIDDEN' using errcode = '42501';
    end if;
  elsif not exists(select 1 from public.app_users a where a.id = v_owner
    and a.role = 'dancer' and a.account_state = 'active' and a.dmca_suspended_at is null) then
    raise exception 'PHOTO_PUBLICATION_ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  v_context := lower(btrim(v_record.upload_context));
  v_primary := v_context = 'profile_main' or v_context like 'profile_main:%';
  if not v_primary and v_context <> 'profile_gallery' and v_context !~ '^profile_gallery:[0-9]+$' then
    raise exception 'PHOTO_PUBLICATION_INVALID_CONTEXT' using errcode = '22023';
  end if;
  if left(p_storage_path, length(v_owner::text || '/' || v_profile.id::text || '/'))
      <> v_owner::text || '/' || v_profile.id::text || '/'
    or p_storage_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'PHOTO_PUBLICATION_STORAGE_OWNER_MISMATCH' using errcode = '42501';
  end if;

  -- A lost response must return the already committed identity, never create
  -- another photo. A deleted or inconsistent result is not resurrected.
  if v_record.decision = 'approved' and v_record.status = 'approved' then
    select p.* into v_photo from public.dancer_photos p where p.id = v_record.image_id
      and p.dancer_id = v_profile.id and p.storage_path = v_record.final_storage_path
      and p.review_status = 'approved';
    if not found then
      raise exception 'PHOTO_PUBLICATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;
    return jsonb_build_object('photo',to_jsonb(v_photo),'record',to_jsonb(v_record),
      'already_published',true,'superseded_storage_paths','[]'::jsonb);
  end if;
  if v_record.updated_at is distinct from p_expected_updated_at
    or v_record.decision <> 'review' or v_record.status in ('approved','rejected')
    or v_record.image_id is not null then
    raise exception 'PHOTO_PUBLICATION_CONFLICT' using errcode = '40001';
  end if;

  if not exists(select 1 from storage.objects o where o.bucket_id = 'dancer-photos' and o.name = p_storage_path) then
    raise exception 'PHOTO_PUBLICATION_STORAGE_MISSING' using errcode = 'P0002';
  end if;
  if exists(select 1 from public.dancer_photos p where p.storage_path = p_storage_path) then
    raise exception 'PHOTO_PUBLICATION_STORAGE_ALREADY_USED' using errcode = '23505';
  end if;

  if v_record.photo_publication_mode = 'replace' then
    select p.* into v_old_photo from public.dancer_photos p
      where p.id = v_record.replacement_photo_id and p.dancer_id = v_profile.id for update;
    if not found or v_old_photo.is_primary is distinct from v_primary then
      raise exception 'PHOTO_PUBLICATION_REPLACEMENT_CHANGED' using errcode = '40001';
    end if;
    v_sort := v_old_photo.sort_order;
    v_superseded := jsonb_build_array(v_old_photo.storage_path);
    -- Withdraw only older outstanding reviews linked to the exact replaced
    -- photo. Keep their history, and keep their stale identity expectations.
    update public.image_moderation_records set decision='rejected',status='rejected',
      error_code='photo_replaced',completed_at=v_now,updated_at=v_now
      where image_id=v_old_photo.id and user_id=v_owner and id<>p_record_id and decision='review';
    delete from public.dancer_photos where id=v_old_photo.id and dancer_id=v_profile.id;
  else
    if (select count(*) from public.dancer_photos p where p.dancer_id=v_profile.id
      and p.review_status in ('approved','pending')) >= 50 then
      raise exception 'PHOTO_PUBLICATION_LIBRARY_FULL' using errcode = '23514';
    end if;
    if v_primary then
      if exists(select 1 from public.dancer_photos p where p.dancer_id=v_profile.id
        and p.is_primary and p.review_status in ('approved','pending')) then
        raise exception 'PHOTO_PUBLICATION_PRIMARY_EXISTS' using errcode = '40001';
      end if;
      v_sort := 0;
    else
      if v_context ~ '^profile_gallery:[0-9]{1,3}$' then
        v_preferred := substring(v_context from '[0-9]+$')::numeric;
        if v_preferred between 1 and 50 and not exists(select 1 from public.dancer_photos p
          where p.dancer_id=v_profile.id and not p.is_primary and p.sort_order=v_preferred
          and p.review_status in ('approved','pending')) then
          v_sort := v_preferred::integer;
        end if;
      end if;
      if v_sort is null then
        select n into v_sort from generate_series(1,50) n where not exists(
          select 1 from public.dancer_photos p where p.dancer_id=v_profile.id
            and not p.is_primary and p.sort_order=n and p.review_status in ('approved','pending')
        ) order by n limit 1;
      end if;
      if v_sort is null then
        raise exception 'PHOTO_PUBLICATION_LIBRARY_FULL' using errcode = '23514';
      end if;
    end if;
  end if;

  insert into public.dancer_photos(dancer_id,storage_path,is_primary,sort_order,alt_text,review_status)
    values(v_profile.id,p_storage_path,v_primary,v_sort,p_alt_text,'approved') returning * into v_photo;
  update public.image_moderation_records set image_id=v_photo.id,final_storage_path=p_storage_path,
    upload_context=case when v_primary then 'profile_main' else 'profile_gallery:' || v_sort::text end,
    decision='approved',status='approved',reason_codes=p_reason_codes,category_flags=p_category_flags,
    category_scores=p_category_scores,provider_flagged=coalesce(p_provider_flagged,false),
    error_code=null,last_error_code=null,last_error_message=null,next_attempt_at=null,locked_at=null,
    completed_at=v_now,updated_at=v_now,
    reviewed_by=coalesce(p_reviewer_id,reviewed_by),
    reviewed_at=case when p_reviewer_id is not null then v_now else reviewed_at end,
    review_decision=case when p_reviewer_id is not null then 'approved' else review_decision end,
    review_notes=case when p_reviewer_id is not null then nullif(p_review_notes,'') else review_notes end
    where id=p_record_id returning * into v_record;
  update public.dancer_profiles set photo_review_status='approved' where id=v_profile.id;
  return jsonb_build_object('photo',to_jsonb(v_photo),'record',to_jsonb(v_record),
    'already_published',false,'superseded_storage_paths',v_superseded);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.recenter_dancer_avatar_safely(p_reviewer_id uuid, p_profile_id uuid, p_expected_avatar_path text, p_expected_avatar_updated_at timestamp with time zone, p_storage_path text, p_source_path text, p_source_photo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_owner uuid;
  v_profile public.dancer_profiles%rowtype;
  v_photo public.dancer_photos%rowtype;
  v_prefix text;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'AVATAR_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_reviewer_id is null or p_profile_id is null or p_storage_path is null or p_source_path is null
    or p_expected_avatar_path is null or p_expected_avatar_path=''
    or length(p_storage_path)>1024 or p_storage_path<>btrim(p_storage_path)
    or length(p_source_path)>1024
    or (p_expected_avatar_updated_at is not null and not isfinite(p_expected_avatar_updated_at)) then
    raise exception 'AVATAR_INVALID_INPUT' using errcode='22023';
  end if;
  select user_id into v_owner from public.dancer_profiles where id=p_profile_id;
  if not found then raise exception 'AVATAR_PROFILE_MISSING' using errcode='P0002';end if;
  perform 1 from public.app_users where id=v_owner and role='dancer' for update;
  if not found then raise exception 'AVATAR_OWNER_INVALID' using errcode='42501';end if;
  perform 1 from public.app_users where id=p_reviewer_id and role='admin' and account_state='active' for share;
  if not found then raise exception 'AVATAR_REVIEWER_FORBIDDEN' using errcode='42501';end if;
  select * into v_profile from public.dancer_profiles where id=p_profile_id and user_id=v_owner for update;
  if not found or v_profile.avatar_storage_path is distinct from p_expected_avatar_path
    or v_profile.avatar_updated_at is distinct from p_expected_avatar_updated_at then
    raise exception 'AVATAR_CHANGED' using errcode='40001';
  end if;
  if p_source_photo_id is null then
    if p_source_path is distinct from p_expected_avatar_path then
      raise exception 'AVATAR_SOURCE_CHANGED' using errcode='40001';
    end if;
  else
    select * into v_photo from public.dancer_photos where id=p_source_photo_id and dancer_id=p_profile_id for update;
    if not found or v_photo.storage_path is distinct from p_source_path or v_photo.review_status is distinct from 'approved' then
      raise exception 'AVATAR_SOURCE_CHANGED' using errcode='40001';
    end if;
  end if;
  v_prefix:=v_owner::text || '/' || p_profile_id::text || '/avatar/';
  if left(p_storage_path,length(v_prefix))<>v_prefix or p_storage_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'AVATAR_STORAGE_OWNER_MISMATCH' using errcode='42501';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=p_storage_path)
    or not exists(select 1 from storage.objects where bucket_id='dancer-photos' and name=p_source_path) then
    raise exception 'AVATAR_STORAGE_MISSING' using errcode='P0002';
  end if;
  update public.dancer_profiles set avatar_storage_path=p_storage_path,avatar_updated_at=clock_timestamp()
    where id=p_profile_id returning * into v_profile;
  insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
    values(p_reviewer_id,'dancer_profile',p_profile_id,'recenter_dancer_avatar',
      case when p_source_photo_id is null then 'Source: avatar' else 'Source: approved photo' end);
  return jsonb_build_object('profile',jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,
    'avatar_storage_path',v_profile.avatar_storage_path,'avatar_updated_at',v_profile.avatar_updated_at),
    'previous_storage_path',p_expected_avatar_path);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_account_recovery_event(p_event_type text, p_role text, p_request_ip_hash text, p_subject_hash text, p_window_seconds integer, p_ip_limit integer, p_subject_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_since timestamptz; v_ip_count integer; v_subject_count integer; v_allowed boolean;
begin
if p_event_type is null or p_role is null or p_window_seconds is null or p_ip_limit is null or p_subject_limit is null or p_event_type not in ('password_reset','email_lookup') or p_role not in ('customer','dancer','venue','admin') or coalesce(length(p_request_ip_hash),0)<>64 or coalesce(length(p_subject_hash),0)<>64 or p_window_seconds<60 or p_window_seconds>86400 or p_ip_limit<1 or p_subject_limit<1 then raise exception using errcode='22023',message='Invalid account recovery rate limit input.'; end if;
perform pg_advisory_xact_lock(least(hashtextextended(p_event_type||':ip:'||p_request_ip_hash,0),hashtextextended(p_event_type||':subject:'||p_subject_hash,0)));
perform pg_advisory_xact_lock(greatest(hashtextextended(p_event_type||':ip:'||p_request_ip_hash,0),hashtextextended(p_event_type||':subject:'||p_subject_hash,0)));
v_since:=now()-make_interval(secs=>p_window_seconds);
select count(*) into v_ip_count from public.account_recovery_events where event_type=p_event_type and request_ip_hash=p_request_ip_hash and created_at>=v_since;
select count(*) into v_subject_count from public.account_recovery_events where event_type=p_event_type and subject_hash=p_subject_hash and created_at>=v_since;
v_allowed:=v_ip_count<p_ip_limit and v_subject_count<p_subject_limit;
insert into public.account_recovery_events(event_type,account_role,request_ip_hash,subject_hash,outcome) values(p_event_type,p_role,p_request_ip_hash,p_subject_hash,case when v_allowed then 'accepted' else 'rate_limited' end);
return v_allowed;
end; $function$
;
CREATE OR REPLACE FUNCTION public.record_dancer_earning_status_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_type text := 'system';
begin
  if auth.uid() is not null then
    if exists (
      select 1
      from public.app_users
      where id = auth.uid()
        and role = 'admin'
        and account_state = 'active'
    ) then
      v_actor_type := 'admin';
    elsif exists (
      select 1
      from public.dancer_profiles
      where user_id = auth.uid()
    ) then
      v_actor_type := 'dancer';
    end if;
  end if;

  if tg_op = 'INSERT' then
    insert into public.dancer_earning_status_history (
      earning_id, from_status, to_status, actor_user_id, actor_type, reason, metadata
    ) values (
      new.id,
      null,
      new.status,
      auth.uid(),
      v_actor_type,
      coalesce(new.reversal_reason, new.hold_reason),
      jsonb_build_object('payout_id', new.payout_batch_id, 'provider', new.payment_provider)
    );
  elsif old.status is distinct from new.status then
    insert into public.dancer_earning_status_history (
      earning_id, from_status, to_status, actor_user_id, actor_type, reason, metadata
    ) values (
      new.id,
      old.status,
      new.status,
      auth.uid(),
      v_actor_type,
      coalesce(new.reversal_reason, new.hold_reason),
      jsonb_build_object('payout_id', new.payout_batch_id, 'provider', new.payment_provider)
    );
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_deal_lifecycle_event_safely(p_token text, p_event_type text, p_actor_user_id uuid DEFAULT NULL::uuid, p_session_id text DEFAULT NULL::text, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_device_fingerprint text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_id uuid;
  v_status text;
  v_now timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,160}$'
    or p_event_type is null or p_event_type not in ('saved','shared','scanner_opened')
    or (p_session_id is not null and p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception 'INVALID_REDEMPTION_ACTIVITY' using errcode = '22023';
  end if;

  select r.id, r.status into v_id, v_status
    from public.qr_redemptions r where r.redemption_token = p_token for update;
  if not found then return null; end if;
  v_now := clock_timestamp();

  if p_event_type = 'saved' then
    update public.qr_redemptions set saved_at = v_now where id = v_id and saved_at is null;
  elsif p_event_type = 'shared' then
    update public.qr_redemptions set shared_at = v_now where id = v_id and shared_at is null;
  else
    update public.qr_redemptions set first_scanned_at = v_now where id = v_id and first_scanned_at is null;
  end if;

  insert into public.qr_redemption_events (
    qr_redemption_id, event_type, actor_user_id, session_id, ip_address, user_agent, audit, occurred_at
  ) values (
    v_id, p_event_type, p_actor_user_id, p_session_id, p_ip_address, p_user_agent,
    jsonb_build_object('device_fingerprint', p_device_fingerprint), v_now
  );
  return jsonb_build_object('id',v_id,'eventType',p_event_type,'status',v_status);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_mydancr_tv_review_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status in ('submitted', 'moderating')
    and new.status in ('approved', 'rejected')
    and new.status is distinct from old.status
  then
    insert into public.notifications (
      recipient_id,
      notification_type,
      channel,
      title,
      body,
      payload,
      sent_at
    )
    values (
      new.submitted_by,
      'tv_video_status',
      'in_app',
      case
        when new.status = 'approved' then 'MyDancr TV video approved'
        else 'MyDancr TV video needs changes'
      end,
      case
        when new.status = 'approved' then 'Your video is live on MyDancr TV.'
        else coalesce(new.review_notes, 'Your video was not approved.')
      end,
      jsonb_build_object(
        'videoId', new.id,
        'status', new.status,
        'moderationDecision', new.moderation_decision
      ),
      coalesce(new.reviewed_at, now())
    );

    insert into public.admin_actions (
      admin_id,
      target_type,
      target_id,
      action,
      notes
    )
    values (
      new.reviewed_by,
      'mydancr_tv_video',
      new.id,
      case
        when new.reviewed_by is null then 'ai_' || new.status
        else new.status
      end,
      coalesce(
        new.review_notes,
        array_to_string(new.moderation_reason_codes, ', ')
      )
    );
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_nfc_tag_scan(p_tag_id uuid)
 RETURNS nfc_tags
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tag public.nfc_tags;
begin
  update public.nfc_tags
  set
    scan_count = scan_count + 1,
    last_scanned_at = now()
  where id = p_tag_id and status = 'active'
  returning * into v_tag;

  return v_tag;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.redeem_venue_signup_code(p_code_id uuid, p_user_id uuid)
 RETURNS venues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_venue_id uuid;
  v_venue public.venues;
  v_code public.venue_claim_codes;
begin
  select venue_id into v_venue_id
  from public.venue_claim_codes
  where id = p_code_id;

  if not found then
    raise exception using errcode = '42501', message = 'This venue access code is invalid or no longer active.';
  end if;

  select * into v_venue
  from public.venues
  where id = v_venue_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'This venue access code is invalid or no longer active.';
  end if;

  select * into v_code
  from public.venue_claim_codes
  where id = p_code_id
  for update;

  if not found
    or v_code.venue_id <> v_venue_id
    or v_code.expires_at <= now()
    or v_code.used_at is not null
    or v_code.revoked_at is not null
    or not exists (
      select 1
      from public.venue_signup_requests request
      where request.status = 'approved'
        and request.matched_venue_id = v_venue_id
        and request.access_code_id = p_code_id
    )
  then
    raise exception using errcode = '42501', message = 'This venue access code is invalid or no longer active.';
  end if;

  if v_venue.owner_user_id is not null then
    raise exception using errcode = '23505', message = 'This venue already has a manager account.';
  end if;
  if not exists (
    select 1 from public.app_users
    where id = p_user_id and role = 'venue' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active venue account is required.';
  end if;
  if exists (
    select 1 from public.venues
    where owner_user_id = p_user_id and id <> v_venue.id
  ) then
    raise exception using errcode = '23505', message = 'This account already manages another venue.';
  end if;

  update public.venues
  set owner_user_id = p_user_id, updated_at = now()
  where id = v_venue.id
  returning * into v_venue;

  update public.venue_claim_codes
  set used_at = now(), used_by = p_user_id
  where id = v_code.id;

  return v_venue;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.redeem_venue_team_invitation(p_invitation_id uuid, p_user_id uuid)
 RETURNS venue_team_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invitation public.venue_team_invitations%rowtype;
  v_account public.app_users%rowtype;
  v_member public.venue_team_members%rowtype;
  v_now timestamptz := now();
begin
  select * into v_invitation
  from public.venue_team_invitations
  where id = p_invitation_id
  for update;

  if not found
    or v_invitation.accepted_at is not null
    or v_invitation.revoked_at is not null
    or v_invitation.expires_at <= v_now then
    raise exception using errcode = '22023', message = 'This venue team invitation is no longer active.';
  end if;

  select * into v_account
  from public.app_users
  where id = p_user_id and role = 'venue' and account_state = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'An active venue account is required.';
  end if;

  if lower(coalesce(v_account.email, '')) <> lower(v_invitation.email) then
    raise exception using errcode = '42501', message = 'Sign in with the email address that received this invitation.';
  end if;

  if exists (
    select 1 from public.venues venue
    where venue.owner_user_id = p_user_id and venue.id <> v_invitation.venue_id
  ) then
    raise exception using errcode = '42501', message = 'Venue owners cannot join a different venue team.';
  end if;

  if exists (
    select 1 from public.venue_team_members member
    where member.user_id = p_user_id
      and member.status = 'active'
      and member.venue_id <> v_invitation.venue_id
  ) then
    raise exception using errcode = '42501', message = 'This account already belongs to another venue team.';
  end if;

  insert into public.venue_team_members (
    venue_id, user_id, role, status, invited_by_user_id, joined_at, removed_at, updated_at
  ) values (
    v_invitation.venue_id, p_user_id, v_invitation.role, 'active',
    v_invitation.invited_by_user_id, v_now, null, v_now
  )
  on conflict (venue_id, user_id) do update set
    role = excluded.role,
    status = 'active',
    invited_by_user_id = excluded.invited_by_user_id,
    joined_at = v_now,
    removed_at = null,
    updated_at = v_now
  returning * into v_member;

  update public.venue_team_invitations set
    accepted_at = v_now,
    accepted_by_user_id = p_user_id,
    updated_at = v_now
  where id = v_invitation.id;

  return v_member;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.register_and_activate_dancer_tap(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
 v_enrollment jsonb;
 v_presence jsonb;
 v_audit jsonb := coalesce(p_audit,'{}'::jsonb);
begin
 if p_tag_id is null or p_dancer_user_id is null or p_session_id is null
   or jsonb_typeof(v_audit) is distinct from 'object' then
   raise exception 'DANCER_TAP_INVALID_INPUT' using errcode='22023';
 end if;
 v_enrollment := public.register_dancer_nfc_enrollment(p_tag_id,p_dancer_user_id,p_session_id,v_audit);
 if jsonb_typeof(v_enrollment) is distinct from 'object'
   or coalesce(v_enrollment->>'enrollmentStatus','') not in('pending','completed')
   or (v_enrollment->>'enrollmentId') is null then
   raise exception 'DANCER_TAP_ENROLLMENT_NOT_CONFIRMED' using errcode='40001';
 end if;
 if v_enrollment->>'enrollmentStatus'='pending' then return v_enrollment; end if;
 v_presence := public.activate_dancer_shift_from_nfc(p_tag_id,p_dancer_user_id,p_session_id,v_audit);
 if jsonb_typeof(v_presence) is distinct from 'object'
   or not(v_presence ?& array['shiftCheckedIn','tapApplied','alreadyWorking','cooldownActive','shiftId','workingUntil','nextTapAllowedAt','venueId'])
   or jsonb_typeof(v_presence->'shiftCheckedIn') is distinct from 'boolean'
   or jsonb_typeof(v_presence->'tapApplied') is distinct from 'boolean'
   or jsonb_typeof(v_presence->'alreadyWorking') is distinct from 'boolean'
   or jsonb_typeof(v_presence->'cooldownActive') is distinct from 'boolean'
   or (v_presence->>'shiftId') is null or (v_presence->>'venueId') is null then
   raise exception 'DANCER_TAP_PRESENCE_NOT_CONFIRMED' using errcode='40001';
 end if;
 return v_enrollment||v_presence;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.register_dancer_nfc_enrollment(p_tag_id uuid, p_dancer_user_id uuid, p_session_id uuid, p_audit jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tag public.nfc_tags;
  v_venue public.venues;
  v_enrollment public.dancer_nfc_enrollments;
  v_result jsonb;
  v_ready boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  -- Both fresh taps and deferred completion take this lock before any
  -- tag or enrollment row lock, so their opposite row access orders cannot
  -- deadlock each other for the same dancer. Released with the transaction.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mydancr:dancer-nfc-enrollment:' || p_dancer_user_id::text, 0)
  );

  select tag.* into v_tag
  from public.nfc_tags tag
  where tag.id = p_tag_id and tag.status = 'active' and tag.tag_type = 'dressing_room'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'This dressing-room NFC tag is inactive.';
  end if;

  select venue.* into v_venue
  from public.venues venue
  join public.app_users owner on owner.id = venue.owner_user_id
  where venue.id = v_tag.venue_id and venue.is_active = true
    and owner.role = 'venue' and owner.account_state = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'This venue is not active.';
  end if;

  if not exists (
    select 1 from public.app_users account
    where account.id = p_dancer_user_id and account.role = 'dancer' and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active dancer account is required.';
  end if;

  insert into public.dancer_nfc_enrollments (
    dancer_user_id, venue_id, nfc_tag_id, status, tapped_at, expires_at,
    completed_at, last_attempted_at, audit, updated_at
  ) values (
    p_dancer_user_id, v_venue.id, v_tag.id, 'pending', v_now, v_now + interval '7 days',
    null, v_now, p_audit || jsonb_build_object('sessionId', p_session_id), v_now
  ) on conflict (dancer_user_id, venue_id) do update set
    nfc_tag_id = excluded.nfc_tag_id,
    status = case when public.dancer_nfc_enrollments.status = 'completed' then 'completed' else 'pending' end,
    tapped_at = excluded.tapped_at,
    expires_at = excluded.expires_at,
    last_attempted_at = excluded.last_attempted_at,
    audit = public.dancer_nfc_enrollments.audit || excluded.audit,
    updated_at = excluded.updated_at
  returning * into v_enrollment;

  select exists (
    select 1
    from public.dancer_profiles dancer
    where dancer.user_id = p_dancer_user_id
      and dancer.status not in ('rejected', 'disabled')
      and dancer.disabled_at is null
      and nullif(trim(dancer.stage_name), '') is not null
      and nullif(trim(dancer.city), '') is not null
      and (
        (
          dancer.status = 'approved'
          and dancer.verification_status = 'approved'
          and dancer.is_public = true
        )
        or (
          dancer.status = 'pending_review'
          and nullif(trim(dancer.avatar_storage_path), '') is not null
          and exists (
            select 1 from public.dancer_photos photo
            where photo.dancer_id = dancer.id and photo.review_status = 'approved'
          )
        )
      )
  ) into v_ready;

  if v_ready then
    v_result := public.approve_dancer_venue_affiliation_from_nfc(
      p_tag_id,
      p_dancer_user_id,
      p_session_id,
      p_audit
    );
    update public.dancer_nfc_enrollments set
      status = 'completed',
      completed_at = v_now,
      last_attempted_at = v_now,
      updated_at = v_now
    where id = v_enrollment.id;
    return v_result || jsonb_build_object(
      'enrollmentStatus', 'completed',
      'enrollmentId', v_enrollment.id
    );
  end if;

  insert into public.nfc_tap_events (
    nfc_tag_id, venue_id, tag_type, event_type, actor_user_id, session_id,
    ip_address, user_agent, device_fingerprint, audit
  ) values (
    v_tag.id, v_venue.id, v_tag.tag_type, 'opened', p_dancer_user_id, p_session_id,
    p_audit->>'ip_address', p_audit->>'user_agent', p_audit->>'device_fingerprint',
    p_audit || jsonb_build_object('enrollmentId', v_enrollment.id, 'status', 'pending_profile_setup')
  );
  update public.nfc_tags set
    last_tapped_at = v_now,
    tap_count = tap_count + 1,
    updated_at = v_now
  where id = v_tag.id;

  return jsonb_build_object(
    'enrollmentStatus', 'pending',
    'enrollmentId', v_enrollment.id,
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug,
    'profileActivated', false,
    'shiftCheckedIn', false
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reject_admin_venue_referral_fee_request(p_admin_id uuid, p_request_id uuid, p_decision_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request public.venue_referral_fee_change_requests;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1
    from public.app_users account
    where account.id = p_admin_id
      and account.role = 'admin'
      and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active MyDancr admin account required.';
  end if;
  if char_length(trim(coalesce(p_decision_note, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'A decision note between 3 and 500 characters is required.';
  end if;

  update public.venue_referral_fee_change_requests
  set status = 'rejected',
      reviewed_by_admin_user_id = p_admin_id,
      reviewed_at = v_now,
      decision_note = trim(p_decision_note),
      updated_at = v_now
  where id = p_request_id
    and status = 'pending'
  returning * into v_request;
  if not found then
    raise exception using errcode = '22023', message = 'This fee change request is no longer pending.';
  end if;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_referral_fee_request',
    v_request.id,
    'reject_referral_fee_change',
    trim(p_decision_note)
  );

  return v_request.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reject_retired_payout_provider()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if lower(trim(new.payment_provider)) = 'bitsafe' then
    if tg_op = 'INSERT' then
      raise exception 'The selected payout provider is no longer supported.' using errcode = '22023';
    elsif old.payment_provider is distinct from new.payment_provider then
      raise exception 'The selected payout provider is no longer supported.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.release_dancer_payout_batch(p_batch_id uuid, p_status text, p_failure_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_payout public.dancer_payout_batches%rowtype; v_final_status text;
begin
  v_final_status := case when p_status in ('canceled') then 'canceled' else 'failed' end;
  select * into v_payout from public.dancer_payout_batches where id = p_batch_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payout not found.'; end if;
  if v_payout.status not in ('requested', 'processing') then
    raise exception using errcode = '22023', message = 'Payout cannot be released from its current status.';
  end if;
  update public.commission_events set status = 'available', payout_batch_id = null, payment_provider = null,
    metadata = metadata || jsonb_build_object('released_payout_id', p_batch_id,
      'release_reason', left(coalesce(p_failure_message, ''), 500))
  where payout_batch_id = p_batch_id and status = 'payout_processing';
  update public.dancer_payout_batches set status = v_final_status,
    failed_at = case when v_final_status = 'failed' then now() else failed_at end,
    canceled_at = case when v_final_status = 'canceled' then now() else canceled_at end,
    failure_message = left(coalesce(p_failure_message, 'Payout was not completed.'), 500), updated_at = now()
  where id = p_batch_id;
  insert into public.financial_audit_events (actor_type, action, target_type, target_id, after_state, reason)
  values ('system', 'release_payout_reservation', 'payout', p_batch_id::text,
    jsonb_build_object('status', v_final_status), left(coalesce(p_failure_message, ''), 500));
  return jsonb_build_object('id', p_batch_id, 'status', v_final_status);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.release_pending_dancer_earnings(p_limit integer DEFAULT 1000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count integer;
begin
  with eligible as (
    select id from public.commission_events
    where status = 'pending'
      and pending_until <= clock_timestamp()
      and held_at is null
      and review_flag is null
    order by pending_until, id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  )
  update public.commission_events earning
  set status = 'available', available_at = clock_timestamp()
  from eligible where earning.id = eligible.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.request_dancer_payout(p_user_id uuid, p_request_key text, p_payment_provider text, p_is_test boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dancer_id uuid;
  v_account public.dancer_payout_accounts%rowtype;
  v_settings public.payout_settings%rowtype;
  v_payout_id uuid;
  v_amount bigint;
  v_count integer;
  v_earning_ids uuid[];
  v_duplicate jsonb;
begin
  if char_length(trim(coalesce(p_request_key, ''))) < 12 then
    raise exception using errcode = '22023', message = 'A valid idempotency key is required.';
  end if;
  if p_payment_provider not in ('stripe', 'bitsafe', 'adyen', 'other') then
    raise exception using errcode = '22023', message = 'Unsupported payout provider.';
  end if;

  -- Lock the dancer row before inspecting idempotency or active batches. This
  -- serializes simultaneous cash-out requests even before a payout row exists.
  select id into v_dancer_id from public.dancer_profiles where user_id = p_user_id for update;
  if v_dancer_id is null then
    raise exception using errcode = '42501', message = 'Dancer account required.';
  end if;
  select * into v_settings from public.payout_settings where id = 'default' for share;
  if v_settings.payout_mode not in ('manual_cashout', 'both') then
    raise exception using errcode = '22023', message = 'Manual cash out is not enabled.';
  end if;

  select jsonb_build_object('id', id, 'status', status, 'amount_cents', amount_cents,
    'currency', currency, 'is_test', is_test, 'duplicate', true)
    into v_duplicate
  from public.dancer_payout_batches
  where request_key = trim(p_request_key) and dancer_id = v_dancer_id;
  if v_duplicate is not null then return v_duplicate; end if;

  if not p_is_test then
    select * into v_account from public.dancer_payout_accounts
    where dancer_id = v_dancer_id and payment_provider = p_payment_provider;
    if not found or v_account.onboarding_status <> 'complete'
      or v_account.payout_eligibility <> 'eligible'
      or v_account.verification_status <> 'verified'
    then
      raise exception using errcode = '22023', message = 'Payout setup and verification must be completed first.';
    end if;
  end if;

  perform 1 from public.dancer_payout_batches
  where dancer_id = v_dancer_id and currency = 'usd' and status in ('requested', 'processing')
  for update;
  if found then
    raise exception using errcode = '23505', message = 'A payout request is already active.';
  end if;

  with locked_earnings as (
    select id, amount_cents
    from public.commission_events
    where dancer_id = v_dancer_id and status = 'available' and payout_batch_id is null
      and held_at is null and review_flag is null and currency = 'usd'
    order by created_at, id
    for update
  )
  select count(*)::integer, coalesce(sum(amount_cents), 0)::bigint, array_agg(id order by id)
    into v_count, v_amount, v_earning_ids
  from locked_earnings;

  if v_count = 0 or v_amount < v_settings.minimum_payout_cents then
    raise exception using errcode = '22023', message = 'Available earnings do not meet the minimum cash-out amount.';
  end if;

  insert into public.dancer_payout_batches (
    dancer_id, status, currency, amount_cents, payment_provider, request_key, is_test,
    requested_at, metadata
  ) values (
    v_dancer_id, 'requested', 'usd', v_amount::integer, p_payment_provider,
    trim(p_request_key), p_is_test, clock_timestamp(),
    jsonb_build_object('requested_by_user_id', p_user_id, 'source', 'manual_cashout')
  ) returning id into v_payout_id;

  insert into public.dancer_payout_items (payout_batch_id, commission_event_id, amount_cents)
  select v_payout_id, id, amount_cents from public.commission_events
  where id = any(v_earning_ids);

  update public.commission_events
  set status = 'payout_processing', payout_batch_id = v_payout_id,
      payment_provider = p_payment_provider
  where id in (
    select commission_event_id from public.dancer_payout_items where payout_batch_id = v_payout_id
  );

  insert into public.financial_audit_events (
    actor_user_id, actor_type, action, target_type, target_id, after_state, metadata
  ) values (
    p_user_id, 'dancer', 'request_cash_out', 'payout', v_payout_id::text,
    jsonb_build_object('status', 'requested', 'amount_cents', v_amount, 'currency', 'usd'),
    jsonb_build_object('is_test', p_is_test, 'request_key', trim(p_request_key))
  );

  return jsonb_build_object('id', v_payout_id, 'status', 'requested',
    'amount_cents', v_amount, 'currency', 'usd', 'is_test', p_is_test);
exception when unique_violation then
  select jsonb_build_object('id', id, 'status', status, 'amount_cents', amount_cents,
    'currency', currency, 'is_test', is_test, 'duplicate', true)
    into v_duplicate from public.dancer_payout_batches
    where request_key = trim(p_request_key) and dancer_id = v_dancer_id;
  if v_duplicate is not null then return v_duplicate; end if;
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.require_enrolled_club_deal_earning()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.qr_redemption_id is not null and not exists (
    select 1 from public.deal_revenue_events revenue
    where revenue.qr_redemption_id = new.qr_redemption_id
      and revenue.dancer_id = new.dancer_id and revenue.dancer_commission_eligible
      and revenue.dancer_nats_activated_at <= revenue.confirmed_at
      and revenue.dancer_commission_cents = new.amount_cents
      and revenue.status not in ('refunded', 'voided')
  ) then
    raise exception using errcode = '22023', message = 'Club Deal commission requires NATS eligibility at redemption.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.require_submitted_dancer_profile_for_active_affiliation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile_status public.dancer_status;
  v_profile_disabled_at timestamptz;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select dancer.status, dancer.disabled_at
  into v_profile_status, v_profile_disabled_at
  from public.dancer_profiles dancer
  where dancer.id = new.dancer_id;

  if not found
    or v_profile_disabled_at is not null
    or v_profile_status not in ('pending_review', 'approved')
  then
    raise exception using
      errcode = '42501',
      message = 'Submit your completed profile before using dressing-room NFC.';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.require_venue_request_email_confirmation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status='approved' and new.requester_user_id is not null and not exists (
    select 1 from auth.users where id=new.requester_user_id and email_confirmed_at is not null
  ) then
    raise exception using errcode='42501',message='The manager must confirm their email before club approval.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.restore_dmca_case(p_case_id uuid, p_admin_id uuid DEFAULT NULL::uuid, p_restoration_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_case public.dmca_cases%rowtype;
  v_counter public.dmca_counter_notices%rowtype;
  v_account public.app_users%rowtype;
  v_profile public.dancer_profiles%rowtype;
  v_video public.mydancr_tv_videos%rowtype;
  v_state public.dmca_enforcement_states%rowtype;
  v_active_strikes integer;
  v_now timestamptz:=now();
  v_owned boolean;
  v_affected integer;
  v_outcome text:='missing_content';
  v_status text;
  v_account_removed boolean:=false;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'DMCA_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  if p_case_id is null or length(coalesce(p_restoration_notes,''))>4000 then
    raise exception 'INVALID_DMCA_RESTORATION_INPUT' using errcode='22023';
  end if;
  if p_admin_id is not null and not exists(select 1 from public.app_users where id=p_admin_id and role='admin' and account_state='active') then
    raise exception 'DMCA_ADMIN_REQUIRED' using errcode='42501';
  end if;
  select * into v_case from public.dmca_cases where id=p_case_id for update;
  if not found then raise exception 'DMCA case not found.';end if;
  if v_case.status<>'countered' or v_case.court_filing_received then
    raise exception 'This DMCA case is not eligible for restoration.';
  end if;
  if v_case.restore_eligible_at is null or not isfinite(v_case.restore_eligible_at) or v_case.restore_eligible_at>v_now then
    raise exception 'The statutory counter-notice waiting period has not ended.';
  end if;
  select * into v_counter from public.dmca_counter_notices where case_id=v_case.id for update;
  if not found then
    -- Account deletion retains the case while the original foreign keys remove
    -- its counter-notice and strikes. Resolve only the retained case when its
    -- completed waiting-period evidence remains and there is no content left.
    v_account_removed:=v_case.uploader_id is null and v_case.counter_received_at is not null
      and isfinite(v_case.counter_received_at) and v_case.counter_received_at<=v_now
      and not exists(select 1 from public.mydancr_tv_videos where id=v_case.target_id)
      and not exists(select 1 from public.dmca_strikes where case_id=v_case.id);
    if not v_account_removed then raise exception 'A valid counter-notice must be forwarded before restoration.';end if;
  elsif v_counter.status<>'forwarded' or v_counter.forwarded_to_claimant_at is null
    or not isfinite(v_counter.forwarded_to_claimant_at) or v_counter.forwarded_to_claimant_at>v_now
    or not v_counter.mistake_belief_confirmed or not v_counter.perjury_confirmed
    or not v_counter.jurisdiction_confirmed or not v_counter.service_confirmed then
    raise exception 'A valid counter-notice must be forwarded before restoration.';
  end if;
  if v_case.uploader_id is distinct from v_counter.uploader_id then
    raise exception 'DMCA_CASE_OWNERSHIP_CHANGED' using errcode='40001';
  end if;
  select * into v_account from public.app_users where id=v_case.uploader_id for update;
  select * into v_profile from public.dancer_profiles where user_id=v_case.uploader_id for update;
  perform 1 from public.mydancr_tv_videos where submitted_by=v_case.uploader_id order by id for update;

  if not v_account_removed then
    update public.dmca_strikes set active=false,rescinded_at=v_now,
      rescinded_reason='Copyright restriction cleared after a valid counter-notice and no timely court filing.'
      where case_id=v_case.id and user_id=v_case.uploader_id and active;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_STRIKE_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;
  select count(*)into v_active_strikes from public.dmca_strikes where user_id=v_case.uploader_id and active;

  if v_active_strikes<3 then
    select * into v_state from public.dmca_enforcement_states
      where target_type='account' and target_id=v_case.uploader_id and uploader_id=v_case.uploader_id for update;
    if found and v_account.id is not null then
      v_owned:=v_state.restore_allowed and v_state.applied_state=
        jsonb_build_object('account_state',v_account.account_state,'dmca_suspended_at',v_account.dmca_suspended_at);
      update public.app_users set
        account_state=case when v_owned then (v_state.previous_state->>'account_state')::public.account_state else account_state end,
        dmca_suspended_at=case when to_jsonb(dmca_suspended_at) is not distinct from v_state.applied_state->'dmca_suspended_at'
          then null else dmca_suspended_at end,
        updated_at=v_now where id=v_case.uploader_id returning * into v_account;
      if not found then raise exception 'DMCA_ACCOUNT_WRITE_UNCONFIRMED' using errcode='40001';end if;
      delete from public.dmca_enforcement_states where target_type='account' and target_id=v_case.uploader_id;
    end if;
    select * into v_state from public.dmca_enforcement_states
      where target_type='dancer_profile' and target_id=v_profile.id and uploader_id=v_case.uploader_id for update;
    if found and v_profile.id is not null then
      v_owned:=v_account.account_state='active' and v_profile.admin_disabled_at is null
        and v_state.restore_allowed and v_state.applied_state=
        jsonb_build_object('status',v_profile.status,'disabled_at',v_profile.disabled_at,'dmca_suspended_at',v_profile.dmca_suspended_at);
      update public.dancer_profiles set
        status=case when v_owned then (v_state.previous_state->>'status')::public.dancer_status else status end,
        disabled_at=case when v_owned then (v_state.previous_state->>'disabled_at')::timestamptz else disabled_at end,
        dmca_suspended_at=case when to_jsonb(dmca_suspended_at) is not distinct from v_state.applied_state->'dmca_suspended_at'
          then null else dmca_suspended_at end,
        updated_at=v_now where id=v_profile.id returning * into v_profile;
      if not found then raise exception 'DMCA_PROFILE_WRITE_UNCONFIRMED' using errcode='40001';end if;
      delete from public.dmca_enforcement_states where target_type='dancer_profile' and target_id=v_profile.id;
    end if;
  end if;

  -- Clear only snapshots no longer needed by another active copyright case or
  -- the repeat-strike restriction. Never manufacture an old per-case snapshot.
  for v_state in select * from public.dmca_enforcement_states
    where target_type='tv_video' and uploader_id=v_case.uploader_id order by target_id for update
  loop
    select * into v_video from public.mydancr_tv_videos where id=v_state.target_id;
    if v_video.id is null then
      delete from public.dmca_enforcement_states where target_type='tv_video' and target_id=v_state.target_id;
      continue;
    end if;
    if exists(select 1 from public.dmca_strikes strike join public.dmca_cases other_case on other_case.id=strike.case_id
      where strike.active and other_case.target_type='tv_video' and other_case.target_id=v_video.id) then
      if v_video.id=v_case.target_id then v_outcome:='another_active_case';end if;
      continue;
    end if;
    if v_active_strikes>=3 then
      if v_video.id=v_case.target_id then v_outcome:='repeat_strike_restriction';end if;
      continue;
    end if;
    v_owned:=v_state.restore_allowed and v_video.submitted_by=v_case.uploader_id and v_video.dancer_id=v_profile.id
      and v_state.applied_state=jsonb_build_object('status',v_video.status,'published_at',v_video.published_at,'review_notes',v_video.review_notes);
    if v_owned and v_account.account_state='active' and v_profile.status<>'disabled'
      and v_profile.admin_disabled_at is null and v_profile.dmca_suspended_at is null then
      update public.mydancr_tv_videos set status=v_state.previous_state->>'status',
        published_at=(v_state.previous_state->>'published_at')::timestamptz,
        review_notes=v_state.previous_state->>'review_notes',updated_at=v_now where id=v_video.id;
      get diagnostics v_affected=row_count;
      if v_affected<>1 then raise exception 'DMCA_VIDEO_WRITE_UNCONFIRMED' using errcode='40001';end if;
      if v_video.id=v_case.target_id then v_outcome:='previous_state_restored';end if;
    else
      if v_video.id=v_case.target_id then v_outcome:='independent_decision_preserved';end if;
    end if;
    delete from public.dmca_enforcement_states where target_type='tv_video' and target_id=v_video.id;
  end loop;
  select status into v_status from public.mydancr_tv_videos where id=v_case.target_id;
  if found and v_outcome='missing_content' then v_outcome:='independent_decision_preserved';end if;

  update public.dmca_cases set status='restored',restored_at=v_now,
    reviewed_by=coalesce(p_admin_id,reviewed_by),reviewed_at=case when p_admin_id is not null then v_now else reviewed_at end,
    admin_notes=coalesce(nullif(trim(coalesce(p_restoration_notes,'')),''),admin_notes),updated_at=v_now where id=v_case.id;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'DMCA_CASE_WRITE_UNCONFIRMED' using errcode='40001';end if;
  if not v_account_removed then
    update public.dmca_counter_notices set status='completed',updated_at=v_now where id=v_counter.id;
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_COUNTER_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;
  if v_case.uploader_id is not null then
    insert into public.notifications(recipient_id,notification_type,channel,title,body,payload,sent_at)
    values(v_case.uploader_id,'dmca_status','in_app','Copyright case resolved',
      'The copyright restriction for this case was cleared after the counter-notice waiting period. Other account or content restrictions may still apply.',
      jsonb_build_object('caseId',v_case.id,'targetId',v_case.target_id,'status','restored','restorationOutcome',v_outcome),v_now);
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_NOTIFICATION_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;
  if p_admin_id is not null then
    insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
      values(p_admin_id,'dmca_case',v_case.id,'restore_dmca_content',
        concat(coalesce(p_restoration_notes,'Resolved after valid counter-notice waiting period.'),'; outcome: ',v_outcome));
    get diagnostics v_affected=row_count;
    if v_affected<>1 then raise exception 'DMCA_AUDIT_WRITE_UNCONFIRMED' using errcode='40001';end if;
  end if;
  return jsonb_build_object('caseId',v_case.id,'targetId',v_case.target_id,'uploaderId',v_case.uploader_id,
    'activeStrikes',v_active_strikes,'status','restored','restorationOutcome',v_outcome,'contentStatus',v_status);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.review_dancer_content_safely(p_reviewer_id uuid, p_dancer_id uuid, p_target_type text, p_target_id uuid, p_status text, p_notes text, p_label text, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
 v_profile public.dancer_profiles%rowtype;
 v_photo public.dancer_photos%rowtype;
 v_social public.social_links%rowtype;
 v_review public.approval_reviews%rowtype;
 v_target jsonb;
 v_expected_target jsonb;
 v_expected_review jsonb;
 v_current_review jsonb;
 v_review_type text;
 v_notes text := nullif(btrim(p_notes),'');
 v_label text := nullif(btrim(p_label),'');
 v_now timestamptz;
 v_summary public.review_status;
 v_confirmed uuid;
 v_audit_id uuid;
begin
 if p_reviewer_id is null or p_dancer_id is null or p_target_id is null
   or p_target_type is null or p_target_type not in('photo','social_link')
   or p_status is null or p_status not in('approved','rejected')
   or length(coalesce(v_notes,''))>12000 or length(coalesce(v_label,''))>1000
   or (p_status='rejected' and v_notes is null)
   or jsonb_typeof(p_expected) is distinct from 'object'
   or jsonb_typeof(p_expected->'target') is distinct from 'object'
   or not(p_expected ? 'review')
   or jsonb_typeof(p_expected->'review') not in('object','null') then
   raise exception 'CONTENT_DECISION_INVALID_INPUT' using errcode='22023';
 end if;
 -- Revalidate administrator authority inside the transaction, before profile/target locks.
 perform a.id from public.app_users a where a.id=p_reviewer_id and a.role='admin'
   and a.account_state='active' for share;
 if not found then raise exception 'CONTENT_DECISION_FORBIDDEN' using errcode='42501'; end if;
 select * into v_profile from public.dancer_profiles where id=p_dancer_id for update;
 if not found then raise exception 'CONTENT_DECISION_PROFILE_MISSING' using errcode='P0002'; end if;
 v_review_type := p_target_type || ':' || p_target_id::text;
 v_expected_target := p_expected->'target';
 v_expected_review := p_expected->'review';

 if p_target_type='photo' then
   perform p.id from public.dancer_photos p where p.dancer_id=p_dancer_id order by p.id for update;
   select * into v_photo from public.dancer_photos where id=p_target_id and dancer_id=p_dancer_id;
   if not found then raise exception 'CONTENT_DECISION_TARGET_MISSING' using errcode='P0002'; end if;
   v_target := jsonb_build_object('storage_path',v_photo.storage_path,'is_primary',v_photo.is_primary,
     'sort_order',v_photo.sort_order,'review_status',v_photo.review_status);
 else
   select * into v_social from public.social_links where id=p_target_id and dancer_id=p_dancer_id for update;
   if not found then raise exception 'CONTENT_DECISION_TARGET_MISSING' using errcode='P0002'; end if;
   if not v_social.is_active then raise exception 'CONTENT_DECISION_TARGET_CHANGED' using errcode='40001'; end if;
   if jsonb_typeof(v_expected_target->'updated_at') is distinct from 'string'
     or length(v_expected_target->>'updated_at')>64 then
     raise exception 'CONTENT_DECISION_INVALID_VERSION' using errcode='22023';
   end if;
   -- Compare timestamp values, not the API's timezone/precision formatting.
   v_expected_target := jsonb_set(v_expected_target,'{updated_at}',to_jsonb((v_expected_target->>'updated_at')::timestamptz));
   v_target := jsonb_build_object('platform',v_social.platform,'handle',v_social.handle,
     'url',v_social.url,'is_active',v_social.is_active,'updated_at',v_social.updated_at);
 end if;
 if v_target is distinct from v_expected_target then
   raise exception 'CONTENT_DECISION_TARGET_CHANGED' using errcode='40001';
 end if;
 perform r.id from public.approval_reviews r where r.dancer_id=p_dancer_id and r.review_type=v_review_type order by r.id for update;
 -- A pending request takes precedence over completed history, even with an old/skewed timestamp.
 select * into v_review from public.approval_reviews r where r.dancer_id=p_dancer_id and r.review_type=v_review_type
   order by (r.status='pending') desc,coalesce(r.reviewed_at,r.created_at) desc,r.id desc limit 1;
 v_current_review := case when v_review.id is null then 'null'::jsonb else
   jsonb_build_object('id',v_review.id,'status',v_review.status,'reviewed_at',v_review.reviewed_at) end;
 if jsonb_typeof(v_expected_review)='object' and v_expected_review->'reviewed_at'<>'null'::jsonb then
   if jsonb_typeof(v_expected_review->'reviewed_at') is distinct from 'string'
     or length(v_expected_review->>'reviewed_at')>64 then
     raise exception 'CONTENT_DECISION_INVALID_VERSION' using errcode='22023';
   end if;
   v_expected_review := jsonb_set(v_expected_review,'{reviewed_at}',to_jsonb((v_expected_review->>'reviewed_at')::timestamptz));
 end if;
 if v_current_review is distinct from v_expected_review then
   raise exception 'CONTENT_DECISION_REVIEW_CHANGED' using errcode='40001';
 end if;

 v_now := clock_timestamp();
 if p_target_type='photo' then
   update public.dancer_photos set review_status=p_status::public.review_status
     where id=p_target_id and dancer_id=p_dancer_id returning id into v_confirmed;
   if v_confirmed is null then raise exception 'CONTENT_DECISION_NOT_CONFIRMED' using errcode='40001'; end if;
   select case when count(*)=0 then 'pending' when bool_or(review_status='rejected') then 'rejected'
     when bool_and(review_status='approved') then 'approved' else 'pending' end::public.review_status into v_summary
     from public.dancer_photos where dancer_id=p_dancer_id;
   update public.dancer_profiles set photo_review_status=v_summary where id=p_dancer_id returning id into v_confirmed;
   if v_confirmed is null then raise exception 'CONTENT_SUMMARY_NOT_CONFIRMED' using errcode='40001'; end if;
   v_target := jsonb_set(v_target,'{review_status}',to_jsonb(p_status));
 end if;

 if v_review.id is not null and v_review.status='pending' then
   update public.approval_reviews set reviewer_id=p_reviewer_id,status=p_status::public.review_status,
     notes=v_notes,reviewed_at=v_now where id=v_review.id and status='pending' returning * into v_review;
 else
   -- A new deliberate decision appends history; it never rewrites a completed decision.
   insert into public.approval_reviews(dancer_id,review_type,reviewer_id,status,notes,reviewed_at,created_at)
     values(p_dancer_id,v_review_type,p_reviewer_id,p_status::public.review_status,v_notes,v_now,v_now) returning * into v_review;
 end if;
 if v_review.id is null then raise exception 'CONTENT_REVIEW_NOT_CONFIRMED' using errcode='40001'; end if;
 insert into public.admin_actions(admin_id,target_type,target_id,action,notes,created_at)
   values(p_reviewer_id,p_target_type,p_dancer_id,
     case p_status when 'approved' then 'approve_submitted_content' else 'reject_submitted_content' end,
     coalesce(v_label,p_target_id::text) || case when v_notes is null then '' else ': ' || v_notes end,v_now)
   returning id into v_audit_id;
 if v_audit_id is null then raise exception 'CONTENT_AUDIT_NOT_CONFIRMED' using errcode='40001'; end if;

 return jsonb_build_object('dancer_id',p_dancer_id,'target_type',p_target_type,'target_id',p_target_id,
   'review_id',v_review.id,'status',v_review.status,'reviewed_at',v_review.reviewed_at,'audit_id',v_audit_id,
   'recipient_id',v_profile.user_id,'profile_status',v_profile.status,
   'version',jsonb_build_object('target',v_target,'review',jsonb_build_object('id',v_review.id,'status',v_review.status,'reviewed_at',v_review.reviewed_at)));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.review_dancer_profile_safely(p_reviewer_id uuid, p_dancer_id uuid, p_status text, p_notes text, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
 v_profile public.dancer_profiles%rowtype;
 v_before public.dancer_profiles%rowtype;
 v_account public.app_users%rowtype;
 v_review public.approval_reviews%rowtype;
 v_owner_id uuid;
 v_audit_id uuid;
 v_receipt jsonb;
 v_current jsonb;
 v_expected jsonb := p_expected;
 v_field text;
 v_notes text := nullif(btrim(p_notes),'');
 v_now timestamptz;
 v_keys text[] := array['user_id','stage_name','city','status','verification_status','photo_review_status',
   'avatar_storage_path','is_public','approved_at','disabled_at','admin_disabled_at','venue_approved_at',
   'venue_approved_by_user_id','venue_approved_venue_id','updated_at'];
begin
 if p_reviewer_id is null or p_dancer_id is null or p_status is null
   or p_status not in('approved','rejected') or length(coalesce(v_notes,''))>12000
   or jsonb_typeof(p_expected) is distinct from 'object' then
   raise exception 'PROFILE_DECISION_INVALID_INPUT' using errcode='22023';
 end if;
 perform a.id from public.app_users a where a.id=p_reviewer_id and a.role='admin'
   and a.account_state='active' for share;
 if not found then raise exception 'PROFILE_DECISION_FORBIDDEN' using errcode='42501'; end if;
 select user_id into v_owner_id from public.dancer_profiles where id=p_dancer_id;
 if not found then raise exception 'PROFILE_DECISION_MISSING' using errcode='P0002'; end if;
 -- The nested publication transition and account lifecycle lock the account before the profile.
 select * into v_account from public.app_users where id=v_owner_id for update;
 if not found or v_account.role<>'dancer' then raise exception 'PROFILE_DECISION_ACCOUNT_MISSING' using errcode='P0002'; end if;
 select * into v_profile from public.dancer_profiles where id=p_dancer_id for update;
 if not found or v_profile.user_id<>v_owner_id then raise exception 'PROFILE_DECISION_CHANGED' using errcode='40001'; end if;
 v_before := v_profile;
 select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_profile)) where key=any(v_keys);
 foreach v_field in array array['approved_at','disabled_at','admin_disabled_at','venue_approved_at','updated_at'] loop
   if not(v_expected ? v_field) or jsonb_typeof(v_expected->v_field) not in('string','null')
     or length(v_expected->>v_field)>64 then
     raise exception 'PROFILE_DECISION_INVALID_VERSION' using errcode='22023';
   end if;
   if v_expected->v_field<>'null'::jsonb then
     if not isfinite((v_expected->>v_field)::timestamptz) then
       raise exception 'PROFILE_DECISION_INVALID_VERSION' using errcode='22023';
     end if;
     v_expected := jsonb_set(v_expected,array[v_field],to_jsonb((v_expected->>v_field)::timestamptz));
   end if;
 end loop;
 if v_current is distinct from v_expected then raise exception 'PROFILE_DECISION_CHANGED' using errcode='40001'; end if;
 perform r.id from public.approval_reviews r where r.dancer_id=p_dancer_id and r.review_type='profile' order by r.id for update;
 v_receipt := public.transition_dancer_publication_safely(p_dancer_id,
   case p_status when 'approved' then 'admin_accept' else 'admin_reject' end,p_reviewer_id);
 select * into v_profile from public.dancer_profiles where id=p_dancer_id;
 if not found or v_receipt->>'id' is distinct from p_dancer_id::text
   or v_receipt->>'user_id' is distinct from v_owner_id::text
   or v_profile.updated_at is not distinct from v_before.updated_at
   or v_profile.status::text is distinct from (case p_status when 'approved' then 'pending_review' else 'rejected' end)
   or v_profile.verification_status::text is distinct from (case p_status when 'approved' then 'pending' else 'rejected' end)
   or v_profile.approved_at is not null or v_profile.is_public is distinct from false
   or (to_jsonb(v_profile)-array['status','verification_status','approved_at','is_public','updated_at'])
      is distinct from (to_jsonb(v_before)-array['status','verification_status','approved_at','is_public','updated_at']) then
   raise exception 'PROFILE_TRANSITION_NOT_CONFIRMED' using errcode='40001';
 end if;
 v_now := clock_timestamp();
 insert into public.approval_reviews(dancer_id,reviewer_id,review_type,status,notes,reviewed_at,created_at)
   values(p_dancer_id,p_reviewer_id,'profile',p_status::public.review_status,v_notes,v_now,v_now) returning * into v_review;
 if v_review.id is null then raise exception 'PROFILE_REVIEW_NOT_CONFIRMED' using errcode='40001'; end if;
 insert into public.admin_actions(admin_id,target_type,target_id,action,notes,created_at)
   values(p_reviewer_id,'dancer_profile',p_dancer_id,
     case p_status when 'approved' then 'approve_dancer' else 'reject_dancer' end,v_notes,v_now) returning id into v_audit_id;
 if v_audit_id is null then raise exception 'PROFILE_AUDIT_NOT_CONFIRMED' using errcode='40001'; end if;
 select jsonb_object_agg(key,value) into v_current from jsonb_each(to_jsonb(v_profile)) where key=any(v_keys);
 return jsonb_build_object('dancer_id',p_dancer_id,'recipient_id',v_owner_id,'stage_name',v_profile.stage_name,
   'decision',v_review.status,'status',v_profile.status,'review_id',v_review.id,'audit_id',v_audit_id,
   'reviewed_at',v_now,'version',v_current);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.review_venue_ownership_claim(p_claim_id uuid, p_admin_id uuid, p_status text, p_notes text DEFAULT NULL::text)
 RETURNS venue_ownership_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_claim public.venue_ownership_claims;
  v_venue public.venues;
  v_now timestamptz := now();
begin
  if p_status not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Venue claim status must be approved or rejected.';
  end if;

  if not exists (
    select 1 from public.app_users
    where id = p_admin_id and role = 'admin' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active admin account required.';
  end if;

  select * into v_claim
  from public.venue_ownership_claims
  where id = p_claim_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue ownership claim not found.';
  end if;
  if v_claim.status <> 'pending' then
    raise exception using errcode = '22023', message = 'This venue ownership claim was already reviewed.';
  end if;
  if p_status = 'rejected' and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception using errcode = '22023', message = 'Add a reason before rejecting this venue claim.';
  end if;

  select * into v_venue
  from public.venues
  where id = v_claim.venue_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue not found.';
  end if;

  if p_status = 'approved' then
    if v_venue.owner_user_id is not null and v_venue.owner_user_id <> v_claim.claimant_user_id then
      raise exception using errcode = '23505', message = 'This venue is already managed by another account.';
    end if;
    if exists (
      select 1 from public.venues
      where owner_user_id = v_claim.claimant_user_id and id <> v_claim.venue_id
    ) then
      raise exception using errcode = '23505', message = 'This account already manages another venue.';
    end if;

    update public.venues
    set owner_user_id = v_claim.claimant_user_id, updated_at = v_now
    where id = v_claim.venue_id;

    update public.venue_ownership_claims
    set
      status = 'rejected',
      review_notes = 'Another verified ownership claim was approved for this venue.',
      reviewed_by = p_admin_id,
      reviewed_at = v_now,
      updated_at = v_now
    where venue_id = v_claim.venue_id
      and status = 'pending'
      and id <> v_claim.id;
  end if;

  update public.venue_ownership_claims
  set
    status = p_status,
    review_notes = nullif(trim(coalesce(p_notes, '')), ''),
    reviewed_by = p_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  where id = v_claim.id
  returning * into v_claim;

  insert into public.notifications (
    recipient_id,
    notification_type,
    channel,
    title,
    body,
    payload,
    sent_at
  )
  values (
    v_claim.claimant_user_id,
    'venue_claim_status',
    'in_app',
    case when p_status = 'approved' then 'Venue claim approved' else 'Venue claim needs attention' end,
    case
      when p_status = 'approved' then 'Your account can now manage ' || v_venue.name || ' from the venue dashboard.'
      else 'Your claim for ' || v_venue.name || ' was not approved. Review the decision and submit a new claim if needed.'
    end,
    jsonb_build_object(
      'claimId', v_claim.id,
      'venueId', v_venue.id,
      'venueSlug', v_venue.slug,
      'status', p_status,
      'notes', nullif(trim(coalesce(p_notes, '')), '')
    ),
    v_now
  );

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_ownership_claim',
    v_claim.id,
    case when p_status = 'approved' then 'approve_venue_claim' else 'reject_venue_claim' end,
    nullif(trim(coalesce(p_notes, '')), '')
  );

  return v_claim;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.review_venue_signup_request(p_request_id uuid, p_admin_id uuid, p_decision text, p_existing_venue_id uuid DEFAULT NULL::uuid, p_review_notes text DEFAULT NULL::text, p_code_digest text DEFAULT NULL::text, p_code_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request public.venue_signup_requests;
  v_venue public.venues;
  v_code public.venue_claim_codes;
  v_slug_base text;
  v_slug text;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.app_users
    where id = p_admin_id and role = 'admin' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active admin account required.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Decision must be approved or rejected.';
  end if;

  select * into v_request
  from public.venue_signup_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue signup request not found.';
  end if;
  if v_request.status <> 'pending' then
    raise exception using errcode = '22023', message = 'This venue signup request was already reviewed.';
  end if;

  if p_decision = 'rejected' then
    if nullif(trim(coalesce(p_review_notes, '')), '') is null then
      raise exception using errcode = '22023', message = 'Add a reason before rejecting this venue request.';
    end if;

    update public.venue_signup_requests
    set status = 'rejected',
        reviewed_by = p_admin_id,
        reviewed_at = v_now,
        review_notes = left(trim(p_review_notes), 2000)
    where id = v_request.id
    returning * into v_request;

    insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
    values (p_admin_id, 'venue_signup_request', v_request.id, 'reject_venue_signup_request', v_request.review_notes);

    return jsonb_build_object('request', to_jsonb(v_request), 'venue', null, 'claim_code', null);
  end if;

  if p_existing_venue_id is not null then
    raise exception using errcode = '22023', message = 'Existing venue claims are not supported. Approve this request as a new private workspace.';
  end if;
  if p_code_digest is null or p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'A secure venue access code is required.';
  end if;
  if p_code_expires_at is null
    or p_code_expires_at <= v_now + interval '5 minutes'
    or p_code_expires_at > v_now + interval '30 days'
  then
    raise exception using errcode = '22023', message = 'Venue access code expiry is invalid.';
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(v_request.venue_name), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then
    v_slug_base := 'venue';
  end if;
  v_slug := v_slug_base;
  if exists (select 1 from public.venues where slug = v_slug) then
    v_slug := left(v_slug_base, 78) || '-' || left(replace(v_request.id::text, '-', ''), 8);
  end if;

  insert into public.venues (
    name,
    slug,
    city,
    state,
    address,
    phone,
    website,
    timezone,
    is_active,
    published_at
  ) values (
    v_request.venue_name,
    v_slug,
    v_request.city,
    v_request.state,
    concat_ws(', ', v_request.street_address, v_request.city, concat_ws(' ', v_request.state, v_request.postal_code)),
    v_request.contact_phone,
    v_request.website,
    'America/Los_Angeles',
    false,
    null
  )
  returning * into v_venue;

  insert into public.venue_claim_codes (
    venue_id,
    code_digest,
    created_by,
    expires_at
  ) values (
    v_venue.id,
    p_code_digest,
    p_admin_id,
    p_code_expires_at
  )
  returning * into v_code;

  update public.venue_signup_requests
  set status = 'approved',
      matched_venue_id = v_venue.id,
      access_code_id = v_code.id,
      reviewed_by = p_admin_id,
      reviewed_at = v_now,
      review_notes = nullif(left(trim(coalesce(p_review_notes, '')), 2000), '')
  where id = v_request.id
  returning * into v_request;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_signup_request',
    v_request.id,
    'approve_venue_signup_request',
    'Created private venue workspace ' || v_venue.id::text || '; access code expires ' || p_code_expires_at::text
  );

  return jsonb_build_object(
    'request', to_jsonb(v_request),
    'venue', to_jsonb(v_venue),
    'claim_code', to_jsonb(v_code)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.revoke_dancer_venue_affiliation(p_affiliation_id uuid, p_actor_user_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_affiliation public.venue_dancer_affiliations;
  v_replacement public.venue_dancer_affiliations;
  v_dancer public.dancer_profiles;
  v_venue public.venues;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
begin
  select * into v_affiliation
  from public.venue_dancer_affiliations
  where id = p_affiliation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue affiliation not found.';
  end if;

  select * into v_dancer from public.dancer_profiles where id = v_affiliation.dancer_id for update;
  select * into v_venue from public.venues where id = v_affiliation.venue_id;

  if p_actor_user_id is distinct from v_dancer.user_id
    and p_actor_user_id is distinct from v_venue.owner_user_id
    and not exists (
      select 1 from public.venue_team_members member
      where member.venue_id = v_affiliation.venue_id
        and member.user_id = p_actor_user_id
        and member.role = 'manager'
        and member.status = 'active'
    )
  then
    raise exception using errcode = '42501', message = 'Only the dancer, venue owner, or an active venue manager can remove this affiliation.';
  end if;

  if v_affiliation.status = 'active' then
    update public.venue_dancer_affiliations
    set
      status = 'revoked',
      revoked_by_user_id = p_actor_user_id,
      revoked_at = v_now,
      revoke_reason = coalesce(v_reason, 'Affiliation removed by an authorized account.'),
      updated_at = v_now
    where id = v_affiliation.id
    returning * into v_affiliation;

    update public.shifts
    set
      checked_out_at = v_now,
      location_status = 'self_reported',
      location_verification_expires_at = v_now,
      working_status = 'ended',
      commission_tracking_stopped_at = coalesce(commission_tracking_stopped_at, v_now),
      ended_at = coalesce(ended_at, v_now),
      ended_reason = 'venue_affiliation_revoked',
      updated_at = v_now
    where dancer_id = v_affiliation.dancer_id
      and venue_id = v_affiliation.venue_id
      and checked_in_at is not null
      and checked_out_at is null;

    select * into v_replacement
    from public.venue_dancer_affiliations
    where dancer_id = v_affiliation.dancer_id
      and status = 'active'
      and revoked_at is null
    order by approved_at asc
    limit 1;

    if found then
      update public.dancer_profiles
      set
        venue_approved_at = v_replacement.approved_at,
        venue_approved_by_user_id = v_replacement.approved_by_user_id,
        venue_approved_venue_id = v_replacement.venue_id
      where id = v_affiliation.dancer_id;
    else
      update public.dancer_profiles
      set
        venue_approved_at = null,
        venue_approved_by_user_id = null,
        venue_approved_venue_id = null
      where id = v_affiliation.dancer_id;
    end if;

    insert into public.venue_dancer_affiliation_events (
      affiliation_id, venue_id, dancer_id, actor_user_id, event_type, event_payload
    ) values (
      v_affiliation.id,
      v_affiliation.venue_id,
      v_affiliation.dancer_id,
      p_actor_user_id,
      'affiliation_revoked',
      jsonb_build_object('reason', v_affiliation.revoke_reason, 'profileDeactivated', false)
    );
  end if;

  return jsonb_build_object(
    'id', v_affiliation.id,
    'venueId', v_affiliation.venue_id,
    'dancerId', v_affiliation.dancer_id,
    'status', v_affiliation.status,
    'profileDeactivated', false,
    'dancerUserId', v_dancer.user_id,
    'stageName', v_dancer.stage_name,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.revoke_venue_claim_code(p_code_id uuid, p_admin_id uuid)
 RETURNS venue_claim_codes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_code public.venue_claim_codes;
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.app_users
    where id = p_admin_id and role = 'admin' and account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active admin account required.';
  end if;

  select * into v_code
  from public.venue_claim_codes
  where id = p_code_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Venue claim code not found.';
  end if;
  if v_code.used_at is not null then
    raise exception using errcode = '22023', message = 'A used venue claim code cannot be revoked.';
  end if;

  if v_code.revoked_at is null then
    update public.venue_claim_codes
    set revoked_at = v_now, revoked_by = p_admin_id
    where id = v_code.id
    returning * into v_code;

    insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
    values (p_admin_id, 'venue', v_code.venue_id, 'revoke_venue_claim_code', null);
  end if;

  return v_code;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.rotate_admin_venue_nfc_tag(p_tag_id uuid, p_admin_user_id uuid, p_replacement_id uuid, p_token_digest text)
 RETURNS nfc_tags
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_current public.nfc_tags;
  v_replacement public.nfc_tags;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_user_id and account.role = 'admin' and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;
  if p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid NFC sticker secret.';
  end if;
  select tag.* into v_current
  from public.nfc_tags tag
  join public.venues venue on venue.id = tag.venue_id
  where tag.id = p_tag_id and tag.status <> 'revoked' and venue.is_active = true
  for update of tag;
  if not found then
    raise exception using errcode = 'P0002', message = 'NFC sticker not found.';
  end if;
  update public.nfc_tags
  set status = 'revoked', revoked_at = v_now, updated_at = v_now
  where id = v_current.id;
  insert into public.nfc_tags (
    id, venue_id, tag_type, label, token_digest, status, created_by_user_id, rotated_from_tag_id
  ) values (
    p_replacement_id, v_current.venue_id, v_current.tag_type, v_current.label,
    p_token_digest, 'active', p_admin_user_id, v_current.id
  ) returning * into v_replacement;
  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (p_admin_user_id, 'nfc_tag', v_replacement.id, 'rotate_nfc_sticker', 'Replaced ' || v_current.id::text);
  return v_replacement;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.save_dancer_social_links_safely(p_dancer_id uuid, p_actor_user_id uuid, p_links jsonb, p_review_platforms text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_owner uuid;
  v_link jsonb;
  v_platform text;
  v_handle text;
  v_url text;
  v_base text;
  v_active boolean;
  v_id uuid;
  v_changed integer := 0;
  v_added integer := 0;
  v_ids uuid[] := '{}'::uuid[];
begin
  if p_dancer_id is null or p_actor_user_id is null or jsonb_typeof(p_links) is distinct from 'array'
    or jsonb_array_length(p_links) > 5 or p_review_platforms is null
    or cardinality(p_review_platforms) > 5 or coalesce(array_ndims(p_review_platforms),1) <> 1
    or array_position(p_review_platforms,null) is not null
    or exists(select 1 from unnest(p_review_platforms) p where p not in('instagram','tiktok','snapchat','x','onlyfans')) then
    raise exception 'SOCIAL_SAVE_INVALID_INPUT' using errcode = '22023';
  end if;
  -- Validate the entire batch before writing. Inputs are canonicalized by the server.
  for v_link in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(v_link) is distinct from 'object'
      or jsonb_typeof(v_link->'platform') is distinct from 'string'
      or jsonb_typeof(v_link->'handle') is distinct from 'string'
      or jsonb_typeof(v_link->'url') is distinct from 'string'
      or jsonb_typeof(v_link->'is_active') is distinct from 'boolean'
      or (v_link->>'platform') not in('instagram','tiktok','snapchat','x','onlyfans') then
      raise exception 'SOCIAL_SAVE_INVALID_INPUT' using errcode = '22023';
    end if;
    v_platform := v_link->>'platform'; v_handle := v_link->>'handle'; v_url := v_link->>'url';
    v_active := (v_link->>'is_active')::boolean;
    v_base := case v_platform when 'tiktok' then 'https://tiktok.com/@'
      when 'snapchat' then 'https://snapchat.com/add/' when 'x' then 'https://x.com/'
      when 'onlyfans' then 'https://onlyfans.com/' else 'https://instagram.com/' end;
    if (v_active and (v_handle !~ '^[a-zA-Z0-9._-]{1,100}$' or v_url <> v_base || v_handle))
      or (not v_active and (v_handle <> '' or v_url <> '')) then
      raise exception 'SOCIAL_SAVE_INVALID_LINK' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) <> count(distinct value->>'platform') from jsonb_array_elements(p_links)) then
    raise exception 'SOCIAL_SAVE_DUPLICATE_PLATFORM' using errcode = '22023';
  end if;

  -- Account before profile; the nested queue locks this same profile before targets.
  perform a.id from public.app_users a where a.id = p_actor_user_id and a.role = 'dancer'
    and a.account_state = 'active' and a.dmca_suspended_at is null for share;
  if not found then raise exception 'SOCIAL_SAVE_FORBIDDEN' using errcode = '42501'; end if;
  select d.user_id into v_owner from public.dancer_profiles d where d.id = p_dancer_id for update;
  if not found then raise exception 'SOCIAL_SAVE_PROFILE_MISSING' using errcode = 'P0002'; end if;
  if v_owner <> p_actor_user_id then raise exception 'SOCIAL_SAVE_FORBIDDEN' using errcode = '42501'; end if;
  perform s.id from public.social_links s where s.dancer_id = p_dancer_id order by s.id for update;

  for v_link in select value from jsonb_array_elements(p_links) order by value->>'platform' loop
    v_platform := v_link->>'platform'; v_active := (v_link->>'is_active')::boolean; v_id := null;
    if v_active then
      insert into public.social_links(dancer_id,platform,handle,url,is_active)
        values(p_dancer_id,v_platform::public.social_platform,v_link->>'handle',v_link->>'url',true)
        on conflict(dancer_id,platform) do update
          set handle=excluded.handle,url=excluded.url,is_active=true,updated_at=clock_timestamp()
          where (social_links.handle,social_links.url,social_links.is_active)
            is distinct from (excluded.handle,excluded.url,excluded.is_active)
        returning id into v_id;
      if v_id is not null then
        v_changed := v_changed + 1;
        v_ids := array_append(v_ids,v_id);
      end if;
      -- An ignored insert/update must not be accepted as a successful save.
      if not exists(select 1 from public.social_links s where s.dancer_id=p_dancer_id
        and s.platform::text=v_platform and s.handle=v_link->>'handle' and s.url=v_link->>'url' and s.is_active) then
        raise exception 'SOCIAL_SAVE_NOT_CONFIRMED' using errcode = '40001';
      end if;
    else
      update public.social_links s set handle='',url='',is_active=false,updated_at=clock_timestamp()
        where s.dancer_id=p_dancer_id and s.platform::text=v_platform
          and (s.handle,s.url,s.is_active) is distinct from ('','',false)
        returning id into v_id;
      if v_id is not null then v_changed := v_changed + 1; end if;
      if exists(select 1 from public.social_links s where s.dancer_id=p_dancer_id
        and s.platform::text=v_platform and (s.handle,s.url,s.is_active) is distinct from ('','',false)) then
        raise exception 'SOCIAL_SAVE_NOT_CONFIRMED' using errcode = '40001';
      end if;
    end if;
  end loop;

  -- Explicit resubmissions supplement changed links; they cannot suppress a changed link's review.
  select coalesce(array_agg(distinct s.id order by s.id),'{}'::uuid[]) into v_ids
    from public.social_links s where s.dancer_id=p_dancer_id and s.is_active
      and (s.id=any(v_ids) or s.platform::text=any(p_review_platforms));
  if cardinality(v_ids)>0 then
    v_added := public.enqueue_dancer_content_reviews(p_dancer_id,p_actor_user_id,'social_link',v_ids);
    if exists(select 1 from unnest(v_ids) target(id) where not exists(select 1 from public.approval_reviews r
      where r.dancer_id=p_dancer_id and r.review_type='social_link:' || target.id::text and r.status='pending')) then
      raise exception 'SOCIAL_REVIEW_NOT_CONFIRMED' using errcode = '40001';
    end if;
  end if;
  return jsonb_build_object('dancer_id',p_dancer_id,'changed_count',v_changed,'queued_count',v_added);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_admin_sales_agent(p_admin_id uuid, p_user_id uuid, p_sponsor_agent_id uuid, p_commission_depth_limit smallint, p_status text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_agent_id uuid; v_account public.app_users%rowtype;
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_id and account.role = 'admin' and account.account_state = 'active'
  ) then raise exception using errcode = '42501', message = 'Admin access required.'; end if;
  select * into v_account from public.app_users where id = p_user_id for update;
  if not found or v_account.account_state <> 'active' then
    raise exception using errcode = '22023', message = 'Select an active account for this sales agent.';
  end if;
  if p_commission_depth_limit not in (3, 5) then
    raise exception using errcode = '22023', message = 'Agent depth must be three or five levels.';
  end if;
  if p_status not in ('active', 'suspended', 'terminated') then
    raise exception using errcode = '22023', message = 'Agent status is invalid.';
  end if;
  insert into public.sales_agents (
    user_id, sponsor_agent_id, status, commission_depth_limit,
    created_by_admin_user_id, updated_by_admin_user_id
  ) values (
    p_user_id, p_sponsor_agent_id, p_status, p_commission_depth_limit,
    p_admin_id, p_admin_id
  ) on conflict (user_id) do update set
    sponsor_agent_id = excluded.sponsor_agent_id,
    status = excluded.status,
    commission_depth_limit = excluded.commission_depth_limit,
    updated_by_admin_user_id = p_admin_id,
    updated_at = clock_timestamp()
  returning id into v_agent_id;
  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (p_admin_id, 'sales_agent', v_agent_id, 'set_sales_agent',
    coalesce(v_account.display_name, v_account.email, p_user_id::text) || ': ' || p_status);
  return v_agent_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_admin_venue_nfc_tag_status(p_tag_id uuid, p_admin_user_id uuid, p_status text)
 RETURNS nfc_tags
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tag public.nfc_tags;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_user_id and account.role = 'admin' and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;
  if p_status not in ('active', 'disabled') then
    raise exception using errcode = '22023', message = 'Choose active or disabled.';
  end if;
  update public.nfc_tags set
    status = p_status,
    disabled_at = case when p_status = 'disabled' then v_now else null end,
    updated_at = v_now
  where id = p_tag_id and status <> 'revoked'
  returning * into v_tag;
  if not found then
    raise exception using errcode = 'P0002', message = 'NFC sticker not found.';
  end if;
  insert into public.admin_actions (admin_id, target_type, target_id, action)
  values (p_admin_user_id, 'nfc_tag', v_tag.id, p_status || '_nfc_sticker');
  return v_tag;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_admin_venue_referral_fee(p_admin_id uuid, p_venue_id uuid, p_fee_cents integer, p_currency text, p_effective_from timestamp with time zone, p_agreement_reference text, p_decision_note text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_term_id uuid;
  v_now timestamptz := clock_timestamp();
  v_venue_name text;
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_id
      and account.role = 'admin'
      and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Active MyDancr admin account required.';
  end if;
  if p_fee_cents < 100 or p_fee_cents > 100000 then
    raise exception using errcode = '22023', message = 'Referral fee must be between $1.00 and $1,000.00.';
  end if;
  if p_currency <> 'usd' then
    raise exception using errcode = '22023', message = 'Only USD referral fee agreements are supported.';
  end if;
  if p_effective_from < v_now - interval '5 minutes'
    or p_effective_from > v_now + interval '5 years' then
    raise exception using errcode = '22023', message = 'Effective date is outside the allowed range.';
  end if;
  if char_length(trim(coalesce(p_agreement_reference, ''))) not between 3 and 160 then
    raise exception using errcode = '22023', message = 'Agreement reference is required.';
  end if;

  select venue.name into v_venue_name
  from public.venues venue
  where venue.id = p_venue_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Venue not found.';
  end if;

  -- Close the term that spans the new effective moment, and retire later
  -- scheduled terms. Rows are retained permanently as contract history.
  update public.venue_referral_fee_terms term
  set effective_until = p_effective_from
  where term.venue_id = p_venue_id
    and term.superseded_at is null
    and term.effective_from < p_effective_from
    and (term.effective_until is null or term.effective_until > p_effective_from);

  update public.venue_referral_fee_terms term
  set superseded_at = v_now,
      superseded_by_admin_user_id = p_admin_id
  where term.venue_id = p_venue_id
    and term.effective_from >= p_effective_from
    and term.superseded_at is null;

  insert into public.venue_referral_fee_terms (
    venue_id,
    fee_cents,
    currency,
    effective_from,
    agreement_reference,
    decision_note,
    created_by_admin_user_id
  ) values (
    p_venue_id,
    p_fee_cents,
    p_currency,
    p_effective_from,
    trim(p_agreement_reference),
    nullif(trim(coalesce(p_decision_note, '')), ''),
    p_admin_id
  ) returning id into v_term_id;

  if p_effective_from <= v_now then
    update public.club_deals
    set payout_type = 'flat', payout_amount_cents = p_fee_cents, currency = p_currency, updated_at = v_now
    where venue_id = p_venue_id;
  end if;

  if p_request_id is not null then
    update public.venue_referral_fee_change_requests
    set status = 'approved',
        reviewed_by_admin_user_id = p_admin_id,
        reviewed_at = v_now,
        decision_note = nullif(trim(coalesce(p_decision_note, '')), ''),
        updated_at = v_now
    where id = p_request_id and venue_id = p_venue_id and status = 'pending';
    if not found then
      raise exception using errcode = '22023', message = 'This fee change request is no longer pending.';
    end if;
  end if;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_referral_fee_term',
    v_term_id,
    case when p_request_id is null then 'set_referral_fee' else 'approve_referral_fee_change' end,
    v_venue_name || ': ' || p_fee_cents::text || ' cents effective ' || p_effective_from::text
  );

  return v_term_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_shift_date_from_starts_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_local_date date;
begin
  if not isfinite(new.starts_at) then
    raise exception using errcode = '22007', message = 'A finite shift start is required.';
  end if;
  v_local_date := timezone(coalesce(nullif(new.timezone, ''), 'UTC'), new.starts_at)::date;

  if new.shift_date is null then
    new.shift_date := v_local_date;
  elsif tg_op = 'UPDATE'
    and new.shift_date is not distinct from old.shift_date
    and (new.starts_at is distinct from old.starts_at or new.timezone is distinct from old.timezone)
  then
    new.shift_date := v_local_date;
  elsif new.shift_date is distinct from v_local_date then
    raise exception using errcode = '22007', message = 'Shift date must match the local start date.';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.settle_dancer_commission_event(p_commission_event_id uuid, p_external_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception using errcode = '22023', message = 'Use the dancer payout workflow; earnings cannot jump directly to paid.';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.settle_deal_revenue_event(p_revenue_event_id uuid, p_action text, p_external_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_event public.deal_revenue_events%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;
  if p_action <> 'venue_payment_received' then
    raise exception using errcode = '22023', message = 'Payee settlements are recorded from their independent commission ledgers.';
  end if;
  if length(trim(coalesce(p_external_reference, ''))) < 3
    or length(trim(p_external_reference)) > 180 then
    raise exception using errcode = '22023', message = 'A valid venue payment reference is required.';
  end if;
  select revenue.* into v_event
  from public.deal_revenue_events revenue
  where revenue.id = p_revenue_event_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Venue receivable not found.';
  end if;
  if v_event.status <> 'pending_venue_payment' then
    raise exception using errcode = '22023', message = 'Venue payment cannot be recorded from the current status.';
  end if;

  update public.deal_revenue_events
  set status = 'settled', venue_payment_reference = trim(p_external_reference),
      venue_payment_received_at = v_now,
      audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
        'venue_receivable_settled_by', auth.uid(), 'dancer_payout_dependency', false,
        'agent_payout_dependency_released', true
      )
  where id = v_event.id;
  update public.agent_commission_events
  set status = 'payable', venue_payment_received_at = v_now, payable_at = v_now,
      audit = audit || jsonb_build_object('venue_payment_reference', trim(p_external_reference))
  where deal_revenue_event_id = v_event.id and status = 'pending_venue_payment';

  return jsonb_build_object('id', v_event.id, 'status', 'settled',
    'venue_payment_reference', trim(p_external_reference),
    'venue_payment_received_at', v_now);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.slugify(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'));
$function$
;
CREATE OR REPLACE FUNCTION public.submit_dmca_counter_notice_safely(p_user_id uuid, p_case_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_case public.dmca_cases%rowtype;
  v_counter public.dmca_counter_notices%rowtype;
  v_field record;
  v_legal_name text; v_email text; v_phone text; v_address text;
  v_location text; v_signature text;
  v_now timestamptz; v_day timestamptz; v_eligible timestamptz; v_deadline timestamptz;
  v_weekdays integer := 0;
  v_duplicate boolean := false;
begin
  if p_user_id is null or p_case_id is null or jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'INVALID_COUNTER_NOTICE' using errcode='22023';
  end if;
  for v_field in select * from (values ('legalName',2,160),('email',5,320),('phone',7,50),
    ('address',10,1000),('removedMaterialLocation',8,2000),('signature',2,160)) as fields(name,minimum,maximum)
  loop
    if jsonb_typeof(p_details->v_field.name) is distinct from 'string'
      or char_length(btrim(p_details->>v_field.name)) not between v_field.minimum and v_field.maximum then
      raise exception 'INVALID_COUNTER_NOTICE' using errcode='22023';
    end if;
  end loop;
  if p_details->'mistakeBeliefConfirmed' is distinct from 'true'::jsonb
    or p_details->'perjuryConfirmed' is distinct from 'true'::jsonb
    or p_details->'jurisdictionConfirmed' is distinct from 'true'::jsonb
    or p_details->'serviceConfirmed' is distinct from 'true'::jsonb then
    raise exception 'COUNTER_NOTICE_CONFIRMATIONS_REQUIRED' using errcode='22023';
  end if;
  v_legal_name:=btrim(p_details->>'legalName'); v_email:=lower(btrim(p_details->>'email'));
  v_phone:=btrim(p_details->>'phone'); v_address:=btrim(p_details->>'address');
  v_location:=btrim(p_details->>'removedMaterialLocation'); v_signature:=btrim(p_details->>'signature');
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_COUNTER_NOTICE_EMAIL' using errcode='22023';
  end if;

  -- Match takedown/restoration case-first locking. Do not block an authenticated
  -- uploader's appeal merely because their application account is disabled.
  select * into v_case from public.dmca_cases where id=p_case_id and uploader_id=p_user_id for update;
  if not found then raise exception 'COUNTER_NOTICE_CASE_NOT_FOUND' using errcode='P0002'; end if;
  select * into v_counter from public.dmca_counter_notices where case_id=p_case_id for update;
  if found then
    if row(v_counter.uploader_id,v_counter.legal_name,v_counter.email,v_counter.phone,v_counter.address,
      v_counter.removed_material_location,v_counter.signature,v_counter.mistake_belief_confirmed,
      v_counter.perjury_confirmed,v_counter.jurisdiction_confirmed,v_counter.service_confirmed)
      is distinct from row(p_user_id,v_legal_name,v_email,v_phone,v_address,v_location,v_signature,true,true,true,true) then
      raise exception 'COUNTER_NOTICE_ALREADY_HAS_DIFFERENT_DETAILS' using errcode='23505';
    end if;
    if v_case.status='disabled' or v_case.counter_received_at is null
      or v_case.restore_eligible_at is null or v_case.restore_deadline_at is null then
      raise exception 'COUNTER_NOTICE_RECEIPT_UNCONFIRMED' using errcode='40001';
    end if;
    v_duplicate:=true;
  else
    if v_case.status<>'disabled' then raise exception 'COUNTER_NOTICE_CASE_NOT_ELIGIBLE' using errcode='22023'; end if;
    v_now:=clock_timestamp(); v_day:=v_now;
    -- Same UTC weekdays rule as the existing application helper, independent
    -- of the session timezone and daylight-saving interval length.
    while v_weekdays<14 loop
      v_day:=((v_day at time zone 'UTC')+interval '1 day') at time zone 'UTC';
      if extract(isodow from v_day at time zone 'UTC')<6 then
        v_weekdays:=v_weekdays+1;
        if v_weekdays=10 then v_eligible:=v_day; end if;
      end if;
    end loop;
    v_deadline:=v_day;
    insert into public.dmca_counter_notices(case_id,uploader_id,legal_name,email,phone,address,
      removed_material_location,mistake_belief_confirmed,perjury_confirmed,jurisdiction_confirmed,
      service_confirmed,signature,status,created_at,updated_at)
      values(p_case_id,p_user_id,v_legal_name,v_email,v_phone,v_address,v_location,true,true,true,true,
        v_signature,'submitted',v_now,v_now) returning * into v_counter;
    if not found or v_counter.id is null or row(v_counter.case_id,v_counter.uploader_id,v_counter.legal_name,v_counter.email,
      v_counter.phone,v_counter.address,v_counter.removed_material_location,v_counter.signature,v_counter.status,
      v_counter.mistake_belief_confirmed,v_counter.perjury_confirmed,v_counter.jurisdiction_confirmed,v_counter.service_confirmed)
      is distinct from row(p_case_id,p_user_id,v_legal_name,v_email,v_phone,v_address,v_location,v_signature,'submitted',true,true,true,true) then
      raise exception 'COUNTER_NOTICE_INSERT_UNCONFIRMED' using errcode='40001';
    end if;
    update public.dmca_cases set status='countered',counter_received_at=v_now,
      restore_eligible_at=v_eligible,restore_deadline_at=v_deadline,updated_at=v_now
      where id=p_case_id and uploader_id=p_user_id and status='disabled' returning * into v_case;
    if not found or row(v_case.id,v_case.uploader_id,v_case.status,v_case.counter_received_at,v_case.restore_eligible_at,v_case.restore_deadline_at)
      is distinct from row(p_case_id,p_user_id,'countered',v_now,v_eligible,v_deadline) then
      raise exception 'COUNTER_NOTICE_TRANSITION_UNCONFIRMED' using errcode='40001';
    end if;
  end if;
  return jsonb_build_object('duplicate',v_duplicate,
    'counter',jsonb_build_object('id',v_counter.id,'case_id',v_counter.case_id,'status',v_counter.status,'created_at',v_counter.created_at),
    'case',jsonb_build_object('id',v_case.id,'status',v_case.status,'counter_received_at',v_case.counter_received_at,
      'restore_eligible_at',v_case.restore_eligible_at,'restore_deadline_at',v_case.restore_deadline_at,
      'claimant_name',v_case.claimant_name,'claimant_email',v_case.claimant_email));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_media_like_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.photo_id is not null then
      update public.dancer_photos
      set like_count = like_count + 1
      where id = new.photo_id;
    else
      update public.mydancr_tv_videos
      set like_count = like_count + 1
      where id = new.video_id;
    end if;
    return new;
  end if;

  if old.photo_id is not null then
    update public.dancer_photos
    set like_count = greatest(0, like_count - 1)
    where id = old.photo_id;
  else
    update public.mydancr_tv_videos
    set like_count = greatest(0, like_count - 1)
    where id = old.video_id;
  end if;
  return old;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_verified_auth_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin update public.app_users set email=new.email,updated_at=now() where id=new.id; return new; end; $function$
;
CREATE OR REPLACE FUNCTION public.touch_venue_club_deal_request_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_venue_pilot_night_report_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_venue_signup_request_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transition_dancer_publication_safely(p_dancer_id uuid, p_transition text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.dancer_profiles%rowtype;
  v_account public.app_users%rowtype;
  v_owner boolean;
  v_admin boolean;
  v_update jsonb;
  v_status public.dancer_status;
begin
  if p_actor_user_id is null then raise exception using errcode='42501',message='An authorized actor is required.'; end if;
  select * into v_profile from public.dancer_profiles where id=p_dancer_id;
  if not found then raise exception using errcode='P0002',message='Dancer profile not found.'; end if;
  -- Account before profile is the same order used by account-state changes.
  select * into v_account from public.app_users where id=v_profile.user_id for update;
  if not found or v_account.role<>'dancer' then raise exception using errcode='P0002',message='Dancer account not found.'; end if;
  select * into v_profile from public.dancer_profiles where id=p_dancer_id for update;
  if not found or v_profile.user_id<>v_account.id then raise exception using errcode='P0002',message='Dancer profile changed.'; end if;
  v_owner := p_actor_user_id=v_profile.user_id;
  v_admin := exists(select 1 from public.app_users where id=p_actor_user_id and role='admin' and account_state='active');
  if not (v_owner or v_admin) then raise exception using errcode='42501',message='Unauthorized profile change.'; end if;
  if p_transition='submit_for_venue_review' then
    if not v_owner or v_account.account_state<>'active' or v_profile.disabled_at is not null or v_profile.admin_disabled_at is not null or v_profile.status='disabled' then
      raise exception using errcode='42501',message='Only the active dancer can submit this profile.';
    end if;
    v_update := jsonb_build_object('status','pending_review','verification_status','pending','approved_at',null,'is_public',false);
  elsif p_transition in ('admin_accept','admin_reject') then
    if not v_admin then raise exception using errcode='42501',message='An active admin account is required.'; end if;
    v_update := jsonb_build_object('status',case when p_transition='admin_accept' then 'pending_review' else 'rejected' end,
      'verification_status',case when p_transition='admin_accept' then 'pending' else 'rejected' end,'approved_at',null,'is_public',false);
  elsif p_transition in ('set_public','set_private') then
    if not v_owner then raise exception using errcode='42501',message='Only the dancer can change profile visibility.'; end if;
    if p_transition='set_public' and (v_account.account_state<>'active' or v_profile.status<>'approved'
      or v_profile.verification_status<>'approved' or v_profile.approved_at is null
      or v_profile.venue_approved_at is null or v_profile.disabled_at is not null or v_profile.admin_disabled_at is not null) then
      raise exception using errcode='22023',message='Profile approval is required before reactivation.';
    end if;
    v_update := jsonb_build_object('is_public',p_transition='set_public');
  elsif p_transition='disable' then
    v_update := jsonb_build_object('status','disabled','disabled_at',clock_timestamp(),'is_public',false);
    if v_admin then v_update := v_update || jsonb_build_object('admin_disabled_at',clock_timestamp()); end if;
  elsif p_transition='reactivate' then
    if v_account.account_state<>'active' then raise exception using errcode='22023',message='The dancer account must be active before reactivation.'; end if;
    -- Resuming a login account does not undo an administrative profile suspension.
    if v_profile.admin_disabled_at is not null and not v_admin then
      v_update := jsonb_build_object('status','disabled','is_public',false);
    else
      v_status := case when v_profile.verification_status='rejected' or v_profile.status='rejected' then 'rejected'::public.dancer_status
        when v_profile.verification_status='approved' and v_profile.approved_at is not null and v_profile.venue_approved_at is not null then 'approved'::public.dancer_status
        else 'pending_review'::public.dancer_status end;
      v_update := jsonb_build_object('status',v_status,'disabled_at',null,'admin_disabled_at',null,'is_public',v_status='approved');
    end if;
  else raise exception using errcode='22023',message='Unknown dancer publication transition.';
  end if;
  update public.dancer_profiles d set
    status=coalesce((v_update->>'status')::public.dancer_status,d.status),
    verification_status=coalesce((v_update->>'verification_status')::public.review_status,d.verification_status),
    approved_at=case when v_update ? 'approved_at' then (v_update->>'approved_at')::timestamptz else d.approved_at end,
    disabled_at=case when v_update ? 'disabled_at' then (v_update->>'disabled_at')::timestamptz else d.disabled_at end,
    admin_disabled_at=case when v_update ? 'admin_disabled_at' then (v_update->>'admin_disabled_at')::timestamptz else d.admin_disabled_at end,
    is_public=coalesce((v_update->>'is_public')::boolean,d.is_public), updated_at=clock_timestamp()
  where d.id=p_dancer_id returning d.* into v_profile;
  return jsonb_build_object('id',v_profile.id,'user_id',v_profile.user_id,'status',v_profile.status,
    'verification_status',v_profile.verification_status,'approved_at',v_profile.approved_at,
    'is_public',v_profile.is_public,'disabled_at',v_profile.disabled_at,'venue_approved_at',v_profile.venue_approved_at,
    'venue_approved_by_user_id',v_profile.venue_approved_by_user_id,'venue_approved_venue_id',v_profile.venue_approved_venue_id);
end; $function$
;
CREATE OR REPLACE FUNCTION public.transition_dmca_admin_case(p_case_id uuid, p_admin_id uuid, p_action text, p_expected_status text, p_expected_updated_at timestamp with time zone, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET "TimeZone" TO 'UTC'
AS $function$
declare
  v_case public.dmca_cases%rowtype;
  v_status text;
  v_notes text:=nullif(btrim(coalesce(p_notes,'')),'');
  v_now timestamptz;
  v_rows integer;
  v_court_received boolean;
  v_court_notes text;
begin
  if p_admin_id is null or not exists(select 1 from public.app_users where id=p_admin_id and role='admin' and account_state='active') then
    raise exception 'DMCA_ADMIN_REQUIRED' using errcode='42501';
  end if;
  if p_case_id is null or p_action is null or p_action not in('request_information','reject','record_court_action','close')
    or p_expected_status is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
    or length(coalesce(p_notes,''))>4000 then
    raise exception 'INVALID_DMCA_ADMIN_TRANSITION' using errcode='22023';
  end if;
  select * into v_case from public.dmca_cases where id=p_case_id for update;
  if not found then raise exception 'DMCA_CASE_NOT_FOUND' using errcode='P0002';end if;
  if v_case.status is distinct from p_expected_status or v_case.updated_at is distinct from p_expected_updated_at then
    raise exception 'DMCA_CASE_CHANGED' using errcode='40001';
  end if;
  -- Match the existing administrator panel's offered state/action pairs.
  if p_action in('request_information','reject') and v_case.status not in('submitted','needs_information')
    or p_action='record_court_action' and (v_case.status<>'countered' or v_notes is null)
    or p_action='close' and v_case.status<>'court_hold' then
    raise exception 'DMCA_ACTION_NOT_AVAILABLE' using errcode='22023';
  end if;
  v_status:=case p_action when 'request_information'then'needs_information' when'reject'then'rejected'
    when'record_court_action'then'court_hold' else'closed'end;
  v_now:=clock_timestamp();
  v_court_received:=case when p_action='record_court_action'then true else v_case.court_filing_received end;
  v_court_notes:=case when p_action='record_court_action'then v_notes else v_case.court_filing_notes end;
  update public.dmca_cases set status=v_status,reviewed_by=p_admin_id,reviewed_at=v_now,updated_at=v_now,
    admin_notes=v_notes,court_filing_received=case when p_action='record_court_action'then true else court_filing_received end,
    court_filing_notes=case when p_action='record_court_action'then v_notes else court_filing_notes end
    where id=p_case_id returning * into v_case;
  if not found or row(v_case.id,v_case.status,v_case.reviewed_by,v_case.reviewed_at,v_case.updated_at,v_case.admin_notes,v_case.court_filing_received,v_case.court_filing_notes)
    is distinct from row(p_case_id,v_status,p_admin_id,v_now,v_now,v_notes,v_court_received,v_court_notes) then
    raise exception 'DMCA_CASE_WRITE_UNCONFIRMED' using errcode='40001';end if;
  insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
    values(p_admin_id,'dmca_case',p_case_id,'dmca_'||p_action,v_notes);
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'DMCA_AUDIT_WRITE_UNCONFIRMED' using errcode='40001';end if;
  return jsonb_build_object('caseId',v_case.id,'status',v_case.status,'updatedAt',v_case.updated_at);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transition_own_account_safely(p_user_id uuid, p_account_state text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  v_account public.app_users%rowtype;
  v_venue public.venues%rowtype;
  v_dancer public.dancer_profiles%rowtype;
  v_pause public.account_self_pauses%rowtype;
  v_previous_dancer jsonb;
  v_affected bigint;
  v_role public.user_role;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'ACCOUNT_TRANSITION_SERVICE_REQUIRED' using errcode='42501';
  end if;
  if p_user_id is null or p_account_state is null or p_account_state not in ('active','disabled','deleted') then
    raise exception 'ACCOUNT_TRANSITION_INVALID_INPUT' using errcode='22023';
  end if;
  select * into v_account from public.app_users where id = p_user_id for update;
  if not found then raise exception 'ACCOUNT_TRANSITION_NOT_FOUND' using errcode='42501'; end if;
  v_role := v_account.role;
  if p_account_state <> 'deleted' and (v_account.account_state = 'deleted' or v_account.dmca_suspended_at is not null) then
    raise exception 'ACCOUNT_TRANSITION_RESTRICTED' using errcode='42501';
  end if;

  -- Lock resources before the pause record: independent venue/profile writers
  -- already hold their resource row when their invalidation trigger runs.
  if v_account.role = 'venue' then
    select * into v_venue from public.venues where owner_user_id = p_user_id for update;
  elsif v_account.role = 'dancer' then
    select * into v_dancer from public.dancer_profiles where user_id = p_user_id for update;
  end if;
  select * into v_pause from public.account_self_pauses where user_id = p_user_id for update;
  if v_account.account_state = 'disabled' and p_account_state <> 'deleted' and v_pause.user_id is null then
    raise exception 'ACCOUNT_TRANSITION_NOT_SELF_PAUSED' using errcode='42501';
  end if;
  if p_account_state = v_account.account_state::text and p_account_state <> 'deleted' then
    return jsonb_build_object('id',v_account.id,'role',v_account.role,'display_name',v_account.display_name,
      'email',v_account.email,'account_state',v_account.account_state);
  end if;

  if p_account_state = 'disabled' and v_dancer.id is not null then
    v_previous_dancer := jsonb_build_object('status',v_dancer.status,'disabled_at',v_dancer.disabled_at,'is_public',v_dancer.is_public);
  end if;
  update public.app_users set account_state = p_account_state::public.account_state,
    display_name = case when p_account_state = 'deleted' then null else display_name end,
    email = case when p_account_state = 'deleted' then null else email end
    where id = p_user_id and (p_account_state <> 'active' or dmca_suspended_at is null)
    returning * into v_account;
  if not found then raise exception 'ACCOUNT_TRANSITION_WRITE_MISMATCH' using errcode='40001'; end if;
  if v_account.id is distinct from p_user_id or v_account.role is distinct from v_role
    or v_account.account_state::text is distinct from p_account_state
    or (p_account_state = 'active' and v_account.dmca_suspended_at is not null)
    or (p_account_state = 'deleted' and (v_account.email is not null or v_account.display_name is not null)) then
    raise exception 'ACCOUNT_TRANSITION_WRITE_MISMATCH' using errcode='40001';
  end if;

  if p_account_state <> 'active' then
    if v_venue.id is not null then
      update public.venues set is_active = false where id = v_venue.id and owner_user_id = p_user_id;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.venues where id = v_venue.id and owner_user_id = p_user_id and not is_active) then
        raise exception 'ACCOUNT_TRANSITION_VENUE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
    if v_dancer.id is not null then
      update public.dancer_profiles set status = 'disabled', is_public = false,
        disabled_at = coalesce(disabled_at, clock_timestamp()), updated_at = clock_timestamp()
        where id = v_dancer.id and user_id = p_user_id;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.dancer_profiles where id = v_dancer.id and user_id = p_user_id
        and status = 'disabled' and not is_public and disabled_at is not null) then
        raise exception 'ACCOUNT_TRANSITION_PROFILE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
    if p_account_state = 'disabled' then
      insert into public.account_self_pauses(user_id, venue_id, venue_was_active, dancer_id, dancer_previous_state)
        values(p_user_id, v_venue.id, v_venue.is_active, v_dancer.id, v_previous_dancer);
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.account_self_pauses where user_id = p_user_id
        and venue_id is not distinct from v_venue.id and venue_was_active is not distinct from v_venue.is_active
        and dancer_id is not distinct from v_dancer.id and dancer_previous_state is not distinct from v_previous_dancer and not legacy_imported) then
        raise exception 'ACCOUNT_TRANSITION_PAUSE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
  else
    if v_venue.id is not null and v_pause.venue_id = v_venue.id and v_pause.venue_was_active is not null then
      update public.venues set is_active = v_pause.venue_was_active where id = v_venue.id and owner_user_id = p_user_id;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.venues where id = v_venue.id and owner_user_id = p_user_id
        and is_active is not distinct from v_pause.venue_was_active) then
        raise exception 'ACCOUNT_TRANSITION_VENUE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
    if v_dancer.id is not null and v_pause.dancer_id = v_dancer.id and v_pause.dancer_previous_state is not null
      and v_dancer.admin_disabled_at is null and v_dancer.dmca_suspended_at is null then
      update public.dancer_profiles set
        status = (v_pause.dancer_previous_state->>'status')::public.dancer_status,
        disabled_at = (v_pause.dancer_previous_state->>'disabled_at')::timestamptz,
        is_public = (v_pause.dancer_previous_state->>'is_public')::boolean
          and v_pause.dancer_previous_state->>'status' = 'approved'
          and verification_status = 'approved' and approved_at is not null
          and v_pause.dancer_previous_state->>'disabled_at' is null,
        updated_at = clock_timestamp()
        where id = v_dancer.id and user_id = p_user_id and admin_disabled_at is null and dmca_suspended_at is null;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.dancer_profiles where id = v_dancer.id and user_id = p_user_id
        and status::text = v_pause.dancer_previous_state->>'status'
        and disabled_at is not distinct from (v_pause.dancer_previous_state->>'disabled_at')::timestamptz
        and is_public is not distinct from ((v_pause.dancer_previous_state->>'is_public')::boolean
          and v_pause.dancer_previous_state->>'status' = 'approved'
          and verification_status = 'approved' and approved_at is not null
          and v_pause.dancer_previous_state->>'disabled_at' is null)) then
        raise exception 'ACCOUNT_TRANSITION_PROFILE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
  end if;
  if not exists(select 1 from public.app_users where id = p_user_id and role = v_role
    and account_state::text = p_account_state and (p_account_state <> 'active' or dmca_suspended_at is null))
    or (p_account_state <> 'disabled' and exists(select 1 from public.account_self_pauses where user_id = p_user_id)) then
    raise exception 'ACCOUNT_TRANSITION_FINAL_STATE_MISMATCH' using errcode='40001';
  end if;
  return jsonb_build_object('id',v_account.id,'role',v_account.role,'display_name',v_account.display_name,
    'email',v_account.email,'account_state',v_account.account_state);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.unique_dancer_slug(stage_name text, user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET lock_timeout TO '3s'
AS $function$
declare
  base_slug text;
  candidate text;
  suffix integer := 0;
begin
  -- Use the assignment trigger's existing lock before reading either link registry.
  -- VOLATILE gives the reads a fresh snapshot after a competing signup commits.
  perform pg_catalog.pg_advisory_xact_lock(7682451001::bigint);
  base_slug := public.slugify(stage_name);
  if base_slug = '' then
    base_slug := 'dancer';
  end if;
  candidate := base_slug;

  while exists (
    select 1 from public.dancer_profiles profile
    where profile.slug = candidate
      and profile.user_id is distinct from unique_dancer_slug.user_id
  ) or exists (
    select 1 from public.dancer_profile_slug_aliases alias
    where alias.slug = candidate
      and alias.dancer_id is distinct from (
        select profile.id from public.dancer_profiles profile
        where profile.user_id = unique_dancer_slug.user_id
      )
  ) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;
  return candidate;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.upsert_venue_pilot_night_report(p_admin_id uuid, p_venue_id uuid, p_service_date date, p_total_door_count integer, p_pilot_cost_cents integer, p_notes text)
 RETURNS venue_pilot_night_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_report public.venue_pilot_night_reports;
begin
  if not exists (
    select 1 from public.app_users admin_user
    where admin_user.id = p_admin_id
      and admin_user.role = 'admin'
      and admin_user.account_state = 'active'
  ) then
    raise exception 'Admin access required.';
  end if;

  insert into public.venue_pilot_night_reports (
    venue_id,
    service_date,
    total_door_count,
    pilot_cost_cents,
    notes,
    reported_by_user_id
  ) values (
    p_venue_id,
    p_service_date,
    p_total_door_count,
    p_pilot_cost_cents,
    nullif(trim(p_notes), ''),
    p_admin_id
  )
  on conflict (venue_id, service_date) do update set
    total_door_count = excluded.total_door_count,
    pilot_cost_cents = excluded.pilot_cost_cents,
    notes = excluded.notes,
    reported_by_user_id = excluded.reported_by_user_id
  returning * into v_report;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (
    p_admin_id,
    'venue_pilot_night_report',
    v_report.id,
    'upsert_pilot_night_report',
    p_service_date::text || ': ' || p_total_door_count::text || ' total door count'
  );

  return v_report;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_mydancr_tv_video_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  linked_shift public.shifts%rowtype;
  link_changed boolean := false;
begin
  if new.shift_id is not null then
    select * into linked_shift from public.shifts where id = new.shift_id;
    if linked_shift.id is null or linked_shift.dancer_id <> new.dancer_id then
      raise exception 'The selected shift does not belong to this dancer.';
    end if;
    new.venue_id := linked_shift.venue_id;
    if tg_op = 'INSERT' then
      link_changed := true;
    else
      link_changed :=
        old.shift_id is distinct from new.shift_id
        or old.dancer_id is distinct from new.dancer_id
        or old.venue_id is distinct from new.venue_id;
    end if;
    if link_changed then
      new.venue_tag_status := case
        when linked_shift.location_status in ('location_confirmed', 'club_confirmed')
          then 'confirmed'
        else 'pending'
      end;
      new.venue_featured := false;
    end if;
  elsif new.venue_id is null then
    new.venue_tag_status := 'unlinked';
    new.venue_featured := false;
  elsif tg_op = 'INSERT' or old.venue_id is distinct from new.venue_id then
    new.venue_tag_status := 'pending';
    new.venue_featured := false;
  end if;

  if new.venue_tag_status <> 'confirmed' then
    new.venue_featured := false;
  end if;
  new.updated_at := now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_sales_agent_hierarchy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_cycle boolean := false;
begin
  if new.sponsor_agent_id is not null then
    if new.sponsor_agent_id = new.id then
      raise exception using errcode = '22023', message = 'An agent cannot sponsor their own account.';
    end if;
    if not exists (
      select 1 from public.sales_agents sponsor
      where sponsor.id = new.sponsor_agent_id and sponsor.status = 'active'
    ) then
      raise exception using errcode = '22023', message = 'The selected sponsor must be an active sales agent.';
    end if;
    with recursive sponsors as (
      select agent.id, agent.sponsor_agent_id
      from public.sales_agents agent where agent.id = new.sponsor_agent_id
      union
      select parent.id, parent.sponsor_agent_id
      from public.sales_agents parent join sponsors on parent.id = sponsors.sponsor_agent_id
    )
    select exists(select 1 from sponsors where id = new.id) into v_cycle;
    if v_cycle then
      raise exception using errcode = '22023', message = 'This sponsor would create an invalid circular agent hierarchy.';
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.void_agent_commissions_with_revenue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status in ('refunded', 'voided') and old.status not in ('refunded', 'voided') then
    update public.agent_commission_events
    set status = 'voided', voided_at = clock_timestamp(),
        audit = audit || jsonb_build_object('source_revenue_status', new.status)
    where deal_revenue_event_id = new.id and status <> 'voided';
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.void_generated_deal_redemption(p_redemption_id uuid, p_reason text DEFAULT 'admin_marked_suspicious'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_redemption public.qr_redemptions%rowtype;
begin
  if v_user_id is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3
    or length(trim(p_reason)) > 180 then
    raise exception using errcode = '22023', message = 'A valid void reason is required.';
  end if;

  select redemption.*
    into v_redemption
  from public.qr_redemptions redemption
  where redemption.id = p_redemption_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Redemption not found.';
  end if;

  if v_redemption.status <> 'generated' then
    raise exception using
      errcode = '22023',
      message = 'Only an unused generated QR can be voided. Financial reversals require a separate refund record.';
  end if;

  update public.qr_redemptions
  set
    status = 'voided',
    suspicious = true,
    voided_at = v_now,
    voided_by_admin = v_user_id,
    audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
      'voided_by_admin', v_user_id,
      'void_reason', trim(p_reason)
    )
  where id = v_redemption.id;

  insert into public.qr_redemption_events (
    qr_redemption_id,
    event_type,
    actor_user_id,
    audit
  )
  values (
    v_redemption.id,
    'voided',
    v_user_id,
    jsonb_build_object('reason', trim(p_reason))
  );

  return jsonb_build_object(
    'id', v_redemption.id,
    'status', 'voided',
    'suspicious', true
  );
end;
$function$
;
alter table public."account_recovery_events" alter column "id" set default gen_random_uuid();
alter table public."account_recovery_events" alter column "created_at" set default now();
alter table public."account_self_pauses" alter column "paused_at" set default now();
alter table public."account_self_pauses" alter column "legacy_imported" set default false;
alter table public."admin_actions" alter column "id" set default gen_random_uuid();
alter table public."admin_actions" alter column "created_at" set default now();
alter table public."agent_commission_events" alter column "id" set default gen_random_uuid();
alter table public."agent_commission_events" alter column "currency" set default 'usd'::text;
alter table public."agent_commission_events" alter column "status" set default 'pending_venue_payment'::text;
alter table public."agent_commission_events" alter column "audit" set default '{}'::jsonb;
alter table public."agent_commission_events" alter column "created_at" set default now();
alter table public."app_users" alter column "account_state" set default 'active'::account_state;
alter table public."app_users" alter column "created_at" set default now();
alter table public."app_users" alter column "updated_at" set default now();
alter table public."approval_reviews" alter column "id" set default gen_random_uuid();
alter table public."approval_reviews" alter column "status" set default 'pending'::review_status;
alter table public."approval_reviews" alter column "created_at" set default now();
alter table public."club_deals" alter column "id" set default gen_random_uuid();
alter table public."club_deals" alter column "deal_description" set default ''::text;
alter table public."club_deals" alter column "is_active" set default true;
alter table public."club_deals" alter column "redemption_rules" set default '{}'::jsonb;
alter table public."club_deals" alter column "payout_type" set default 'none'::text;
alter table public."club_deals" alter column "payout_amount_cents" set default 0;
alter table public."club_deals" alter column "created_at" set default now();
alter table public."club_deals" alter column "updated_at" set default now();
alter table public."club_deals" alter column "currency" set default 'usd'::text;
alter table public."club_deals" alter column "offer_type" set default 'admission'::text;
alter table public."club_deals" alter column "sort_order" set default 0;
alter table public."club_finance_accounts" alter column "collection_method" set default 'send_invoice'::text;
alter table public."club_finance_accounts" alter column "payment_terms_days" set default 15;
alter table public."club_finance_accounts" alter column "automatic_billing_enabled" set default true;
alter table public."club_finance_accounts" alter column "created_at" set default now();
alter table public."club_finance_accounts" alter column "updated_at" set default now();
alter table public."club_invoice_items" alter column "id" set default gen_random_uuid();
alter table public."club_invoice_items" alter column "created_at" set default now();
alter table public."club_invoice_reminders" alter column "id" set default gen_random_uuid();
alter table public."club_invoice_reminders" alter column "delivery_provider" set default 'stripe'::text;
alter table public."club_invoice_reminders" alter column "sent_at" set default now();
alter table public."club_invoice_reminders" alter column "audit" set default '{}'::jsonb;
alter table public."club_invoices" alter column "id" set default gen_random_uuid();
alter table public."club_invoices" alter column "sequence" set default 1;
alter table public."club_invoices" alter column "status" set default 'draft'::text;
alter table public."club_invoices" alter column "currency" set default 'usd'::text;
alter table public."club_invoices" alter column "amount_due_cents" set default 0;
alter table public."club_invoices" alter column "amount_paid_cents" set default 0;
alter table public."club_invoices" alter column "reminder_count" set default 0;
alter table public."club_invoices" alter column "created_at" set default now();
alter table public."club_invoices" alter column "updated_at" set default now();
alter table public."club_shuttle_requests" alter column "created_at" set default now();
alter table public."commission_events" alter column "id" set default gen_random_uuid();
alter table public."commission_events" alter column "status" set default 'pending'::text;
alter table public."commission_events" alter column "amount_cents" set default 0;
alter table public."commission_events" alter column "payout_type" set default 'none'::text;
alter table public."commission_events" alter column "audit" set default '{}'::jsonb;
alter table public."commission_events" alter column "created_at" set default now();
alter table public."commission_events" alter column "gross_commission_cents" set default 0;
alter table public."commission_events" alter column "dancer_share_bps" set default 0;
alter table public."commission_events" alter column "platform_amount_cents" set default 0;
alter table public."commission_events" alter column "currency" set default 'usd'::text;
alter table public."commission_events" alter column "policy_version" set default 'dancer-profile-monthly-30-40-50-v1'::text;
alter table public."commission_events" alter column "earning_type" set default 'club_deal_redemption'::text;
alter table public."commission_events" alter column "recovery_required" set default false;
alter table public."commission_events" alter column "is_test" set default false;
alter table public."commission_events" alter column "metadata" set default '{}'::jsonb;
alter table public."content_reports" alter column "id" set default gen_random_uuid();
alter table public."content_reports" alter column "target_type" set default 'profile'::text;
alter table public."content_reports" alter column "status" set default 'open'::text;
alter table public."content_reports" alter column "created_at" set default now();
alter table public."customer_deal_saves" alter column "source_type" set default 'club_page'::text;
alter table public."customer_deal_saves" alter column "created_at" set default now();
alter table public."customer_profiles" alter column "city" set default 'Las Vegas'::text;
alter table public."customer_profiles" alter column "notification_settings" set default '{"newShifts": true, "clubChanges": true, "venueSchedules": true, "workingTonight": true, "anyDancerInCity": false, "cancelledShifts": true, "followedVenuesOnly": true, "followedDancersOnly": true}'::jsonb;
alter table public."customer_profiles" alter column "created_at" set default now();
alter table public."customer_profiles" alter column "updated_at" set default now();
alter table public."dancer_earning_status_history" alter column "actor_type" set default 'system'::text;
alter table public."dancer_earning_status_history" alter column "metadata" set default '{}'::jsonb;
alter table public."dancer_earning_status_history" alter column "created_at" set default now();
alter table public."dancer_nfc_enrollments" alter column "id" set default gen_random_uuid();
alter table public."dancer_nfc_enrollments" alter column "status" set default 'pending'::text;
alter table public."dancer_nfc_enrollments" alter column "tapped_at" set default now();
alter table public."dancer_nfc_enrollments" alter column "expires_at" set default (now() + '7 days'::interval);
alter table public."dancer_nfc_enrollments" alter column "audit" set default '{}'::jsonb;
alter table public."dancer_nfc_enrollments" alter column "created_at" set default now();
alter table public."dancer_nfc_enrollments" alter column "updated_at" set default now();
alter table public."dancer_payout_accounts" alter column "country" set default 'US'::text;
alter table public."dancer_payout_accounts" alter column "default_currency" set default 'usd'::text;
alter table public."dancer_payout_accounts" alter column "details_submitted" set default false;
alter table public."dancer_payout_accounts" alter column "charges_enabled" set default false;
alter table public."dancer_payout_accounts" alter column "payouts_enabled" set default false;
alter table public."dancer_payout_accounts" alter column "onboarding_complete" set default false;
alter table public."dancer_payout_accounts" alter column "created_at" set default now();
alter table public."dancer_payout_accounts" alter column "updated_at" set default now();
alter table public."dancer_payout_accounts" alter column "id" set default gen_random_uuid();
alter table public."dancer_payout_accounts" alter column "payment_provider" set default 'stripe'::text;
alter table public."dancer_payout_accounts" alter column "onboarding_status" set default 'not_started'::text;
alter table public."dancer_payout_accounts" alter column "payout_eligibility" set default 'ineligible'::text;
alter table public."dancer_payout_accounts" alter column "verification_status" set default 'unverified'::text;
alter table public."dancer_payout_accounts" alter column "provider_status" set default '{}'::jsonb;
alter table public."dancer_payout_batches" alter column "id" set default gen_random_uuid();
alter table public."dancer_payout_batches" alter column "status" set default 'requested'::text;
alter table public."dancer_payout_batches" alter column "currency" set default 'usd'::text;
alter table public."dancer_payout_batches" alter column "created_at" set default now();
alter table public."dancer_payout_batches" alter column "updated_at" set default now();
alter table public."dancer_payout_batches" alter column "payment_provider" set default 'stripe'::text;
alter table public."dancer_payout_batches" alter column "requested_at" set default now();
alter table public."dancer_payout_batches" alter column "is_test" set default false;
alter table public."dancer_payout_batches" alter column "metadata" set default '{}'::jsonb;
alter table public."dancer_payout_items" alter column "id" set default gen_random_uuid();
alter table public."dancer_payout_items" alter column "created_at" set default now();
alter table public."dancer_photos" alter column "id" set default gen_random_uuid();
alter table public."dancer_photos" alter column "sort_order" set default 0;
alter table public."dancer_photos" alter column "is_primary" set default false;
alter table public."dancer_photos" alter column "review_status" set default 'pending'::review_status;
alter table public."dancer_photos" alter column "created_at" set default now();
alter table public."dancer_photos" alter column "like_count" set default 0;
alter table public."dancer_photos" alter column "is_pinned" set default false;
alter table public."dancer_profile_slug_aliases" alter column "created_at" set default now();
alter table public."dancer_profiles" alter column "id" set default gen_random_uuid();
alter table public."dancer_profiles" alter column "city" set default 'Las Vegas'::text;
alter table public."dancer_profiles" alter column "status" set default 'draft'::dancer_status;
alter table public."dancer_profiles" alter column "verification_status" set default 'pending'::review_status;
alter table public."dancer_profiles" alter column "photo_review_status" set default 'pending'::review_status;
alter table public."dancer_profiles" alter column "created_at" set default now();
alter table public."dancer_profiles" alter column "updated_at" set default now();
alter table public."dancer_profiles" alter column "is_public" set default false;
alter table public."deal_revenue_events" alter column "id" set default gen_random_uuid();
alter table public."deal_revenue_events" alter column "currency" set default 'usd'::text;
alter table public."deal_revenue_events" alter column "dancer_share_bps" set default 0;
alter table public."deal_revenue_events" alter column "dancer_commission_cents" set default 0;
alter table public."deal_revenue_events" alter column "policy_version" set default 'dancer-profile-monthly-30-40-50-v1'::text;
alter table public."deal_revenue_events" alter column "status" set default 'pending_venue_payment'::text;
alter table public."deal_revenue_events" alter column "audit" set default '{}'::jsonb;
alter table public."deal_revenue_events" alter column "confirmed_at" set default now();
alter table public."deal_revenue_events" alter column "created_at" set default now();
alter table public."deal_revenue_events" alter column "agent_commission_cents" set default 0;
alter table public."deal_revenue_events" alter column "dancer_commission_eligible" set default false;
alter table public."direction_requests" alter column "id" set default gen_random_uuid();
alter table public."direction_requests" alter column "requested_at" set default now();
alter table public."dmca_agent_settings" alter column "id" set default true;
alter table public."dmca_agent_settings" alter column "registered_with_copyright_office" set default false;
alter table public."dmca_agent_settings" alter column "updated_at" set default now();
alter table public."dmca_cases" alter column "id" set default gen_random_uuid();
alter table public."dmca_cases" alter column "target_type" set default 'other'::text;
alter table public."dmca_cases" alter column "status" set default 'submitted'::text;
alter table public."dmca_cases" alter column "court_filing_received" set default false;
alter table public."dmca_cases" alter column "repeat_infringer_enforced" set default false;
alter table public."dmca_cases" alter column "created_at" set default now();
alter table public."dmca_cases" alter column "updated_at" set default now();
alter table public."dmca_counter_notices" alter column "id" set default gen_random_uuid();
alter table public."dmca_counter_notices" alter column "status" set default 'submitted'::text;
alter table public."dmca_counter_notices" alter column "created_at" set default now();
alter table public."dmca_counter_notices" alter column "updated_at" set default now();
alter table public."dmca_enforcement_states" alter column "restore_allowed" set default true;
alter table public."dmca_enforcement_states" alter column "enforced_at" set default now();
alter table public."dmca_strikes" alter column "id" set default gen_random_uuid();
alter table public."dmca_strikes" alter column "active" set default true;
alter table public."dmca_strikes" alter column "issued_at" set default now();
alter table public."favorites" alter column "created_at" set default now();
alter table public."financial_audit_events" alter column "metadata" set default '{}'::jsonb;
alter table public."financial_audit_events" alter column "created_at" set default now();
alter table public."follows" alter column "notifications_enabled" set default true;
alter table public."follows" alter column "created_at" set default now();
alter table public."gallery_media_reference_history" alter column "recorded_at" set default clock_timestamp();
alter table public."gallery_media_reference_history" alter column "transaction_id" set default txid_current();
alter table public."gallery_storage_retirements" alter column "retirement_id" set default gen_random_uuid();
alter table public."gallery_storage_retirements" alter column "retired_at" set default clock_timestamp();
alter table public."going_signals" alter column "created_at" set default now();
alter table public."going_signals" alter column "id" set default gen_random_uuid();
alter table public."image_moderation_records" alter column "id" set default gen_random_uuid();
alter table public."image_moderation_records" alter column "provider" set default 'openai'::text;
alter table public."image_moderation_records" alter column "provider_flagged" set default false;
alter table public."image_moderation_records" alter column "reason_codes" set default '[]'::jsonb;
alter table public."image_moderation_records" alter column "category_flags" set default '{}'::jsonb;
alter table public."image_moderation_records" alter column "category_scores" set default '{}'::jsonb;
alter table public."image_moderation_records" alter column "created_at" set default now();
alter table public."image_moderation_records" alter column "updated_at" set default now();
alter table public."image_moderation_records" alter column "attempt_count" set default 0;
alter table public."image_moderation_records" alter column "photo_publication_mode" set default 'legacy'::text;
alter table public."media_likes" alter column "id" set default gen_random_uuid();
alter table public."media_likes" alter column "created_at" set default now();
alter table public."mydancr_tv_events" alter column "id" set default gen_random_uuid();
alter table public."mydancr_tv_events" alter column "source" set default 'tv_feed'::text;
alter table public."mydancr_tv_events" alter column "occurred_on" set default CURRENT_DATE;
alter table public."mydancr_tv_events" alter column "occurred_at" set default now();
alter table public."mydancr_tv_videos" alter column "id" set default gen_random_uuid();
alter table public."mydancr_tv_videos" alter column "status" set default 'uploading'::text;
alter table public."mydancr_tv_videos" alter column "venue_tag_status" set default 'unlinked'::text;
alter table public."mydancr_tv_videos" alter column "venue_featured" set default false;
alter table public."mydancr_tv_videos" alter column "consent_confirmed" set default false;
alter table public."mydancr_tv_videos" alter column "rights_confirmed" set default false;
alter table public."mydancr_tv_videos" alter column "created_at" set default now();
alter table public."mydancr_tv_videos" alter column "updated_at" set default now();
alter table public."mydancr_tv_videos" alter column "moderation_reason_codes" set default '{}'::text[];
alter table public."mydancr_tv_videos" alter column "moderation_category_scores" set default '{}'::jsonb;
alter table public."mydancr_tv_videos" alter column "moderation_provider_flagged" set default false;
alter table public."mydancr_tv_videos" alter column "moderation_frame_count" set default 0;
alter table public."mydancr_tv_videos" alter column "moderation_details" set default '{}'::jsonb;
alter table public."mydancr_tv_videos" alter column "moderation_attempt_count" set default 0;
alter table public."mydancr_tv_videos" alter column "distribution_scope" set default 'profile_and_feed'::text;
alter table public."mydancr_tv_videos" alter column "like_count" set default 0;
alter table public."mydancr_tv_videos" alter column "is_pinned" set default false;
alter table public."nats_affiliate_accounts" alter column "status" set default 'requested'::text;
alter table public."nats_affiliate_accounts" alter column "requested_at" set default now();
alter table public."nats_affiliate_accounts" alter column "metadata" set default '{}'::jsonb;
alter table public."nats_affiliate_accounts" alter column "created_at" set default now();
alter table public."nats_affiliate_accounts" alter column "updated_at" set default now();
alter table public."nats_agent_affiliate_accounts" alter column "status" set default 'requested'::text;
alter table public."nats_agent_affiliate_accounts" alter column "requested_at" set default now();
alter table public."nats_agent_affiliate_accounts" alter column "metadata" set default '{}'::jsonb;
alter table public."nats_agent_affiliate_accounts" alter column "created_at" set default now();
alter table public."nats_agent_affiliate_accounts" alter column "updated_at" set default now();
alter table public."nats_agent_commission_exports" alter column "id" set default gen_random_uuid();
alter table public."nats_agent_commission_exports" alter column "currency" set default 'usd'::text;
alter table public."nats_agent_commission_exports" alter column "status" set default 'waiting_for_affiliate'::text;
alter table public."nats_agent_commission_exports" alter column "attempt_count" set default 0;
alter table public."nats_agent_commission_exports" alter column "response_metadata" set default '{}'::jsonb;
alter table public."nats_agent_commission_exports" alter column "created_at" set default now();
alter table public."nats_agent_commission_exports" alter column "updated_at" set default now();
alter table public."nats_commission_exports" alter column "id" set default gen_random_uuid();
alter table public."nats_commission_exports" alter column "currency" set default 'usd'::text;
alter table public."nats_commission_exports" alter column "status" set default 'waiting_for_affiliate'::text;
alter table public."nats_commission_exports" alter column "attempt_count" set default 0;
alter table public."nats_commission_exports" alter column "response_metadata" set default '{}'::jsonb;
alter table public."nats_commission_exports" alter column "created_at" set default now();
alter table public."nats_commission_exports" alter column "updated_at" set default now();
alter table public."nfc_tags" alter column "id" set default gen_random_uuid();
alter table public."nfc_tags" alter column "status" set default 'active'::text;
alter table public."nfc_tags" alter column "tap_count" set default 0;
alter table public."nfc_tags" alter column "created_at" set default now();
alter table public."nfc_tags" alter column "updated_at" set default now();
alter table public."nfc_tags" alter column "scan_count" set default 0;
alter table public."nfc_tap_events" alter column "id" set default gen_random_uuid();
alter table public."nfc_tap_events" alter column "audit" set default '{}'::jsonb;
alter table public."nfc_tap_events" alter column "occurred_at" set default now();
alter table public."notifications" alter column "id" set default gen_random_uuid();
alter table public."notifications" alter column "channel" set default 'in_app'::notification_channel;
alter table public."notifications" alter column "payload" set default '{}'::jsonb;
alter table public."notifications" alter column "created_at" set default now();
alter table public."payment_provider_webhook_events" alter column "metadata" set default '{}'::jsonb;
alter table public."payment_provider_webhook_events" alter column "id" set default gen_random_uuid();
alter table public."payment_provider_webhook_events" alter column "payment_provider" set default 'stripe'::text;
alter table public."payment_provider_webhook_events" alter column "processing_status" set default 'processing'::text;
alter table public."payment_provider_webhook_events" alter column "received_at" set default now();
alter table public."payment_provider_webhook_events" alter column "processing_started_at" set default now();
alter table public."payment_provider_webhook_events" alter column "attempt_count" set default 1;
alter table public."payout_settings" alter column "id" set default 'default'::text;
alter table public."payout_settings" alter column "payouts_enabled" set default false;
alter table public."payout_settings" alter column "payment_provider" set default 'stripe'::text;
alter table public."payout_settings" alter column "earnings_hold_days" set default 7;
alter table public."payout_settings" alter column "minimum_payout_cents" set default 2000;
alter table public."payout_settings" alter column "payout_mode" set default 'manual_cashout'::text;
alter table public."payout_settings" alter column "created_at" set default now();
alter table public."payout_settings" alter column "updated_at" set default now();
alter table public."profile_views" alter column "id" set default gen_random_uuid();
alter table public."profile_views" alter column "viewed_at" set default now();
alter table public."qr_redemption_events" alter column "id" set default gen_random_uuid();
alter table public."qr_redemption_events" alter column "audit" set default '{}'::jsonb;
alter table public."qr_redemption_events" alter column "occurred_at" set default now();
alter table public."qr_redemptions" alter column "id" set default gen_random_uuid();
alter table public."qr_redemptions" alter column "generated_at" set default now();
alter table public."qr_redemptions" alter column "status" set default 'generated'::text;
alter table public."qr_redemptions" alter column "audit" set default '{}'::jsonb;
alter table public."qr_redemptions" alter column "suspicious" set default false;
alter table public."qr_redemptions" alter column "created_at" set default now();
alter table public."ranking_events" alter column "id" set default gen_random_uuid();
alter table public."ranking_events" alter column "created_at" set default now();
alter table public."sales_agents" alter column "id" set default gen_random_uuid();
alter table public."sales_agents" alter column "status" set default 'active'::text;
alter table public."sales_agents" alter column "commission_depth_limit" set default 3;
alter table public."sales_agents" alter column "created_at" set default now();
alter table public."sales_agents" alter column "updated_at" set default now();
alter table public."sales_agents" alter column "referral_code" set default encode(extensions.gen_random_bytes(18), 'hex'::text);
alter table public."schedule_views" alter column "id" set default gen_random_uuid();
alter table public."schedule_views" alter column "viewed_at" set default now();
alter table public."shift_location_events" alter column "id" set default gen_random_uuid();
alter table public."shift_location_events" alter column "occurred_at" set default now();
alter table public."shifts" alter column "id" set default gen_random_uuid();
alter table public."shifts" alter column "timezone" set default 'America/Los_Angeles'::text;
alter table public."shifts" alter column "status" set default 'posted'::shift_status;
alter table public."shifts" alter column "broadcast_recipients" set default 0;
alter table public."shifts" alter column "created_at" set default now();
alter table public."shifts" alter column "updated_at" set default now();
alter table public."shifts" alter column "location_status" set default 'self_reported'::text;
alter table public."shifts" alter column "working_status" set default 'self_reported'::text;
alter table public."shifts" alter column "shift_summary" set default '{}'::jsonb;
alter table public."shifts" alter column "shift_source" set default 'scheduled'::text;
alter table public."social_clicks" alter column "id" set default gen_random_uuid();
alter table public."social_clicks" alter column "clicked_at" set default now();
alter table public."social_links" alter column "id" set default gen_random_uuid();
alter table public."social_links" alter column "is_active" set default true;
alter table public."social_links" alter column "created_at" set default now();
alter table public."social_links" alter column "updated_at" set default now();
alter table public."subscriptions" alter column "id" set default gen_random_uuid();
alter table public."subscriptions" alter column "status" set default 'not_started'::text;
alter table public."subscriptions" alter column "created_at" set default now();
alter table public."subscriptions" alter column "updated_at" set default now();
alter table public."support_ai_runs" alter column "id" set default gen_random_uuid();
alter table public."support_ai_runs" alter column "moderation" set default '{}'::jsonb;
alter table public."support_ai_runs" alter column "created_at" set default now();
alter table public."support_messages" alter column "id" set default gen_random_uuid();
alter table public."support_messages" alter column "created_at" set default now();
alter table public."support_messages" alter column "sender_kind" set default 'human'::text;
alter table public."support_messages" alter column "metadata" set default '{}'::jsonb;
alter table public."support_threads" alter column "id" set default gen_random_uuid();
alter table public."support_threads" alter column "status" set default 'open'::text;
alter table public."support_threads" alter column "last_message_at" set default now();
alter table public."support_threads" alter column "created_at" set default now();
alter table public."support_threads" alter column "updated_at" set default now();
alter table public."support_threads" alter column "escalation_status" set default 'none'::text;
alter table public."support_threads" alter column "ai_reply_count" set default 0;
alter table public."trending_scores" alter column "score" set default 0;
alter table public."trending_scores" alter column "trend" set default 'stable'::text;
alter table public."trending_scores" alter column "calculated_at" set default now();
alter table public."venue_activity_log" alter column "id" set default gen_random_uuid();
alter table public."venue_activity_log" alter column "metadata" set default '{}'::jsonb;
alter table public."venue_activity_log" alter column "created_at" set default now();
alter table public."venue_claim_codes" alter column "id" set default gen_random_uuid();
alter table public."venue_claim_codes" alter column "created_at" set default now();
alter table public."venue_club_deal_requests" alter column "id" set default gen_random_uuid();
alter table public."venue_club_deal_requests" alter column "status" set default 'pending'::text;
alter table public."venue_club_deal_requests" alter column "created_at" set default now();
alter table public."venue_club_deal_requests" alter column "updated_at" set default now();
alter table public."venue_club_deal_requests" alter column "request_type" set default 'add'::text;
alter table public."venue_dancer_affiliation_events" alter column "id" set default gen_random_uuid();
alter table public."venue_dancer_affiliation_events" alter column "event_payload" set default '{}'::jsonb;
alter table public."venue_dancer_affiliation_events" alter column "occurred_at" set default now();
alter table public."venue_dancer_affiliations" alter column "id" set default gen_random_uuid();
alter table public."venue_dancer_affiliations" alter column "status" set default 'active'::text;
alter table public."venue_dancer_affiliations" alter column "approved_at" set default now();
alter table public."venue_dancer_affiliations" alter column "created_at" set default now();
alter table public."venue_dancer_affiliations" alter column "updated_at" set default now();
alter table public."venue_dancer_verification_tokens" alter column "id" set default gen_random_uuid();
alter table public."venue_dancer_verification_tokens" alter column "created_at" set default now();
alter table public."venue_follows" alter column "notifications_enabled" set default true;
alter table public."venue_follows" alter column "created_at" set default now();
alter table public."venue_nfc_support_requests" alter column "id" set default gen_random_uuid();
alter table public."venue_nfc_support_requests" alter column "status" set default 'open'::text;
alter table public."venue_nfc_support_requests" alter column "created_at" set default now();
alter table public."venue_nfc_support_requests" alter column "updated_at" set default now();
alter table public."venue_ownership_claims" alter column "id" set default gen_random_uuid();
alter table public."venue_ownership_claims" alter column "status" set default 'pending'::text;
alter table public."venue_ownership_claims" alter column "submitted_at" set default now();
alter table public."venue_ownership_claims" alter column "updated_at" set default now();
alter table public."venue_page_events" alter column "id" set default gen_random_uuid();
alter table public."venue_page_events" alter column "occurred_on" set default CURRENT_DATE;
alter table public."venue_page_events" alter column "occurred_at" set default now();
alter table public."venue_pilot_night_reports" alter column "id" set default gen_random_uuid();
alter table public."venue_pilot_night_reports" alter column "pilot_cost_cents" set default 0;
alter table public."venue_pilot_night_reports" alter column "created_at" set default now();
alter table public."venue_pilot_night_reports" alter column "updated_at" set default now();
alter table public."venue_referral_fee_change_requests" alter column "id" set default gen_random_uuid();
alter table public."venue_referral_fee_change_requests" alter column "currency" set default 'usd'::text;
alter table public."venue_referral_fee_change_requests" alter column "status" set default 'pending'::text;
alter table public."venue_referral_fee_change_requests" alter column "created_at" set default now();
alter table public."venue_referral_fee_change_requests" alter column "updated_at" set default now();
alter table public."venue_referral_fee_terms" alter column "id" set default gen_random_uuid();
alter table public."venue_referral_fee_terms" alter column "currency" set default 'usd'::text;
alter table public."venue_referral_fee_terms" alter column "created_at" set default now();
alter table public."venue_sales_attributions" alter column "id" set default gen_random_uuid();
alter table public."venue_sales_attributions" alter column "effective_from" set default now();
alter table public."venue_sales_attributions" alter column "created_at" set default now();
alter table public."venue_signup_requests" alter column "id" set default gen_random_uuid();
alter table public."venue_signup_requests" alter column "status" set default 'pending'::text;
alter table public."venue_signup_requests" alter column "submitted_at" set default now();
alter table public."venue_signup_requests" alter column "updated_at" set default now();
alter table public."venue_team_invitations" alter column "id" set default gen_random_uuid();
alter table public."venue_team_invitations" alter column "created_at" set default now();
alter table public."venue_team_invitations" alter column "updated_at" set default now();
alter table public."venue_team_members" alter column "id" set default gen_random_uuid();
alter table public."venue_team_members" alter column "status" set default 'active'::text;
alter table public."venue_team_members" alter column "joined_at" set default now();
alter table public."venue_team_members" alter column "updated_at" set default now();
alter table public."venues" alter column "id" set default gen_random_uuid();
alter table public."venues" alter column "timezone" set default 'America/Los_Angeles'::text;
alter table public."venues" alter column "is_active" set default true;
alter table public."venues" alter column "created_at" set default now();
alter table public."venues" alter column "updated_at" set default now();
alter table public."venues" alter column "page_review_status" set default 'admin_draft'::text;
alter table public."account_recovery_events" add constraint "account_recovery_events_outcome_check" CHECK ((outcome = ANY (ARRAY['accepted'::text, 'rate_limited'::text])));
alter table public."account_recovery_events" add constraint "account_recovery_events_pkey" PRIMARY KEY (id);
alter table public."account_recovery_events" add constraint "account_recovery_events_role_check" CHECK ((account_role = ANY (ARRAY['customer'::text, 'dancer'::text, 'venue'::text, 'admin'::text])));
alter table public."account_recovery_events" add constraint "account_recovery_events_type_check" CHECK ((event_type = ANY (ARRAY['password_reset'::text, 'email_lookup'::text])));
alter table public."account_self_pauses" add constraint "account_self_pauses_dancer_previous_state_check" CHECK (((dancer_previous_state IS NULL) OR ((jsonb_typeof(dancer_previous_state) = 'object'::text) AND (dancer_previous_state ?& ARRAY['status'::text, 'disabled_at'::text, 'is_public'::text]) AND ((dancer_previous_state - ARRAY['status'::text, 'disabled_at'::text, 'is_public'::text]) = '{}'::jsonb) AND ((dancer_previous_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text, 'disabled'::text])) AND (jsonb_typeof((dancer_previous_state -> 'is_public'::text)) = 'boolean'::text) AND (jsonb_typeof((dancer_previous_state -> 'disabled_at'::text)) = ANY (ARRAY['string'::text, 'null'::text])))));
alter table public."account_self_pauses" add constraint "account_self_pauses_paused_at_check" CHECK (isfinite(paused_at));
alter table public."account_self_pauses" add constraint "account_self_pauses_pkey" PRIMARY KEY (user_id);
alter table public."admin_actions" add constraint "admin_actions_pkey" PRIMARY KEY (id);
alter table public."agent_commission_events" add constraint "agent_commission_events_amount_cents_check" CHECK ((amount_cents > 0));
alter table public."agent_commission_events" add constraint "agent_commission_events_check" CHECK ((((sponsor_level = 0) AND (share_bps = 1500) AND (recipient_agent_id = signing_agent_id)) OR ((sponsor_level = 1) AND (share_bps = 300)) OR ((sponsor_level = 2) AND (share_bps = 250)) OR ((sponsor_level = 3) AND (share_bps = 200)) OR ((sponsor_level = 4) AND (share_bps = 150)) OR ((sponsor_level = 5) AND (share_bps = 100))));
alter table public."agent_commission_events" add constraint "agent_commission_events_currency_check" CHECK ((currency = 'usd'::text));
alter table public."agent_commission_events" add constraint "agent_commission_events_deal_revenue_event_id_sponsor_level_key" UNIQUE (deal_revenue_event_id, sponsor_level);
alter table public."agent_commission_events" add constraint "agent_commission_events_pkey" PRIMARY KEY (id);
alter table public."agent_commission_events" add constraint "agent_commission_events_share_bps_check" CHECK ((share_bps = ANY (ARRAY[100, 150, 200, 250, 300, 1500])));
alter table public."agent_commission_events" add constraint "agent_commission_events_sponsor_level_check" CHECK (((sponsor_level >= 0) AND (sponsor_level <= 5)));
alter table public."agent_commission_events" add constraint "agent_commission_events_status_check" CHECK ((status = ANY (ARRAY['pending_venue_payment'::text, 'payable'::text, 'paid'::text, 'voided'::text])));
alter table public."app_users" add constraint "app_users_pkey" PRIMARY KEY (id);
alter table public."approval_reviews" add constraint "approval_reviews_pkey" PRIMARY KEY (id);
alter table public."club_deals" add constraint "club_deals_active_supported_offer_check" CHECK (((NOT is_active) OR ((deal_title = ANY (ARRAY['Half-off admission'::text, 'Skip the line'::text, 'Free admission'::text])) AND (offer_type = 'admission'::text) AND (booking_url IS NULL))));
alter table public."club_deals" add constraint "club_deals_booking_url_check" CHECK (((booking_url IS NULL) OR (booking_url ~* '^https://[^[:space:]]+$'::text)));
alter table public."club_deals" add constraint "club_deals_currency_check" CHECK ((currency ~ '^[a-z]{3}$'::text));
alter table public."club_deals" add constraint "club_deals_liquor_free_check" CHECK ((NOT club_deal_is_liquor_related(offer_type, deal_title, deal_description, deal_terms))) NOT VALID;
alter table public."club_deals" add constraint "club_deals_offer_type_check" CHECK ((offer_type = ANY (ARRAY['admission'::text, 'other'::text])));
alter table public."club_deals" add constraint "club_deals_payout_amount_cents_check" CHECK ((payout_amount_cents >= 0));
alter table public."club_deals" add constraint "club_deals_payout_type_check" CHECK ((payout_type = ANY (ARRAY['none'::text, 'flat'::text, 'percent'::text])));
alter table public."club_deals" add constraint "club_deals_pkey" PRIMARY KEY (id);
alter table public."club_deals" add constraint "club_deals_removed_are_inactive" CHECK (((removed_at IS NULL) OR (NOT is_active)));
alter table public."club_deals" add constraint "club_deals_sort_order_check" CHECK (((sort_order >= 0) AND (sort_order <= 1000)));
alter table public."club_finance_accounts" add constraint "club_finance_accounts_collection_method_check" CHECK ((collection_method = ANY (ARRAY['send_invoice'::text, 'charge_automatically'::text])));
alter table public."club_finance_accounts" add constraint "club_finance_accounts_payment_terms_days_check" CHECK (((payment_terms_days >= 1) AND (payment_terms_days <= 90)));
alter table public."club_finance_accounts" add constraint "club_finance_accounts_pkey" PRIMARY KEY (venue_id);
alter table public."club_finance_accounts" add constraint "club_finance_accounts_stripe_customer_id_key" UNIQUE (stripe_customer_id);
alter table public."club_invoice_items" add constraint "club_invoice_items_amount_cents_check" CHECK ((amount_cents > 0));
alter table public."club_invoice_items" add constraint "club_invoice_items_invoice_id_revenue_event_id_key" UNIQUE (invoice_id, revenue_event_id);
alter table public."club_invoice_items" add constraint "club_invoice_items_pkey" PRIMARY KEY (id);
alter table public."club_invoice_items" add constraint "club_invoice_items_revenue_event_once_key" UNIQUE (revenue_event_id);
alter table public."club_invoice_reminders" add constraint "club_invoice_reminders_invoice_id_reminder_key_key" UNIQUE (invoice_id, reminder_key);
alter table public."club_invoice_reminders" add constraint "club_invoice_reminders_pkey" PRIMARY KEY (id);
alter table public."club_invoices" add constraint "club_invoices_amount_due_cents_check" CHECK ((amount_due_cents >= 0));
alter table public."club_invoices" add constraint "club_invoices_amount_paid_cents_check" CHECK ((amount_paid_cents >= 0));
alter table public."club_invoices" add constraint "club_invoices_check" CHECK ((period_end >= period_start));
alter table public."club_invoices" add constraint "club_invoices_check1" CHECK ((amount_paid_cents <= amount_due_cents));
alter table public."club_invoices" add constraint "club_invoices_currency_check" CHECK ((currency ~ '^[a-z]{3}$'::text));
alter table public."club_invoices" add constraint "club_invoices_pkey" PRIMARY KEY (id);
alter table public."club_invoices" add constraint "club_invoices_reminder_count_check" CHECK ((reminder_count >= 0));
alter table public."club_invoices" add constraint "club_invoices_sequence_check" CHECK ((sequence > 0));
alter table public."club_invoices" add constraint "club_invoices_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'overdue'::text, 'void'::text, 'uncollectible'::text, 'failed'::text])));
alter table public."club_invoices" add constraint "club_invoices_stripe_invoice_id_key" UNIQUE (stripe_invoice_id);
alter table public."club_invoices" add constraint "club_invoices_venue_id_period_start_period_end_sequence_key" UNIQUE (venue_id, period_start, period_end, sequence);
alter table public."club_shuttle_requests" add constraint "club_shuttle_requests_details_hash_check" CHECK ((details_hash ~ '^[0-9a-f]{64}$'::text));
alter table public."club_shuttle_requests" add constraint "club_shuttle_requests_notification_rows_check" CHECK (((jsonb_typeof(notification_rows) = 'array'::text) AND ((jsonb_array_length(notification_rows) >= 1) AND (jsonb_array_length(notification_rows) <= 100)) AND (octet_length((notification_rows)::text) <= 524288)));
alter table public."club_shuttle_requests" add constraint "club_shuttle_requests_pkey" PRIMARY KEY (id);
alter table public."commission_events" add constraint "commission_events_amount_cents_check" CHECK ((amount_cents >= 0));
alter table public."commission_events" add constraint "commission_events_currency_check" CHECK ((currency ~ '^[a-z]{3}$'::text));
alter table public."commission_events" add constraint "commission_events_dancer_share_bps_check" CHECK (((dancer_share_bps >= 0) AND (dancer_share_bps <= 10000)));
alter table public."commission_events" add constraint "commission_events_earning_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'available'::text, 'payout_processing'::text, 'paid'::text, 'reversed'::text, 'failed'::text])));
alter table public."commission_events" add constraint "commission_events_earning_type_check" CHECK ((earning_type = ANY (ARRAY['club_deal_redemption'::text, 'referral'::text, 'bottle_service'::text, 'promotion'::text, 'manual_adjustment'::text, 'other'::text])));
alter table public."commission_events" add constraint "commission_events_gross_commission_cents_check" CHECK ((gross_commission_cents >= 0));
alter table public."commission_events" add constraint "commission_events_gross_transaction_check" CHECK (((gross_transaction_amount_cents IS NULL) OR (gross_transaction_amount_cents >= 0)));
alter table public."commission_events" add constraint "commission_events_payment_provider_check" CHECK (((payment_provider IS NULL) OR (payment_provider = ANY (ARRAY['stripe'::text, 'bitsafe'::text, 'adyen'::text, 'other'::text]))));
alter table public."commission_events" add constraint "commission_events_payout_type_check" CHECK ((payout_type = ANY (ARRAY['none'::text, 'flat'::text, 'percent'::text])));
alter table public."commission_events" add constraint "commission_events_pkey" PRIMARY KEY (id);
alter table public."commission_events" add constraint "commission_events_platform_amount_cents_check" CHECK ((platform_amount_cents >= 0));
alter table public."commission_events" add constraint "commission_events_qr_redemption_id_key" UNIQUE (qr_redemption_id);
alter table public."commission_events" add constraint "commission_events_reversal_fields_check" CHECK (((status <> 'reversed'::text) OR ((reversed_at IS NOT NULL) AND (char_length(TRIM(BOTH FROM COALESCE(reversal_reason, ''::text))) >= 3))));
alter table public."content_reports" add constraint "content_reports_pkey" PRIMARY KEY (id);
alter table public."content_reports" add constraint "content_reports_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'removed'::text])));
alter table public."customer_deal_saves" add constraint "customer_deal_saves_pkey" PRIMARY KEY (customer_id, club_deal_id);
alter table public."customer_deal_saves" add constraint "customer_deal_saves_source_type_check" CHECK ((source_type = ANY (ARRAY['club_page'::text, 'dancer_profile'::text])));
alter table public."customer_profiles" add constraint "customer_profiles_pkey" PRIMARY KEY (user_id);
alter table public."dancer_earning_status_history" add constraint "dancer_earning_status_history_actor_type_check" CHECK ((actor_type = ANY (ARRAY['system'::text, 'admin'::text, 'dancer'::text, 'provider'::text])));
alter table public."dancer_earning_status_history" add constraint "dancer_earning_status_history_pkey" PRIMARY KEY (id);
alter table public."dancer_earning_status_history" add constraint "dancer_earning_status_history_to_status_check" CHECK ((to_status = ANY (ARRAY['pending'::text, 'available'::text, 'payout_processing'::text, 'paid'::text, 'reversed'::text, 'failed'::text])));
alter table public."dancer_nfc_enrollments" add constraint "dancer_nfc_enrollments_dancer_user_id_venue_id_key" UNIQUE (dancer_user_id, venue_id);
alter table public."dancer_nfc_enrollments" add constraint "dancer_nfc_enrollments_pkey" PRIMARY KEY (id);
alter table public."dancer_nfc_enrollments" add constraint "dancer_nfc_enrollments_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'expired'::text, 'revoked'::text])));
alter table public."dancer_payout_accounts" add constraint "dancer_payout_accounts_dancer_provider_key" UNIQUE (dancer_id, payment_provider);
alter table public."dancer_payout_accounts" add constraint "dancer_payout_accounts_default_currency_check" CHECK ((default_currency ~ '^[a-z]{3}$'::text));
alter table public."dancer_payout_accounts" add constraint "dancer_payout_accounts_onboarding_status_check" CHECK ((onboarding_status = ANY (ARRAY['not_started'::text, 'pending'::text, 'complete'::text, 'restricted'::text, 'disabled'::text])));
alter table public."dancer_payout_accounts" add constraint "dancer_payout_accounts_payment_provider_check" CHECK ((payment_provider = ANY (ARRAY['stripe'::text, 'bitsafe'::text, 'adyen'::text, 'other'::text])));
alter table public."dancer_payout_accounts" add constraint "dancer_payout_accounts_payout_eligibility_check" CHECK ((payout_eligibility = ANY (ARRAY['ineligible'::text, 'pending'::text, 'eligible'::text, 'restricted'::text])));
alter table public."dancer_payout_accounts" add constraint "dancer_payout_accounts_pkey" PRIMARY KEY (id);
alter table public."dancer_payout_accounts" add constraint "dancer_payout_accounts_stripe_account_id_key" UNIQUE (stripe_account_id);
alter table public."dancer_payout_accounts" add constraint "dancer_payout_accounts_verification_status_check" CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'restricted'::text])));
alter table public."dancer_payout_batches" add constraint "dancer_payout_batches_amount_cents_check" CHECK ((amount_cents > 0));
alter table public."dancer_payout_batches" add constraint "dancer_payout_batches_currency_check" CHECK ((currency ~ '^[a-z]{3}$'::text));
alter table public."dancer_payout_batches" add constraint "dancer_payout_batches_payment_provider_check" CHECK ((payment_provider = ANY (ARRAY['stripe'::text, 'bitsafe'::text, 'adyen'::text, 'other'::text])));
alter table public."dancer_payout_batches" add constraint "dancer_payout_batches_pkey" PRIMARY KEY (id);
alter table public."dancer_payout_batches" add constraint "dancer_payout_batches_status_check" CHECK ((status = ANY (ARRAY['requested'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'canceled'::text])));
alter table public."dancer_payout_batches" add constraint "dancer_payout_batches_stripe_transfer_id_key" UNIQUE (stripe_transfer_id);
alter table public."dancer_payout_items" add constraint "dancer_payout_items_amount_cents_check" CHECK ((amount_cents > 0));
alter table public."dancer_payout_items" add constraint "dancer_payout_items_payout_batch_id_commission_event_id_key" UNIQUE (payout_batch_id, commission_event_id);
alter table public."dancer_payout_items" add constraint "dancer_payout_items_pkey" PRIMARY KEY (id);
alter table public."dancer_photos" add constraint "dancer_photos_like_count_nonnegative" CHECK ((like_count >= 0));
alter table public."dancer_photos" add constraint "dancer_photos_pkey" PRIMARY KEY (id);
alter table public."dancer_profile_slug_aliases" add constraint "dancer_profile_slug_aliases_pkey" PRIMARY KEY (slug);
alter table public."dancer_profiles" add constraint "dancer_profiles_pkey" PRIMARY KEY (id);
alter table public."dancer_profiles" add constraint "dancer_profiles_slug_key" UNIQUE (slug);
alter table public."dancer_profiles" add constraint "dancer_profiles_stage_name_check" CHECK (((length(TRIM(BOTH FROM stage_name)) = 0) OR ((length(TRIM(BOTH FROM stage_name)) >= 2) AND (length(TRIM(BOTH FROM stage_name)) <= 40))));
alter table public."dancer_profiles" add constraint "dancer_profiles_user_id_key" UNIQUE (user_id);
alter table public."deal_revenue_events" add constraint "deal_revenue_events_agent_commission_cents_check" CHECK ((agent_commission_cents >= 0));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_commission_balance_check" CHECK ((((dancer_commission_cents + agent_commission_cents) + platform_commission_cents) = gross_commission_cents));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_currency_check" CHECK ((currency ~ '^[a-z]{3}$'::text));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_dancer_commission_cents_check" CHECK ((dancer_commission_cents >= 0));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_dancer_enrollment_check" CHECK ((((source_type = 'club_page'::text) AND (dancer_id IS NULL) AND (NOT dancer_commission_eligible) AND (dancer_nats_activated_at IS NULL) AND (dancer_share_bps = 0) AND (dancer_commission_cents = 0)) OR ((source_type = 'dancer_profile'::text) AND (dancer_id IS NOT NULL) AND ((dancer_commission_eligible AND (dancer_nats_activated_at IS NOT NULL) AND (dancer_nats_activated_at <= confirmed_at) AND (dancer_share_bps > 0)) OR ((NOT dancer_commission_eligible) AND (dancer_nats_activated_at IS NULL) AND (dancer_share_bps = 0) AND (dancer_commission_cents = 0) AND (successful_redemption_number IS NULL))))));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_dancer_share_bps_check" CHECK (((dancer_share_bps >= 0) AND (dancer_share_bps <= 10000)));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_gross_commission_cents_check" CHECK ((gross_commission_cents >= 0));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_pkey" PRIMARY KEY (id);
alter table public."deal_revenue_events" add constraint "deal_revenue_events_platform_commission_cents_check" CHECK ((platform_commission_cents >= 0));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_qr_redemption_id_key" UNIQUE (qr_redemption_id);
alter table public."deal_revenue_events" add constraint "deal_revenue_events_source_type_check" CHECK ((source_type = ANY (ARRAY['club_page'::text, 'dancer_profile'::text])));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_status_check" CHECK ((status = ANY (ARRAY['pending_venue_payment'::text, 'payable'::text, 'settled'::text, 'refunded'::text, 'voided'::text])));
alter table public."deal_revenue_events" add constraint "deal_revenue_events_successful_redemption_number_check" CHECK ((successful_redemption_number > 0));
alter table public."direction_requests" add constraint "direction_requests_pkey" PRIMARY KEY (id);
alter table public."dmca_agent_settings" add constraint "dmca_agent_settings_id_check" CHECK (id);
alter table public."dmca_agent_settings" add constraint "dmca_agent_settings_pkey" PRIMARY KEY (id);
alter table public."dmca_cases" add constraint "dmca_cases_claimant_address_check" CHECK (((length(TRIM(BOTH FROM claimant_address)) >= 10) AND (length(TRIM(BOTH FROM claimant_address)) <= 1000)));
alter table public."dmca_cases" add constraint "dmca_cases_claimant_email_check" CHECK (((length(TRIM(BOTH FROM claimant_email)) >= 5) AND (length(TRIM(BOTH FROM claimant_email)) <= 320)));
alter table public."dmca_cases" add constraint "dmca_cases_claimant_name_check" CHECK (((length(TRIM(BOTH FROM claimant_name)) >= 2) AND (length(TRIM(BOTH FROM claimant_name)) <= 160)));
alter table public."dmca_cases" add constraint "dmca_cases_claimant_phone_check" CHECK (((length(TRIM(BOTH FROM claimant_phone)) >= 7) AND (length(TRIM(BOTH FROM claimant_phone)) <= 50)));
alter table public."dmca_cases" add constraint "dmca_cases_pkey" PRIMARY KEY (id);
alter table public."dmca_cases" add constraint "dmca_cases_signature_check" CHECK (((length(TRIM(BOTH FROM signature)) >= 2) AND (length(TRIM(BOTH FROM signature)) <= 160)));
alter table public."dmca_cases" add constraint "dmca_cases_status_check" CHECK ((status = ANY (ARRAY['submitted'::text, 'needs_information'::text, 'rejected'::text, 'disabled'::text, 'countered'::text, 'court_hold'::text, 'restored'::text, 'closed'::text])));
alter table public."dmca_cases" add constraint "dmca_cases_target_type_check" CHECK ((target_type = ANY (ARRAY['tv_video'::text, 'profile_media'::text, 'other'::text])));
alter table public."dmca_cases" add constraint "dmca_cases_work_check" CHECK (((length(TRIM(BOTH FROM copyrighted_work_description)) >= 10) AND (length(TRIM(BOTH FROM copyrighted_work_description)) <= 4000)));
alter table public."dmca_counter_notices" add constraint "dmca_counter_address_check" CHECK (((length(TRIM(BOTH FROM address)) >= 10) AND (length(TRIM(BOTH FROM address)) <= 1000)));
alter table public."dmca_counter_notices" add constraint "dmca_counter_email_check" CHECK (((length(TRIM(BOTH FROM email)) >= 5) AND (length(TRIM(BOTH FROM email)) <= 320)));
alter table public."dmca_counter_notices" add constraint "dmca_counter_legal_name_check" CHECK (((length(TRIM(BOTH FROM legal_name)) >= 2) AND (length(TRIM(BOTH FROM legal_name)) <= 160)));
alter table public."dmca_counter_notices" add constraint "dmca_counter_location_check" CHECK (((length(TRIM(BOTH FROM removed_material_location)) >= 8) AND (length(TRIM(BOTH FROM removed_material_location)) <= 2000)));
alter table public."dmca_counter_notices" add constraint "dmca_counter_notices_case_id_key" UNIQUE (case_id);
alter table public."dmca_counter_notices" add constraint "dmca_counter_notices_pkey" PRIMARY KEY (id);
alter table public."dmca_counter_notices" add constraint "dmca_counter_phone_check" CHECK (((length(TRIM(BOTH FROM phone)) >= 7) AND (length(TRIM(BOTH FROM phone)) <= 50)));
alter table public."dmca_counter_notices" add constraint "dmca_counter_signature_check" CHECK (((length(TRIM(BOTH FROM signature)) >= 2) AND (length(TRIM(BOTH FROM signature)) <= 160)));
alter table public."dmca_counter_notices" add constraint "dmca_counter_status_check" CHECK ((status = ANY (ARRAY['submitted'::text, 'forwarded'::text, 'rejected'::text, 'withdrawn'::text, 'completed'::text])));
alter table public."dmca_enforcement_states" add constraint "dmca_enforcement_states_applied_state_check" CHECK ((jsonb_typeof(applied_state) = 'object'::text));
alter table public."dmca_enforcement_states" add constraint "dmca_enforcement_states_check" CHECK ((isfinite(enforced_at) AND ((invalidated_at IS NULL) OR isfinite(invalidated_at))));
alter table public."dmca_enforcement_states" add constraint "dmca_enforcement_states_pkey" PRIMARY KEY (target_type, target_id);
alter table public."dmca_enforcement_states" add constraint "dmca_enforcement_states_previous_state_check" CHECK ((jsonb_typeof(previous_state) = 'object'::text));
alter table public."dmca_enforcement_states" add constraint "dmca_enforcement_states_target_type_check" CHECK ((target_type = ANY (ARRAY['account'::text, 'dancer_profile'::text, 'tv_video'::text])));
alter table public."dmca_strikes" add constraint "dmca_strikes_case_id_key" UNIQUE (case_id);
alter table public."dmca_strikes" add constraint "dmca_strikes_pkey" PRIMARY KEY (id);
alter table public."favorites" add constraint "favorites_pkey" PRIMARY KEY (customer_id, dancer_id);
alter table public."financial_audit_events" add constraint "financial_audit_events_actor_type_check" CHECK ((actor_type = ANY (ARRAY['system'::text, 'admin'::text, 'dancer'::text, 'agent'::text, 'provider'::text])));
alter table public."financial_audit_events" add constraint "financial_audit_events_pkey" PRIMARY KEY (id);
alter table public."financial_audit_events" add constraint "financial_audit_events_target_type_check" CHECK ((target_type = ANY (ARRAY['earning'::text, 'payout'::text, 'payout_account'::text, 'settings'::text, 'webhook'::text])));
alter table public."follows" add constraint "follows_pkey" PRIMARY KEY (customer_id, dancer_id);
alter table public."gallery_media_reference_history" add constraint "gallery_media_reference_history_event_kind_check" CHECK ((event_kind = ANY (ARRAY['baseline'::text, 'referenced'::text, 'released'::text])));
alter table public."gallery_media_reference_history" add constraint "gallery_media_reference_history_pkey" PRIMARY KEY (event_id);
alter table public."gallery_media_reference_history" add constraint "gallery_media_reference_history_source_kind_check" CHECK ((source_kind = ANY (ARRAY['photo'::text, 'avatar'::text])));
alter table public."gallery_media_reference_history" add constraint "gallery_media_reference_history_storage_path_check" CHECK ((storage_path <> ''::text));
alter table public."gallery_storage_retirements" add constraint "gallery_storage_retirements_pkey" PRIMARY KEY (storage_path);
alter table public."gallery_storage_retirements" add constraint "gallery_storage_retirements_retirement_id_key" UNIQUE (retirement_id);
alter table public."gallery_storage_retirements" add constraint "gallery_storage_retirements_storage_path_check" CHECK ((storage_path <> ''::text));
alter table public."going_signals" add constraint "going_signals_exactly_one_visitor" CHECK ((num_nonnulls(customer_id, visitor_token_hash) = 1));
alter table public."going_signals" add constraint "going_signals_pkey" PRIMARY KEY (id);
alter table public."image_moderation_records" add constraint "image_moderation_avatar_intent_check" CHECK ((((avatar_expected_updated_at IS NULL) AND (avatar_expected_path IS NULL)) OR ((avatar_expected_updated_at IS NOT NULL) AND isfinite(avatar_expected_updated_at) AND (upload_context = 'profile_avatar'::text) AND ((avatar_expected_path IS NULL) OR (length(avatar_expected_path) <= 1024)))));
alter table public."image_moderation_records" add constraint "image_moderation_photo_publication_intent_check" CHECK ((((photo_publication_mode = ANY (ARRAY['legacy'::text, 'add'::text])) AND (replacement_photo_id IS NULL)) OR ((photo_publication_mode = 'replace'::text) AND (replacement_photo_id IS NOT NULL))));
alter table public."image_moderation_records" add constraint "image_moderation_records_decision_check" CHECK ((decision = ANY (ARRAY['approved'::text, 'review'::text, 'rejected'::text])));
alter table public."image_moderation_records" add constraint "image_moderation_records_pkey" PRIMARY KEY (id);
alter table public."image_moderation_records" add constraint "image_moderation_records_review_decision_check" CHECK (((review_decision IS NULL) OR (review_decision = ANY (ARRAY['approved'::text, 'rejected'::text]))));
alter table public."image_moderation_records" add constraint "image_moderation_records_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'error'::text, 'moderating'::text, 'approved'::text, 'pending_review'::text, 'rejected'::text, 'moderation_retry'::text, 'moderation_error'::text])));
alter table public."media_likes" add constraint "media_likes_one_target" CHECK ((num_nonnulls(photo_id, video_id) = 1));
alter table public."media_likes" add constraint "media_likes_pkey" PRIMARY KEY (id);
alter table public."media_likes" add constraint "media_likes_private_visitor_hash" CHECK ((visitor_token_hash ~ '^[0-9a-f]{64}$'::text));
alter table public."mydancr_tv_events" add constraint "mydancr_tv_event_session_check" CHECK (((length(session_id) >= 8) AND (length(session_id) <= 120)));
alter table public."mydancr_tv_events" add constraint "mydancr_tv_event_source_check" CHECK ((source = ANY (ARRAY['tv_feed'::text, 'home'::text, 'dancer_profile'::text, 'venue_page'::text, 'shared_link'::text])));
alter table public."mydancr_tv_events" add constraint "mydancr_tv_event_type_check" CHECK ((event_type = ANY (ARRAY['impression'::text, 'engaged_view'::text, 'completed'::text, 'profile_click'::text, 'venue_click'::text, 'shift_click'::text, 'follow'::text, 'going'::text, 'reminder'::text, 'applause'::text, 'share'::text, 'report'::text])));
alter table public."mydancr_tv_events" add constraint "mydancr_tv_events_pkey" PRIMARY KEY (id);
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_caption_check" CHECK (((length(TRIM(BOTH FROM caption)) >= 1) AND (length(TRIM(BOTH FROM caption)) <= 500)));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_dimensions_check" CHECK ((((width >= 240) AND (width <= 4320)) AND ((height >= width) AND (height <= 7680))));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_distribution_scope_check" CHECK ((distribution_scope = ANY (ARRAY['profile_and_feed'::text, 'feed_only'::text])));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_duration_check" CHECK (((duration_seconds >= (1)::numeric) AND (duration_seconds <= (30)::numeric)));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_file_size_check" CHECK (((file_size_bytes >= 1) AND (file_size_bytes <= 78643200)));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_moderation_attempt_count_check" CHECK (((moderation_attempt_count >= 0) AND (moderation_attempt_count <= 10)));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_moderation_decision_check" CHECK (((moderation_decision IS NULL) OR (moderation_decision = ANY (ARRAY['approved'::text, 'review'::text, 'rejected'::text]))));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_moderation_frame_count_check" CHECK (((moderation_frame_count >= 0) AND (moderation_frame_count <= 10)));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_status_check" CHECK ((status = ANY (ARRAY['uploading'::text, 'moderating'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'hidden'::text, 'expired'::text])));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_storage_mime_check" CHECK ((storage_mime = ANY (ARRAY['video/mp4'::text, 'video/webm'::text, 'video/quicktime'::text])));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_venue_tag_status_check" CHECK ((venue_tag_status = ANY (ARRAY['unlinked'::text, 'pending'::text, 'confirmed'::text, 'rejected'::text])));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_videos_like_count_nonnegative" CHECK ((like_count >= 0));
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_videos_pkey" PRIMARY KEY (id);
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_videos_storage_path_key" UNIQUE (storage_path);
alter table public."nats_affiliate_accounts" add constraint "nats_affiliate_accounts_activation_check" CHECK ((((status = 'active'::text) AND (activated_at IS NOT NULL) AND (verified_by IS NOT NULL)) OR (status <> 'active'::text)));
alter table public."nats_affiliate_accounts" add constraint "nats_affiliate_accounts_login_id_check" CHECK ((login_id > 0));
alter table public."nats_affiliate_accounts" add constraint "nats_affiliate_accounts_login_id_key" UNIQUE (login_id);
alter table public."nats_affiliate_accounts" add constraint "nats_affiliate_accounts_pkey" PRIMARY KEY (dancer_id);
alter table public."nats_affiliate_accounts" add constraint "nats_affiliate_accounts_status_check" CHECK ((status = ANY (ARRAY['requested'::text, 'active'::text, 'disabled'::text])));
alter table public."nats_agent_affiliate_accounts" add constraint "nats_agent_affiliate_accounts_activation_check" CHECK ((((status = 'active'::text) AND (activated_at IS NOT NULL) AND (verified_by IS NOT NULL)) OR (status <> 'active'::text)));
alter table public."nats_agent_affiliate_accounts" add constraint "nats_agent_affiliate_accounts_login_id_check" CHECK ((login_id > 0));
alter table public."nats_agent_affiliate_accounts" add constraint "nats_agent_affiliate_accounts_login_id_key" UNIQUE (login_id);
alter table public."nats_agent_affiliate_accounts" add constraint "nats_agent_affiliate_accounts_pkey" PRIMARY KEY (agent_id);
alter table public."nats_agent_affiliate_accounts" add constraint "nats_agent_affiliate_accounts_status_check" CHECK ((status = ANY (ARRAY['requested'::text, 'active'::text, 'disabled'::text])));
alter table public."nats_agent_commission_exports" add constraint "nats_agent_commission_exports_agent_commission_event_id_key" UNIQUE (agent_commission_event_id);
alter table public."nats_agent_commission_exports" add constraint "nats_agent_commission_exports_amount_cents_check" CHECK ((amount_cents > 0));
alter table public."nats_agent_commission_exports" add constraint "nats_agent_commission_exports_attempt_count_check" CHECK ((attempt_count >= 0));
alter table public."nats_agent_commission_exports" add constraint "nats_agent_commission_exports_currency_check" CHECK ((currency = 'usd'::text));
alter table public."nats_agent_commission_exports" add constraint "nats_agent_commission_exports_pkey" PRIMARY KEY (id);
alter table public."nats_agent_commission_exports" add constraint "nats_agent_commission_exports_status_check" CHECK ((status = ANY (ARRAY['waiting_for_affiliate'::text, 'pending'::text, 'processing'::text, 'exported'::text, 'failed'::text, 'reconciliation_required'::text, 'canceled'::text])));
alter table public."nats_commission_exports" add constraint "nats_commission_exports_amount_cents_check" CHECK ((amount_cents > 0));
alter table public."nats_commission_exports" add constraint "nats_commission_exports_attempt_count_check" CHECK ((attempt_count >= 0));
alter table public."nats_commission_exports" add constraint "nats_commission_exports_commission_event_id_key" UNIQUE (commission_event_id);
alter table public."nats_commission_exports" add constraint "nats_commission_exports_currency_check" CHECK ((currency = 'usd'::text));
alter table public."nats_commission_exports" add constraint "nats_commission_exports_pkey" PRIMARY KEY (id);
alter table public."nats_commission_exports" add constraint "nats_commission_exports_status_check" CHECK ((status = ANY (ARRAY['waiting_for_affiliate'::text, 'pending'::text, 'processing'::text, 'exported'::text, 'failed'::text, 'reconciliation_required'::text, 'canceled'::text])));
alter table public."nfc_tags" add constraint "nfc_tags_label_check" CHECK (((char_length(TRIM(BOTH FROM label)) >= 2) AND (char_length(TRIM(BOTH FROM label)) <= 80)));
alter table public."nfc_tags" add constraint "nfc_tags_pkey" PRIMARY KEY (id);
alter table public."nfc_tags" add constraint "nfc_tags_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text, 'revoked'::text])));
alter table public."nfc_tags" add constraint "nfc_tags_tag_type_check" CHECK ((tag_type = ANY (ARRAY['dressing_room'::text, 'cashier'::text])));
alter table public."nfc_tags" add constraint "nfc_tags_tap_count_check" CHECK ((tap_count >= 0));
alter table public."nfc_tags" add constraint "nfc_tags_token_digest_check" CHECK ((token_digest ~ '^[0-9a-f]{64}$'::text));
alter table public."nfc_tags" add constraint "nfc_tags_token_digest_key" UNIQUE (token_digest);
alter table public."nfc_tap_events" add constraint "nfc_tap_events_event_type_check" CHECK ((event_type = ANY (ARRAY['opened'::text, 'affiliation_approved'::text, 'shift_checked_in'::text, 'deal_redeemed'::text, 'rejected'::text])));
alter table public."nfc_tap_events" add constraint "nfc_tap_events_pkey" PRIMARY KEY (id);
alter table public."nfc_tap_events" add constraint "nfc_tap_events_tag_type_check" CHECK ((tag_type = ANY (ARRAY['dressing_room'::text, 'cashier'::text])));
alter table public."notifications" add constraint "notifications_pkey" PRIMARY KEY (id);
alter table public."payment_provider_webhook_events" add constraint "payment_provider_webhook_events_attempt_count_check" CHECK ((attempt_count > 0));
alter table public."payment_provider_webhook_events" add constraint "payment_provider_webhook_events_payment_provider_check" CHECK ((payment_provider = ANY (ARRAY['stripe'::text, 'bitsafe'::text, 'adyen'::text, 'other'::text])));
alter table public."payment_provider_webhook_events" add constraint "payment_provider_webhook_events_pkey" PRIMARY KEY (id);
alter table public."payment_provider_webhook_events" add constraint "payment_provider_webhook_events_processing_status_check" CHECK ((processing_status = ANY (ARRAY['processing'::text, 'processed'::text, 'failed'::text])));
alter table public."payment_provider_webhook_events" add constraint "payment_provider_webhook_events_provider_event_key" UNIQUE (payment_provider, provider_event_id);
alter table public."payout_settings" add constraint "payout_settings_earnings_hold_days_check" CHECK (((earnings_hold_days >= 0) AND (earnings_hold_days <= 90)));
alter table public."payout_settings" add constraint "payout_settings_id_check" CHECK ((id = 'default'::text));
alter table public."payout_settings" add constraint "payout_settings_minimum_payout_cents_check" CHECK (((minimum_payout_cents >= 1) AND (minimum_payout_cents <= 10000000)));
alter table public."payout_settings" add constraint "payout_settings_payment_provider_check" CHECK ((payment_provider = ANY (ARRAY['stripe'::text, 'bitsafe'::text, 'adyen'::text, 'other'::text])));
alter table public."payout_settings" add constraint "payout_settings_payout_mode_check" CHECK ((payout_mode = ANY (ARRAY['manual_cashout'::text, 'scheduled'::text, 'both'::text])));
alter table public."payout_settings" add constraint "payout_settings_pkey" PRIMARY KEY (id);
alter table public."profile_views" add constraint "profile_views_pkey" PRIMARY KEY (id);
alter table public."qr_redemption_events" add constraint "qr_redemption_events_event_type_check" CHECK ((event_type = ANY (ARRAY['issued'::text, 'saved'::text, 'shared'::text, 'scanner_opened'::text, 'venue_confirmed'::text, 'expired'::text, 'voided'::text])));
alter table public."qr_redemption_events" add constraint "qr_redemption_events_pkey" PRIMARY KEY (id);
alter table public."qr_redemptions" add constraint "qr_redemptions_pkey" PRIMARY KEY (id);
alter table public."qr_redemptions" add constraint "qr_redemptions_redemption_token_key" UNIQUE (redemption_token);
alter table public."qr_redemptions" add constraint "qr_redemptions_source_type_check" CHECK ((source_type = ANY (ARRAY['club_page'::text, 'dancer_profile'::text])));
alter table public."qr_redemptions" add constraint "qr_redemptions_status_check" CHECK ((status = ANY (ARRAY['generated'::text, 'redeemed'::text, 'expired'::text, 'voided'::text])));
alter table public."ranking_events" add constraint "ranking_events_pkey" PRIMARY KEY (id);
alter table public."request_rate_limit_buckets" add constraint "request_rate_limit_buckets_pkey" PRIMARY KEY (namespace, key_type, key_hash);
alter table public."request_rate_limit_buckets" add constraint "request_rate_limit_count_check" CHECK ((request_count > 0));
alter table public."request_rate_limit_buckets" add constraint "request_rate_limit_key_type_check" CHECK ((key_type = ANY (ARRAY['ip'::text, 'subject'::text])));
alter table public."request_rate_limit_buckets" add constraint "request_rate_limit_namespace_check" CHECK ((namespace ~ '^[a-z0-9_]{1,40}$'::text));
alter table public."sales_agents" add constraint "sales_agents_check" CHECK (((sponsor_agent_id IS NULL) OR (sponsor_agent_id <> id)));
alter table public."sales_agents" add constraint "sales_agents_commission_depth_limit_check" CHECK ((commission_depth_limit = ANY (ARRAY[3, 5])));
alter table public."sales_agents" add constraint "sales_agents_pkey" PRIMARY KEY (id);
alter table public."sales_agents" add constraint "sales_agents_referral_code_check" CHECK ((referral_code ~ '^[0-9a-f]{36}$'::text));
alter table public."sales_agents" add constraint "sales_agents_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'terminated'::text])));
alter table public."sales_agents" add constraint "sales_agents_user_id_key" UNIQUE (user_id);
alter table public."schedule_views" add constraint "schedule_views_pkey" PRIMARY KEY (id);
alter table public."shift_location_events" add constraint "shift_location_events_accuracy_meters_check" CHECK ((accuracy_meters >= (0)::numeric));
alter table public."shift_location_events" add constraint "shift_location_events_event_type_check" CHECK ((event_type = ANY (ARRAY['check_in'::text, 'refresh'::text])));
alter table public."shift_location_events" add constraint "shift_location_events_latitude_check" CHECK (((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)));
alter table public."shift_location_events" add constraint "shift_location_events_longitude_check" CHECK (((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric)));
alter table public."shift_location_events" add constraint "shift_location_events_pkey" PRIMARY KEY (id);
alter table public."shifts" add constraint "shifts_checkin_accuracy_nonnegative" CHECK (((checkin_accuracy_meters IS NULL) OR (checkin_accuracy_meters >= (0)::numeric)));
alter table public."shifts" add constraint "shifts_checkin_latitude_range" CHECK (((checkin_latitude IS NULL) OR ((checkin_latitude >= ('-90'::integer)::numeric) AND (checkin_latitude <= (90)::numeric))));
alter table public."shifts" add constraint "shifts_checkin_longitude_range" CHECK (((checkin_longitude IS NULL) OR ((checkin_longitude >= ('-180'::integer)::numeric) AND (checkin_longitude <= (180)::numeric))));
alter table public."shifts" add constraint "shifts_checkout_after_checkin" CHECK (((checked_out_at IS NULL) OR (checked_in_at IS NOT NULL)));
alter table public."shifts" add constraint "shifts_checkout_time_order_check" CHECK (((checked_out_at IS NULL) OR (checked_out_at >= checked_in_at)));
alter table public."shifts" add constraint "shifts_demo_locked_no_nfc_or_commission_check" CHECK (((shift_source <> 'demo_locked'::text) OR ((nfc_tag_id IS NULL) AND (nfc_last_tapped_at IS NULL) AND (commission_tracking_started_at IS NULL) AND (commission_tracking_stopped_at IS NULL))));
alter table public."shifts" add constraint "shifts_end_after_start" CHECK ((ends_at > starts_at));
alter table public."shifts" add constraint "shifts_finite_schedule_times_check" CHECK ((isfinite(starts_at) AND isfinite(ends_at) AND isfinite(shift_date) AND ((checked_in_at IS NULL) OR isfinite(checked_in_at)) AND ((checked_out_at IS NULL) OR isfinite(checked_out_at))));
alter table public."shifts" add constraint "shifts_last_location_accuracy_nonnegative" CHECK (((last_location_accuracy_meters IS NULL) OR (last_location_accuracy_meters >= (0)::numeric)));
alter table public."shifts" add constraint "shifts_last_location_latitude_range" CHECK (((last_location_latitude IS NULL) OR ((last_location_latitude >= ('-90'::integer)::numeric) AND (last_location_latitude <= (90)::numeric))));
alter table public."shifts" add constraint "shifts_last_location_longitude_range" CHECK (((last_location_longitude IS NULL) OR ((last_location_longitude >= ('-180'::integer)::numeric) AND (last_location_longitude <= (180)::numeric))));
alter table public."shifts" add constraint "shifts_location_status_check" CHECK ((location_status = ANY (ARRAY['self_reported'::text, 'location_confirmed'::text, 'club_confirmed'::text])));
alter table public."shifts" add constraint "shifts_location_verification_expiry_order" CHECK (((location_verification_expires_at IS NULL) OR (last_location_verified_at IS NULL) OR (location_verification_expires_at >= last_location_verified_at)));
alter table public."shifts" add constraint "shifts_pkey" PRIMARY KEY (id);
alter table public."shifts" add constraint "shifts_shift_source_check" CHECK ((shift_source = ANY (ARRAY['scheduled'::text, 'nfc_presence'::text, 'demo_locked'::text])));
alter table public."shifts" add constraint "shifts_working_status_check" CHECK ((working_status = ANY (ARRAY['self_reported'::text, 'checked_in'::text, 'ended'::text, 'club_confirmed'::text])));
alter table public."social_clicks" add constraint "social_clicks_pkey" PRIMARY KEY (id);
alter table public."social_links" add constraint "social_links_dancer_id_platform_key" UNIQUE (dancer_id, platform);
alter table public."social_links" add constraint "social_links_pkey" PRIMARY KEY (id);
alter table public."subscriptions" add constraint "subscriptions_dancer_id_key" UNIQUE (dancer_id);
alter table public."subscriptions" add constraint "subscriptions_pkey" PRIMARY KEY (id);
alter table public."subscriptions" add constraint "subscriptions_stripe_subscription_id_key" UNIQUE (stripe_subscription_id);
alter table public."support_ai_runs" add constraint "support_ai_runs_pkey" PRIMARY KEY (id);
alter table public."support_messages" add constraint "support_messages_pkey" PRIMARY KEY (id);
alter table public."support_messages" add constraint "support_messages_sender_identity_check" CHECK (((sender_kind <> 'human'::text) OR (sender_id IS NOT NULL)));
alter table public."support_messages" add constraint "support_messages_sender_kind_check" CHECK ((sender_kind = ANY (ARRAY['human'::text, 'ai'::text, 'system'::text])));
alter table public."support_threads" add constraint "support_threads_escalation_priority_check" CHECK (((escalation_priority IS NULL) OR (escalation_priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))));
alter table public."support_threads" add constraint "support_threads_escalation_status_check" CHECK ((escalation_status = ANY (ARRAY['none'::text, 'pending'::text, 'escalated'::text, 'resolved'::text])));
alter table public."support_threads" add constraint "support_threads_pkey" PRIMARY KEY (id);
alter table public."trending_scores" add constraint "trending_scores_pkey" PRIMARY KEY (dancer_id);
alter table public."venue_activity_log" add constraint "venue_activity_log_action_check" CHECK (((char_length(action) >= 2) AND (char_length(action) <= 100)));
alter table public."venue_activity_log" add constraint "venue_activity_log_actor_role_check" CHECK ((actor_role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text, 'admin'::text, 'system'::text])));
alter table public."venue_activity_log" add constraint "venue_activity_log_pkey" PRIMARY KEY (id);
alter table public."venue_activity_log" add constraint "venue_activity_log_summary_check" CHECK (((char_length(summary) >= 2) AND (char_length(summary) <= 300)));
alter table public."venue_claim_codes" add constraint "venue_claim_codes_code_digest_key" UNIQUE (code_digest);
alter table public."venue_claim_codes" add constraint "venue_claim_codes_digest_check" CHECK ((length(code_digest) = 64));
alter table public."venue_claim_codes" add constraint "venue_claim_codes_expiry_check" CHECK ((expires_at > created_at));
alter table public."venue_claim_codes" add constraint "venue_claim_codes_pkey" PRIMARY KEY (id);
alter table public."venue_claim_codes" add constraint "venue_claim_codes_revoked_pair_check" CHECK (((revoked_at IS NOT NULL) OR (revoked_by IS NULL)));
alter table public."venue_claim_codes" add constraint "venue_claim_codes_used_pair_check" CHECK (((used_at IS NOT NULL) OR (used_by IS NULL)));
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_check" CHECK ((((status = ANY (ARRAY['pending'::text, 'under_review'::text])) AND (reviewed_at IS NULL)) OR ((status = ANY (ARRAY['approved'::text, 'rejected'::text, 'withdrawn'::text])) AND (reviewed_at IS NOT NULL))));
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_decision_note_check" CHECK (((decision_note IS NULL) OR (char_length(decision_note) <= 1000)));
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_offer_key_check" CHECK ((offer_key = ANY (ARRAY['half_off_admission'::text, 'skip_the_line'::text, 'free_admission'::text])));
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_offer_title_check" CHECK ((offer_title = ANY (ARRAY['Half-off admission'::text, 'Skip the line'::text, 'Free admission'::text])));
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_pkey" PRIMARY KEY (id);
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_request_notes_check" CHECK (((request_notes IS NULL) OR (char_length(request_notes) <= 1000)));
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_request_type_check" CHECK ((request_type = ANY (ARRAY['add'::text, 'remove'::text])));
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])));
alter table public."venue_dancer_affiliation_events" add constraint "venue_dancer_affiliation_events_pkey" PRIMARY KEY (id);
alter table public."venue_dancer_affiliation_events" add constraint "venue_dancer_affiliation_events_type_check" CHECK ((event_type = ANY (ARRAY['token_issued'::text, 'affiliation_approved'::text, 'affiliation_revoked'::text])));
alter table public."venue_dancer_affiliations" add constraint "venue_dancer_affiliations_pkey" PRIMARY KEY (id);
alter table public."venue_dancer_affiliations" add constraint "venue_dancer_affiliations_reason_check" CHECK (((revoke_reason IS NULL) OR ((length(TRIM(BOTH FROM revoke_reason)) >= 2) AND (length(TRIM(BOTH FROM revoke_reason)) <= 500))));
alter table public."venue_dancer_affiliations" add constraint "venue_dancer_affiliations_revoke_pair_check" CHECK ((((status = 'active'::text) AND (revoked_at IS NULL) AND (revoked_by_user_id IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL))));
alter table public."venue_dancer_affiliations" add constraint "venue_dancer_affiliations_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])));
alter table public."venue_dancer_affiliations" add constraint "venue_dancer_affiliations_unique" UNIQUE (venue_id, dancer_id);
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_digest_check" CHECK ((token_digest ~ '^[0-9a-f]{64}$'::text));
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_expiry_check" CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:15:00'::interval))));
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_ip_check" CHECK ((request_ip_hash ~ '^[0-9a-f]{64}$'::text));
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_pkey" PRIMARY KEY (id);
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_token_digest_key" UNIQUE (token_digest);
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_used_pair_check" CHECK (((used_at IS NOT NULL) OR (used_by_user_id IS NULL)));
alter table public."venue_follows" add constraint "venue_follows_pkey" PRIMARY KEY (customer_id, venue_id);
alter table public."venue_nfc_support_requests" add constraint "venue_nfc_support_requests_notes_check" CHECK (((notes IS NULL) OR (char_length(notes) <= 1000)));
alter table public."venue_nfc_support_requests" add constraint "venue_nfc_support_requests_pkey" PRIMARY KEY (id);
alter table public."venue_nfc_support_requests" add constraint "venue_nfc_support_requests_request_type_check" CHECK ((request_type = ANY (ARRAY['damaged'::text, 'lost'::text, 'relocate'::text, 'replacement'::text])));
alter table public."venue_nfc_support_requests" add constraint "venue_nfc_support_requests_status_check" CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text, 'cancelled'::text])));
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_email_check" CHECK (((length(TRIM(BOTH FROM claimant_email)) >= 5) AND (length(TRIM(BOTH FROM claimant_email)) <= 320)));
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_name_check" CHECK (((length(TRIM(BOTH FROM claimant_name)) >= 2) AND (length(TRIM(BOTH FROM claimant_name)) <= 160)));
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_phone_check" CHECK (((length(TRIM(BOTH FROM claimant_phone)) >= 7) AND (length(TRIM(BOTH FROM claimant_phone)) <= 50)));
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_pkey" PRIMARY KEY (id);
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_proof_mime_check" CHECK ((proof_mime_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'image/webp'::text])));
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_title_check" CHECK (((length(TRIM(BOTH FROM claimant_title)) >= 2) AND (length(TRIM(BOTH FROM claimant_title)) <= 120)));
alter table public."venue_page_events" add constraint "venue_page_events_event_type_check" CHECK ((event_type = ANY (ARRAY['page_view'::text, 'qr_impression'::text])));
alter table public."venue_page_events" add constraint "venue_page_events_pkey" PRIMARY KEY (id);
alter table public."venue_page_events" add constraint "venue_page_events_session_id_check" CHECK (((length(session_id) >= 8) AND (length(session_id) <= 120)));
alter table public."venue_page_events" add constraint "venue_page_events_source_check" CHECK ((source = ANY (ARRAY['venue_page'::text, 'dancer_profile'::text])));
alter table public."venue_page_events" add constraint "venue_page_events_venue_id_event_type_source_session_id_occ_key" UNIQUE (venue_id, event_type, source, session_id, occurred_on);
alter table public."venue_pilot_night_reports" add constraint "venue_pilot_night_reports_notes_check" CHECK (((notes IS NULL) OR (char_length(notes) <= 500)));
alter table public."venue_pilot_night_reports" add constraint "venue_pilot_night_reports_pilot_cost_cents_check" CHECK (((pilot_cost_cents >= 0) AND (pilot_cost_cents <= 100000000)));
alter table public."venue_pilot_night_reports" add constraint "venue_pilot_night_reports_pkey" PRIMARY KEY (id);
alter table public."venue_pilot_night_reports" add constraint "venue_pilot_night_reports_total_door_count_check" CHECK (((total_door_count >= 0) AND (total_door_count <= 1000000)));
alter table public."venue_pilot_night_reports" add constraint "venue_pilot_night_reports_venue_id_service_date_key" UNIQUE (venue_id, service_date);
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_requests_check" CHECK ((((status = 'pending'::text) AND (reviewed_at IS NULL) AND (reviewed_by_admin_user_id IS NULL)) OR ((status <> 'pending'::text) AND (reviewed_at IS NOT NULL))));
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_requests_currency_check" CHECK ((currency ~ '^[a-z]{3}$'::text));
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_requests_decision_note_check" CHECK (((decision_note IS NULL) OR (char_length(decision_note) <= 500)));
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_requests_pkey" PRIMARY KEY (id);
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_requests_reason_check" CHECK (((char_length(TRIM(BOTH FROM reason)) >= 10) AND (char_length(TRIM(BOTH FROM reason)) <= 500)));
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_requests_requested_fee_cents_check" CHECK (((requested_fee_cents >= 100) AND (requested_fee_cents <= 100000)));
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));
alter table public."venue_referral_fee_terms" add constraint "venue_referral_fee_terms_agreement_reference_check" CHECK (((char_length(TRIM(BOTH FROM agreement_reference)) >= 3) AND (char_length(TRIM(BOTH FROM agreement_reference)) <= 160)));
alter table public."venue_referral_fee_terms" add constraint "venue_referral_fee_terms_check" CHECK (((effective_until IS NULL) OR (effective_until > effective_from)));
alter table public."venue_referral_fee_terms" add constraint "venue_referral_fee_terms_currency_check" CHECK ((currency ~ '^[a-z]{3}$'::text));
alter table public."venue_referral_fee_terms" add constraint "venue_referral_fee_terms_decision_note_check" CHECK (((decision_note IS NULL) OR (char_length(decision_note) <= 500)));
alter table public."venue_referral_fee_terms" add constraint "venue_referral_fee_terms_fee_cents_check" CHECK (((fee_cents >= 100) AND (fee_cents <= 100000)));
alter table public."venue_referral_fee_terms" add constraint "venue_referral_fee_terms_pkey" PRIMARY KEY (id);
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_agreement_reference_check" CHECK (((char_length(TRIM(BOTH FROM agreement_reference)) >= 3) AND (char_length(TRIM(BOTH FROM agreement_reference)) <= 180)));
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_check" CHECK (((superseded_at IS NULL) OR (superseded_at > effective_from)));
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_finite_times_check" CHECK ((isfinite(effective_from) AND ((superseded_at IS NULL) OR isfinite(superseded_at))));
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_pkey" PRIMARY KEY (id);
alter table public."venue_signup_requests" add constraint "venue_signup_requests_approval_pair_check" CHECK (((status <> 'approved'::text) OR ((matched_venue_id IS NOT NULL) AND (access_code_id IS NOT NULL))));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_city_check" CHECK (((char_length(TRIM(BOTH FROM city)) >= 2) AND (char_length(TRIM(BOTH FROM city)) <= 120)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_contact_email_check" CHECK (((char_length(TRIM(BOTH FROM contact_email)) >= 5) AND (char_length(TRIM(BOTH FROM contact_email)) <= 320)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_contact_name_check" CHECK (((char_length(TRIM(BOTH FROM contact_name)) >= 2) AND (char_length(TRIM(BOTH FROM contact_name)) <= 160)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_contact_phone_check" CHECK (((char_length(TRIM(BOTH FROM contact_phone)) >= 7) AND (char_length(TRIM(BOTH FROM contact_phone)) <= 40)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_contact_title_check" CHECK (((char_length(TRIM(BOTH FROM contact_title)) >= 2) AND (char_length(TRIM(BOTH FROM contact_title)) <= 120)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_message_check" CHECK (((message IS NULL) OR (char_length(message) <= 1500)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_pkey" PRIMARY KEY (id);
alter table public."venue_signup_requests" add constraint "venue_signup_requests_postal_code_check" CHECK (((char_length(TRIM(BOTH FROM postal_code)) >= 3) AND (char_length(TRIM(BOTH FROM postal_code)) <= 16)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_request_ip_hash_check" CHECK ((char_length(request_ip_hash) = 64));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_review_notes_check" CHECK (((review_notes IS NULL) OR (char_length(review_notes) <= 2000)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_review_pair_check" CHECK ((((status = ANY (ARRAY['awaiting_email_confirmation'::text, 'pending'::text])) AND (reviewed_at IS NULL) AND (reviewed_by IS NULL)) OR ((status = ANY (ARRAY['approved'::text, 'rejected'::text])) AND (reviewed_at IS NOT NULL) AND (reviewed_by IS NOT NULL))));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_state_check" CHECK (((char_length(TRIM(BOTH FROM state)) >= 2) AND (char_length(TRIM(BOTH FROM state)) <= 40)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_status_check" CHECK ((status = ANY (ARRAY['awaiting_email_confirmation'::text, 'pending'::text, 'approved'::text, 'rejected'::text])));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_street_address_check" CHECK (((char_length(TRIM(BOTH FROM street_address)) >= 5) AND (char_length(TRIM(BOTH FROM street_address)) <= 240)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_venue_name_check" CHECK (((char_length(TRIM(BOTH FROM venue_name)) >= 2) AND (char_length(TRIM(BOTH FROM venue_name)) <= 160)));
alter table public."venue_signup_requests" add constraint "venue_signup_requests_website_check" CHECK (((website IS NULL) OR (char_length(website) <= 320)));
alter table public."venue_team_invitations" add constraint "venue_team_invitations_check" CHECK ((expires_at > created_at));
alter table public."venue_team_invitations" add constraint "venue_team_invitations_email_check" CHECK (((char_length(email) >= 3) AND (char_length(email) <= 320)));
alter table public."venue_team_invitations" add constraint "venue_team_invitations_pkey" PRIMARY KEY (id);
alter table public."venue_team_invitations" add constraint "venue_team_invitations_role_check" CHECK ((role = ANY (ARRAY['manager'::text, 'staff'::text])));
alter table public."venue_team_invitations" add constraint "venue_team_invitations_token_digest_key" UNIQUE (token_digest);
alter table public."venue_team_members" add constraint "venue_team_members_pkey" PRIMARY KEY (id);
alter table public."venue_team_members" add constraint "venue_team_members_role_check" CHECK ((role = ANY (ARRAY['manager'::text, 'staff'::text])));
alter table public."venue_team_members" add constraint "venue_team_members_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'removed'::text])));
alter table public."venue_team_members" add constraint "venue_team_members_venue_id_user_id_key" UNIQUE (venue_id, user_id);
alter table public."venues" add constraint "venues_latitude_range" CHECK (((latitude IS NULL) OR ((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric))));
alter table public."venues" add constraint "venues_longitude_range" CHECK (((longitude IS NULL) OR ((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))));
alter table public."venues" add constraint "venues_owner_user_id_key" UNIQUE (owner_user_id);
alter table public."venues" add constraint "venues_page_review_status_check" CHECK ((page_review_status = ANY (ARRAY['admin_draft'::text, 'venue_review'::text, 'changes_requested'::text, 'venue_approved'::text, 'published'::text])));
alter table public."venues" add constraint "venues_pkey" PRIMARY KEY (id);
alter table public."venues" add constraint "venues_slug_key" UNIQUE (slug);
alter table public."account_self_pauses" add constraint "account_self_pauses_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE SET NULL;
alter table public."account_self_pauses" add constraint "account_self_pauses_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."account_self_pauses" add constraint "account_self_pauses_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
alter table public."admin_actions" add constraint "admin_actions_admin_id_fkey" FOREIGN KEY (admin_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."agent_commission_events" add constraint "agent_commission_events_deal_revenue_event_id_fkey" FOREIGN KEY (deal_revenue_event_id) REFERENCES deal_revenue_events(id) ON DELETE RESTRICT;
alter table public."agent_commission_events" add constraint "agent_commission_events_qr_redemption_id_fkey" FOREIGN KEY (qr_redemption_id) REFERENCES qr_redemptions(id) ON DELETE RESTRICT;
alter table public."agent_commission_events" add constraint "agent_commission_events_recipient_agent_id_fkey" FOREIGN KEY (recipient_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."agent_commission_events" add constraint "agent_commission_events_signing_agent_id_fkey" FOREIGN KEY (signing_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."agent_commission_events" add constraint "agent_commission_events_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE RESTRICT;
alter table public."agent_commission_events" add constraint "agent_commission_events_venue_sales_attribution_id_fkey" FOREIGN KEY (venue_sales_attribution_id) REFERENCES venue_sales_attributions(id) ON DELETE RESTRICT;
alter table public."app_users" add constraint "app_users_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."approval_reviews" add constraint "approval_reviews_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."approval_reviews" add constraint "approval_reviews_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."club_deals" add constraint "club_deals_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."club_finance_accounts" add constraint "club_finance_accounts_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."club_invoice_items" add constraint "club_invoice_items_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES club_invoices(id) ON DELETE CASCADE;
alter table public."club_invoice_items" add constraint "club_invoice_items_revenue_event_id_fkey" FOREIGN KEY (revenue_event_id) REFERENCES deal_revenue_events(id) ON DELETE RESTRICT;
alter table public."club_invoice_reminders" add constraint "club_invoice_reminders_invoice_id_fkey" FOREIGN KEY (invoice_id) REFERENCES club_invoices(id) ON DELETE CASCADE;
alter table public."club_invoices" add constraint "club_invoices_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."commission_events" add constraint "commission_events_club_deal_id_fkey" FOREIGN KEY (club_deal_id) REFERENCES club_deals(id) ON DELETE CASCADE;
alter table public."commission_events" add constraint "commission_events_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."commission_events" add constraint "commission_events_payout_batch_id_fkey" FOREIGN KEY (payout_batch_id) REFERENCES dancer_payout_batches(id) ON DELETE SET NULL;
alter table public."commission_events" add constraint "commission_events_qr_redemption_id_fkey" FOREIGN KEY (qr_redemption_id) REFERENCES qr_redemptions(id) ON DELETE CASCADE;
alter table public."commission_events" add constraint "commission_events_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."content_reports" add constraint "content_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."content_reports" add constraint "content_reports_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."customer_deal_saves" add constraint "customer_deal_saves_club_deal_id_fkey" FOREIGN KEY (club_deal_id) REFERENCES club_deals(id) ON DELETE CASCADE;
alter table public."customer_deal_saves" add constraint "customer_deal_saves_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."customer_deal_saves" add constraint "customer_deal_saves_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE SET NULL;
alter table public."customer_profiles" add constraint "customer_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."dancer_earning_status_history" add constraint "dancer_earning_status_history_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."dancer_earning_status_history" add constraint "dancer_earning_status_history_earning_id_fkey" FOREIGN KEY (earning_id) REFERENCES commission_events(id) ON DELETE RESTRICT;
alter table public."dancer_nfc_enrollments" add constraint "dancer_nfc_enrollments_dancer_user_id_fkey" FOREIGN KEY (dancer_user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."dancer_nfc_enrollments" add constraint "dancer_nfc_enrollments_nfc_tag_id_fkey" FOREIGN KEY (nfc_tag_id) REFERENCES nfc_tags(id) ON DELETE RESTRICT;
alter table public."dancer_nfc_enrollments" add constraint "dancer_nfc_enrollments_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."dancer_payout_accounts" add constraint "dancer_payout_accounts_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."dancer_payout_batches" add constraint "dancer_payout_batches_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."dancer_payout_items" add constraint "dancer_payout_items_commission_event_id_fkey" FOREIGN KEY (commission_event_id) REFERENCES commission_events(id) ON DELETE RESTRICT;
alter table public."dancer_payout_items" add constraint "dancer_payout_items_payout_batch_id_fkey" FOREIGN KEY (payout_batch_id) REFERENCES dancer_payout_batches(id) ON DELETE CASCADE;
alter table public."dancer_photos" add constraint "dancer_photos_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."dancer_profile_slug_aliases" add constraint "dancer_profile_slug_aliases_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."dancer_profiles" add constraint "dancer_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."dancer_profiles" add constraint "dancer_profiles_venue_approved_by_user_id_fkey" FOREIGN KEY (venue_approved_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."dancer_profiles" add constraint "dancer_profiles_venue_approved_venue_id_fkey" FOREIGN KEY (venue_approved_venue_id) REFERENCES venues(id) ON DELETE SET NULL;
alter table public."deal_revenue_events" add constraint "deal_revenue_events_club_deal_id_fkey" FOREIGN KEY (club_deal_id) REFERENCES club_deals(id) ON DELETE CASCADE;
alter table public."deal_revenue_events" add constraint "deal_revenue_events_club_invoice_id_fkey" FOREIGN KEY (club_invoice_id) REFERENCES club_invoices(id) ON DELETE SET NULL;
alter table public."deal_revenue_events" add constraint "deal_revenue_events_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE SET NULL;
alter table public."deal_revenue_events" add constraint "deal_revenue_events_qr_redemption_id_fkey" FOREIGN KEY (qr_redemption_id) REFERENCES qr_redemptions(id) ON DELETE CASCADE;
alter table public."deal_revenue_events" add constraint "deal_revenue_events_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."deal_revenue_events" add constraint "deal_revenue_events_venue_sales_attribution_id_fkey" FOREIGN KEY (venue_sales_attribution_id) REFERENCES venue_sales_attributions(id) ON DELETE SET NULL;
alter table public."direction_requests" add constraint "direction_requests_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE SET NULL;
alter table public."direction_requests" add constraint "direction_requests_requester_id_fkey" FOREIGN KEY (requester_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."direction_requests" add constraint "direction_requests_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."dmca_agent_settings" add constraint "dmca_agent_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."dmca_cases" add constraint "dmca_cases_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."dmca_cases" add constraint "dmca_cases_uploader_id_fkey" FOREIGN KEY (uploader_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."dmca_counter_notices" add constraint "dmca_counter_notices_case_id_fkey" FOREIGN KEY (case_id) REFERENCES dmca_cases(id) ON DELETE CASCADE;
alter table public."dmca_counter_notices" add constraint "dmca_counter_notices_uploader_id_fkey" FOREIGN KEY (uploader_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."dmca_enforcement_states" add constraint "dmca_enforcement_states_uploader_id_fkey" FOREIGN KEY (uploader_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."dmca_strikes" add constraint "dmca_strikes_case_id_fkey" FOREIGN KEY (case_id) REFERENCES dmca_cases(id) ON DELETE CASCADE;
alter table public."dmca_strikes" add constraint "dmca_strikes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."favorites" add constraint "favorites_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."favorites" add constraint "favorites_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."financial_audit_events" add constraint "financial_audit_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."follows" add constraint "follows_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."follows" add constraint "follows_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."going_signals" add constraint "going_signals_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."going_signals" add constraint "going_signals_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
alter table public."image_moderation_records" add constraint "image_moderation_records_image_id_fkey" FOREIGN KEY (image_id) REFERENCES dancer_photos(id) ON DELETE SET NULL;
alter table public."image_moderation_records" add constraint "image_moderation_records_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."image_moderation_records" add constraint "image_moderation_records_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."media_likes" add constraint "media_likes_photo_id_fkey" FOREIGN KEY (photo_id) REFERENCES dancer_photos(id) ON DELETE CASCADE;
alter table public."media_likes" add constraint "media_likes_video_id_fkey" FOREIGN KEY (video_id) REFERENCES mydancr_tv_videos(id) ON DELETE CASCADE;
alter table public."mydancr_tv_events" add constraint "mydancr_tv_events_video_id_fkey" FOREIGN KEY (video_id) REFERENCES mydancr_tv_videos(id) ON DELETE CASCADE;
alter table public."mydancr_tv_events" add constraint "mydancr_tv_events_viewer_id_fkey" FOREIGN KEY (viewer_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_videos_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_videos_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_videos_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_videos_submitted_by_fkey" FOREIGN KEY (submitted_by) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."mydancr_tv_videos" add constraint "mydancr_tv_videos_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
alter table public."nats_affiliate_accounts" add constraint "nats_affiliate_accounts_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE RESTRICT;
alter table public."nats_affiliate_accounts" add constraint "nats_affiliate_accounts_verified_by_fkey" FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."nats_agent_affiliate_accounts" add constraint "nats_agent_affiliate_accounts_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."nats_agent_affiliate_accounts" add constraint "nats_agent_affiliate_accounts_verified_by_fkey" FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."nats_agent_commission_exports" add constraint "nats_agent_commission_exports_agent_commission_event_id_fkey" FOREIGN KEY (agent_commission_event_id) REFERENCES agent_commission_events(id) ON DELETE RESTRICT;
alter table public."nats_agent_commission_exports" add constraint "nats_agent_commission_exports_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."nats_commission_exports" add constraint "nats_commission_exports_commission_event_id_fkey" FOREIGN KEY (commission_event_id) REFERENCES commission_events(id) ON DELETE RESTRICT;
alter table public."nats_commission_exports" add constraint "nats_commission_exports_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE RESTRICT;
alter table public."nfc_tags" add constraint "nfc_tags_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."nfc_tags" add constraint "nfc_tags_rotated_from_tag_id_fkey" FOREIGN KEY (rotated_from_tag_id) REFERENCES nfc_tags(id) ON DELETE SET NULL;
alter table public."nfc_tags" add constraint "nfc_tags_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."nfc_tap_events" add constraint "nfc_tap_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."nfc_tap_events" add constraint "nfc_tap_events_nfc_tag_id_fkey" FOREIGN KEY (nfc_tag_id) REFERENCES nfc_tags(id) ON DELETE RESTRICT;
alter table public."nfc_tap_events" add constraint "nfc_tap_events_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."notifications" add constraint "notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."payout_settings" add constraint "payout_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."profile_views" add constraint "profile_views_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."profile_views" add constraint "profile_views_viewer_id_fkey" FOREIGN KEY (viewer_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."qr_redemption_events" add constraint "qr_redemption_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."qr_redemption_events" add constraint "qr_redemption_events_qr_redemption_id_fkey" FOREIGN KEY (qr_redemption_id) REFERENCES qr_redemptions(id) ON DELETE CASCADE;
alter table public."qr_redemptions" add constraint "qr_redemptions_club_deal_id_fkey" FOREIGN KEY (club_deal_id) REFERENCES club_deals(id) ON DELETE CASCADE;
alter table public."qr_redemptions" add constraint "qr_redemptions_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."qr_redemptions" add constraint "qr_redemptions_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE SET NULL;
alter table public."qr_redemptions" add constraint "qr_redemptions_nfc_tag_id_fkey" FOREIGN KEY (nfc_tag_id) REFERENCES nfc_tags(id) ON DELETE SET NULL;
alter table public."qr_redemptions" add constraint "qr_redemptions_redeemed_by_club_user_fkey" FOREIGN KEY (redeemed_by_club_user) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."qr_redemptions" add constraint "qr_redemptions_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
alter table public."qr_redemptions" add constraint "qr_redemptions_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."qr_redemptions" add constraint "qr_redemptions_voided_by_admin_fkey" FOREIGN KEY (voided_by_admin) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."ranking_events" add constraint "ranking_events_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."sales_agents" add constraint "sales_agents_created_by_admin_user_id_fkey" FOREIGN KEY (created_by_admin_user_id) REFERENCES app_users(id) ON DELETE RESTRICT;
alter table public."sales_agents" add constraint "sales_agents_sponsor_agent_id_fkey" FOREIGN KEY (sponsor_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."sales_agents" add constraint "sales_agents_updated_by_admin_user_id_fkey" FOREIGN KEY (updated_by_admin_user_id) REFERENCES app_users(id) ON DELETE RESTRICT;
alter table public."sales_agents" add constraint "sales_agents_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE RESTRICT;
alter table public."schedule_views" add constraint "schedule_views_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."schedule_views" add constraint "schedule_views_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
alter table public."schedule_views" add constraint "schedule_views_viewer_id_fkey" FOREIGN KEY (viewer_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."shift_location_events" add constraint "shift_location_events_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."shift_location_events" add constraint "shift_location_events_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
alter table public."shift_location_events" add constraint "shift_location_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."shifts" add constraint "shifts_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."shifts" add constraint "shifts_nfc_tag_id_fkey" FOREIGN KEY (nfc_tag_id) REFERENCES nfc_tags(id) ON DELETE SET NULL;
alter table public."shifts" add constraint "shifts_venue_affiliation_id_fkey" FOREIGN KEY (venue_affiliation_id) REFERENCES venue_dancer_affiliations(id) ON DELETE SET NULL;
alter table public."shifts" add constraint "shifts_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE RESTRICT;
alter table public."social_clicks" add constraint "social_clicks_clicker_id_fkey" FOREIGN KEY (clicker_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."social_clicks" add constraint "social_clicks_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."social_links" add constraint "social_links_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."subscriptions" add constraint "subscriptions_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."support_ai_runs" add constraint "support_ai_runs_response_message_id_fkey" FOREIGN KEY (response_message_id) REFERENCES support_messages(id) ON DELETE SET NULL;
alter table public."support_ai_runs" add constraint "support_ai_runs_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES support_threads(id) ON DELETE CASCADE;
alter table public."support_ai_runs" add constraint "support_ai_runs_trigger_message_id_fkey" FOREIGN KEY (trigger_message_id) REFERENCES support_messages(id) ON DELETE SET NULL;
alter table public."support_messages" add constraint "support_messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."support_messages" add constraint "support_messages_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES support_threads(id) ON DELETE CASCADE;
alter table public."support_threads" add constraint "support_threads_assigned_admin_id_fkey" FOREIGN KEY (assigned_admin_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."support_threads" add constraint "support_threads_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."trending_scores" add constraint "trending_scores_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."venue_activity_log" add constraint "venue_activity_log_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_activity_log" add constraint "venue_activity_log_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_claim_codes" add constraint "venue_claim_codes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_claim_codes" add constraint "venue_claim_codes_revoked_by_fkey" FOREIGN KEY (revoked_by) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_claim_codes" add constraint "venue_claim_codes_used_by_fkey" FOREIGN KEY (used_by) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_claim_codes" add constraint "venue_claim_codes_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_linked_deal_id_fkey" FOREIGN KEY (linked_deal_id) REFERENCES club_deals(id) ON DELETE SET NULL;
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_requested_by_user_id_fkey" FOREIGN KEY (requested_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_reviewed_by_admin_user_id_fkey" FOREIGN KEY (reviewed_by_admin_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_target_deal_id_fkey" FOREIGN KEY (target_deal_id) REFERENCES club_deals(id) ON DELETE SET NULL;
alter table public."venue_club_deal_requests" add constraint "venue_club_deal_requests_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_dancer_affiliation_events" add constraint "venue_dancer_affiliation_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_dancer_affiliation_events" add constraint "venue_dancer_affiliation_events_affiliation_id_fkey" FOREIGN KEY (affiliation_id) REFERENCES venue_dancer_affiliations(id) ON DELETE SET NULL;
alter table public."venue_dancer_affiliation_events" add constraint "venue_dancer_affiliation_events_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."venue_dancer_affiliation_events" add constraint "venue_dancer_affiliation_events_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_dancer_affiliations" add constraint "venue_dancer_affiliations_approved_by_user_id_fkey" FOREIGN KEY (approved_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_dancer_affiliations" add constraint "venue_dancer_affiliations_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."venue_dancer_affiliations" add constraint "venue_dancer_affiliations_revoked_by_user_id_fkey" FOREIGN KEY (revoked_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_dancer_affiliations" add constraint "venue_dancer_affiliations_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE CASCADE;
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_used_by_user_id_fkey" FOREIGN KEY (used_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_dancer_verification_tokens" add constraint "venue_dancer_verification_tokens_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_follows" add constraint "venue_follows_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."venue_follows" add constraint "venue_follows_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_nfc_support_requests" add constraint "venue_nfc_support_requests_nfc_tag_id_fkey" FOREIGN KEY (nfc_tag_id) REFERENCES nfc_tags(id) ON DELETE SET NULL;
alter table public."venue_nfc_support_requests" add constraint "venue_nfc_support_requests_requested_by_user_id_fkey" FOREIGN KEY (requested_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_nfc_support_requests" add constraint "venue_nfc_support_requests_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_claim_code_id_fkey" FOREIGN KEY (claim_code_id) REFERENCES venue_claim_codes(id) ON DELETE RESTRICT;
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_claimant_user_id_fkey" FOREIGN KEY (claimant_user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_ownership_claims" add constraint "venue_ownership_claims_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_page_events" add constraint "venue_page_events_dancer_id_fkey" FOREIGN KEY (dancer_id) REFERENCES dancer_profiles(id) ON DELETE SET NULL;
alter table public."venue_page_events" add constraint "venue_page_events_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_page_events" add constraint "venue_page_events_viewer_id_fkey" FOREIGN KEY (viewer_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_pilot_night_reports" add constraint "venue_pilot_night_reports_reported_by_user_id_fkey" FOREIGN KEY (reported_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_pilot_night_reports" add constraint "venue_pilot_night_reports_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_reques_reviewed_by_admin_user_id_fkey" FOREIGN KEY (reviewed_by_admin_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_requests_requested_by_user_id_fkey" FOREIGN KEY (requested_by_user_id) REFERENCES app_users(id) ON DELETE RESTRICT;
alter table public."venue_referral_fee_change_requests" add constraint "venue_referral_fee_change_requests_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_referral_fee_terms" add constraint "venue_referral_fee_terms_created_by_admin_user_id_fkey" FOREIGN KEY (created_by_admin_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_referral_fee_terms" add constraint "venue_referral_fee_terms_superseded_by_admin_user_id_fkey" FOREIGN KEY (superseded_by_admin_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_referral_fee_terms" add constraint "venue_referral_fee_terms_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_created_by_admin_user_id_fkey" FOREIGN KEY (created_by_admin_user_id) REFERENCES app_users(id) ON DELETE RESTRICT;
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_signing_agent_id_fkey" FOREIGN KEY (signing_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_sponsor_level_1_agent_id_fkey" FOREIGN KEY (sponsor_level_1_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_sponsor_level_2_agent_id_fkey" FOREIGN KEY (sponsor_level_2_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_sponsor_level_3_agent_id_fkey" FOREIGN KEY (sponsor_level_3_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_sponsor_level_4_agent_id_fkey" FOREIGN KEY (sponsor_level_4_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_sponsor_level_5_agent_id_fkey" FOREIGN KEY (sponsor_level_5_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."venue_sales_attributions" add constraint "venue_sales_attributions_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE RESTRICT;
alter table public."venue_signup_requests" add constraint "venue_signup_requests_access_code_id_fkey" FOREIGN KEY (access_code_id) REFERENCES venue_claim_codes(id) ON DELETE SET NULL;
alter table public."venue_signup_requests" add constraint "venue_signup_requests_matched_venue_id_fkey" FOREIGN KEY (matched_venue_id) REFERENCES venues(id) ON DELETE SET NULL;
alter table public."venue_signup_requests" add constraint "venue_signup_requests_referring_agent_id_fkey" FOREIGN KEY (referring_agent_id) REFERENCES sales_agents(id) ON DELETE RESTRICT;
alter table public."venue_signup_requests" add constraint "venue_signup_requests_requester_user_id_fkey" FOREIGN KEY (requester_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_signup_requests" add constraint "venue_signup_requests_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_team_invitations" add constraint "venue_team_invitations_accepted_by_user_id_fkey" FOREIGN KEY (accepted_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_team_invitations" add constraint "venue_team_invitations_invited_by_user_id_fkey" FOREIGN KEY (invited_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_team_invitations" add constraint "venue_team_invitations_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venue_team_members" add constraint "venue_team_members_invited_by_user_id_fkey" FOREIGN KEY (invited_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venue_team_members" add constraint "venue_team_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
alter table public."venue_team_members" add constraint "venue_team_members_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
alter table public."venues" add constraint "venues_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
alter table public."venues" add constraint "venues_page_reviewed_by_user_id_fkey" FOREIGN KEY (page_reviewed_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
CREATE INDEX account_recovery_events_ip_window_idx ON public.account_recovery_events USING btree (event_type, request_ip_hash, created_at DESC);
CREATE INDEX account_recovery_events_subject_window_idx ON public.account_recovery_events USING btree (event_type, subject_hash, created_at DESC);
CREATE INDEX account_self_pauses_dancer_idx ON public.account_self_pauses USING btree (dancer_id) WHERE (dancer_id IS NOT NULL);
CREATE INDEX account_self_pauses_venue_idx ON public.account_self_pauses USING btree (venue_id) WHERE (venue_id IS NOT NULL);
CREATE INDEX agent_commission_events_recipient_status_idx ON public.agent_commission_events USING btree (recipient_agent_id, status, created_at DESC);
CREATE INDEX agent_commission_events_venue_idx ON public.agent_commission_events USING btree (venue_id, created_at DESC);
CREATE UNIQUE INDEX approval_reviews_one_pending_content_idx ON public.approval_reviews USING btree (dancer_id, review_type) WHERE ((status = 'pending'::review_status) AND ((review_type ~~ 'photo:%'::text) OR (review_type ~~ 'social_link:%'::text)));
CREATE INDEX club_deals_active_venue_listing_idx ON public.club_deals USING btree (venue_id) WHERE (is_active AND (payout_type = 'flat'::text) AND (payout_amount_cents > 0));
CREATE INDEX club_deals_public_offer_order_idx ON public.club_deals USING btree (venue_id, is_active, sort_order, created_at DESC);
CREATE INDEX club_deals_venue_active_idx ON public.club_deals USING btree (venue_id, is_active);
CREATE INDEX club_invoices_status_due_idx ON public.club_invoices USING btree (status, due_at);
CREATE INDEX club_invoices_venue_status_due_idx ON public.club_invoices USING btree (venue_id, status, due_at DESC);
CREATE INDEX commission_events_dancer_status_available_idx ON public.commission_events USING btree (dancer_id, status, available_at DESC, created_at DESC);
CREATE INDEX commission_events_dancer_status_idx ON public.commission_events USING btree (dancer_id, status);
CREATE INDEX commission_events_payout_batch_idx ON public.commission_events USING btree (payout_batch_id, status);
CREATE INDEX commission_events_pending_release_idx ON public.commission_events USING btree (pending_until) WHERE ((status = 'pending'::text) AND (held_at IS NULL) AND (review_flag IS NULL));
CREATE INDEX commission_events_venue_created_idx ON public.commission_events USING btree (venue_id, created_at DESC);
CREATE INDEX commission_events_venue_status_idx ON public.commission_events USING btree (venue_id, status);
CREATE INDEX content_reports_status_created_idx ON public.content_reports USING btree (status, created_at DESC);
CREATE INDEX content_reports_target_idx ON public.content_reports USING btree (target_type, target_id);
CREATE INDEX customer_deal_saves_deal_idx ON public.customer_deal_saves USING btree (club_deal_id, created_at DESC);
CREATE INDEX dancer_earning_history_earning_idx ON public.dancer_earning_status_history USING btree (earning_id, created_at DESC);
CREATE INDEX dancer_nfc_enrollments_pending_idx ON public.dancer_nfc_enrollments USING btree (dancer_user_id, expires_at DESC) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX dancer_payout_accounts_provider_account_uidx ON public.dancer_payout_accounts USING btree (payment_provider, provider_account_id) WHERE (provider_account_id IS NOT NULL);
CREATE INDEX dancer_payout_batches_dancer_status_idx ON public.dancer_payout_batches USING btree (dancer_id, status, created_at DESC);
CREATE UNIQUE INDEX dancer_payout_batches_one_active_uidx ON public.dancer_payout_batches USING btree (dancer_id, currency) WHERE (status = ANY (ARRAY['requested'::text, 'processing'::text]));
CREATE UNIQUE INDEX dancer_payout_batches_request_key_uidx ON public.dancer_payout_batches USING btree (request_key) WHERE (request_key IS NOT NULL);
CREATE INDEX dancer_payout_items_commission_idx ON public.dancer_payout_items USING btree (commission_event_id);
CREATE UNIQUE INDEX dancer_photos_one_active_gallery_position_idx ON public.dancer_photos USING btree (dancer_id, sort_order) WHERE ((NOT is_primary) AND (sort_order > 0) AND (review_status = ANY (ARRAY['approved'::review_status, 'pending'::review_status])));
CREATE UNIQUE INDEX dancer_photos_one_active_primary_idx ON public.dancer_photos USING btree (dancer_id) WHERE (is_primary AND (review_status = ANY (ARRAY['approved'::review_status, 'pending'::review_status])));
CREATE INDEX dancer_profile_slug_aliases_dancer_idx ON public.dancer_profile_slug_aliases USING btree (dancer_id);
CREATE INDEX dancer_profiles_public_discovery_idx ON public.dancer_profiles USING btree (city, stage_name) WHERE ((status = 'approved'::dancer_status) AND (verification_status = 'approved'::review_status) AND (venue_approved_at IS NOT NULL) AND (is_public = true) AND (disabled_at IS NULL));
CREATE INDEX dancer_profiles_status_city_idx ON public.dancer_profiles USING btree (status, city);
CREATE INDEX deal_revenue_events_dancer_month_idx ON public.deal_revenue_events USING btree (dancer_id, commission_month, confirmed_at) WHERE (dancer_id IS NOT NULL);
CREATE UNIQUE INDEX deal_revenue_events_dancer_success_number_idx ON public.deal_revenue_events USING btree (dancer_id, commission_month, successful_redemption_number) WHERE ((dancer_id IS NOT NULL) AND (status <> ALL (ARRAY['refunded'::text, 'voided'::text])));
CREATE INDEX deal_revenue_events_invoice_idx ON public.deal_revenue_events USING btree (club_invoice_id, status);
CREATE INDEX deal_revenue_events_venue_status_idx ON public.deal_revenue_events USING btree (venue_id, status, confirmed_at DESC);
CREATE INDEX direction_requests_dancer_requested_idx ON public.direction_requests USING btree (dancer_id, requested_at DESC);
CREATE INDEX direction_requests_venue_requested_idx ON public.direction_requests USING btree (venue_id, requested_at DESC);
CREATE INDEX dmca_cases_rate_limit_idx ON public.dmca_cases USING btree (request_ip_hash, created_at DESC);
CREATE INDEX dmca_cases_restore_idx ON public.dmca_cases USING btree (restore_eligible_at) WHERE ((status = 'countered'::text) AND (court_filing_received = false));
CREATE INDEX dmca_cases_status_created_idx ON public.dmca_cases USING btree (status, created_at);
CREATE INDEX dmca_cases_uploader_created_idx ON public.dmca_cases USING btree (uploader_id, created_at DESC);
CREATE INDEX dmca_enforcement_states_uploader_idx ON public.dmca_enforcement_states USING btree (uploader_id);
CREATE INDEX dmca_strikes_user_active_idx ON public.dmca_strikes USING btree (user_id, active, issued_at DESC);
CREATE INDEX favorites_dancer_created_idx ON public.favorites USING btree (dancer_id, created_at);
CREATE INDEX financial_audit_target_idx ON public.financial_audit_events USING btree (target_type, target_id, created_at DESC);
CREATE INDEX follows_dancer_idx ON public.follows USING btree (dancer_id);
CREATE INDEX gallery_media_reference_history_profile_event_idx ON public.gallery_media_reference_history USING btree (profile_id, event_id);
CREATE UNIQUE INDEX going_signals_customer_shift_unique ON public.going_signals USING btree (customer_id, shift_id) WHERE (customer_id IS NOT NULL);
CREATE INDEX going_signals_shift_created_idx ON public.going_signals USING btree (shift_id, created_at DESC);
CREATE UNIQUE INDEX going_signals_visitor_shift_unique ON public.going_signals USING btree (visitor_token_hash, shift_id) WHERE (visitor_token_hash IS NOT NULL);
CREATE INDEX image_moderation_records_created_at_idx ON public.image_moderation_records USING btree (created_at DESC);
CREATE INDEX image_moderation_records_decision_idx ON public.image_moderation_records USING btree (decision);
CREATE INDEX image_moderation_records_retry_due_idx ON public.image_moderation_records USING btree (status, next_attempt_at) WHERE (status = ANY (ARRAY['moderation_retry'::text, 'moderating'::text]));
CREATE INDEX image_moderation_records_reviewed_at_idx ON public.image_moderation_records USING btree (reviewed_at DESC);
CREATE INDEX image_moderation_records_status_idx ON public.image_moderation_records USING btree (status);
CREATE INDEX image_moderation_records_user_id_idx ON public.image_moderation_records USING btree (user_id);
CREATE UNIQUE INDEX image_moderation_records_user_idempotency_idx ON public.image_moderation_records USING btree (user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX media_likes_photo_count_idx ON public.media_likes USING btree (photo_id) WHERE (photo_id IS NOT NULL);
CREATE INDEX media_likes_video_count_idx ON public.media_likes USING btree (video_id) WHERE (video_id IS NOT NULL);
CREATE UNIQUE INDEX media_likes_visitor_photo_unique ON public.media_likes USING btree (visitor_token_hash, photo_id) WHERE (photo_id IS NOT NULL);
CREATE UNIQUE INDEX media_likes_visitor_video_unique ON public.media_likes USING btree (visitor_token_hash, video_id) WHERE (video_id IS NOT NULL);
CREATE INDEX mydancr_tv_dancer_created_idx ON public.mydancr_tv_videos USING btree (dancer_id, created_at DESC);
CREATE UNIQUE INDEX mydancr_tv_events_daily_unique_idx ON public.mydancr_tv_events USING btree (video_id, event_type, session_id, occurred_on);
CREATE INDEX mydancr_tv_events_video_occurred_idx ON public.mydancr_tv_events USING btree (video_id, occurred_at DESC);
CREATE INDEX mydancr_tv_profile_distribution_idx ON public.mydancr_tv_videos USING btree (dancer_id, created_at DESC) WHERE (distribution_scope = 'profile_and_feed'::text);
CREATE INDEX mydancr_tv_public_feed_idx ON public.mydancr_tv_videos USING btree (status, published_at DESC) WHERE (status = 'approved'::text);
CREATE INDEX mydancr_tv_review_queue_idx ON public.mydancr_tv_videos USING btree (status, submitted_at) WHERE (status = 'submitted'::text);
CREATE INDEX mydancr_tv_stale_moderation_idx ON public.mydancr_tv_videos USING btree (moderation_started_at) WHERE (status = 'moderating'::text);
CREATE INDEX mydancr_tv_venue_published_idx ON public.mydancr_tv_videos USING btree (venue_id, published_at DESC) WHERE ((status = 'approved'::text) AND (venue_tag_status = 'confirmed'::text));
CREATE INDEX nats_agent_commission_exports_agent_created_idx ON public.nats_agent_commission_exports USING btree (agent_id, created_at DESC);
CREATE INDEX nats_agent_commission_exports_status_created_idx ON public.nats_agent_commission_exports USING btree (status, created_at);
CREATE INDEX nats_commission_exports_dancer_created_idx ON public.nats_commission_exports USING btree (dancer_id, created_at DESC);
CREATE INDEX nats_commission_exports_status_created_idx ON public.nats_commission_exports USING btree (status, created_at);
CREATE UNIQUE INDEX nfc_tags_one_active_cashier_label_idx ON public.nfc_tags USING btree (venue_id, lower(label)) WHERE ((tag_type = 'cashier'::text) AND (status = 'active'::text));
CREATE UNIQUE INDEX nfc_tags_one_active_dressing_room_label_idx ON public.nfc_tags USING btree (venue_id, lower(label)) WHERE ((tag_type = 'dressing_room'::text) AND (status = 'active'::text));
CREATE INDEX nfc_tags_venue_status_idx ON public.nfc_tags USING btree (venue_id, status, tag_type, created_at DESC);
CREATE INDEX nfc_tap_events_tag_time_idx ON public.nfc_tap_events USING btree (nfc_tag_id, occurred_at DESC);
CREATE INDEX nfc_tap_events_venue_type_time_idx ON public.nfc_tap_events USING btree (venue_id, event_type, occurred_at DESC);
CREATE INDEX notifications_dancer_opened_created_idx ON public.notifications USING btree (((payload ->> 'dancerId'::text)), created_at) WHERE (read_at IS NOT NULL);
CREATE INDEX notifications_recipient_created_idx ON public.notifications USING btree (recipient_id, created_at DESC);
CREATE INDEX profile_views_dancer_viewed_idx ON public.profile_views USING btree (dancer_id, viewed_at DESC);
CREATE INDEX provider_webhooks_status_idx ON public.payment_provider_webhook_events USING btree (payment_provider, processing_status, received_at);
CREATE INDEX qr_redemption_events_redemption_time_idx ON public.qr_redemption_events USING btree (qr_redemption_id, occurred_at DESC);
CREATE INDEX qr_redemption_events_type_time_idx ON public.qr_redemption_events USING btree (event_type, occurred_at DESC);
CREATE INDEX qr_redemptions_dancer_status_idx ON public.qr_redemptions USING btree (dancer_id, status) WHERE (dancer_id IS NOT NULL);
CREATE INDEX qr_redemptions_deal_status_idx ON public.qr_redemptions USING btree (club_deal_id, status);
CREATE INDEX qr_redemptions_generated_idx ON public.qr_redemptions USING btree (generated_at DESC);
CREATE INDEX qr_redemptions_nfc_tag_idx ON public.qr_redemptions USING btree (nfc_tag_id, generated_at DESC) WHERE (nfc_tag_id IS NOT NULL);
CREATE INDEX qr_redemptions_shift_idx ON public.qr_redemptions USING btree (shift_id) WHERE (shift_id IS NOT NULL);
CREATE INDEX request_rate_limit_buckets_expiry_idx ON public.request_rate_limit_buckets USING btree (expires_at);
CREATE UNIQUE INDEX sales_agents_referral_code_idx ON public.sales_agents USING btree (referral_code);
CREATE UNIQUE INDEX sales_agents_single_active_founder_idx ON public.sales_agents USING btree (commission_depth_limit) WHERE ((commission_depth_limit = 5) AND (status = 'active'::text));
CREATE INDEX sales_agents_sponsor_idx ON public.sales_agents USING btree (sponsor_agent_id) WHERE (sponsor_agent_id IS NOT NULL);
CREATE INDEX schedule_views_dancer_viewed_idx ON public.schedule_views USING btree (dancer_id, viewed_at DESC);
CREATE INDEX shift_location_events_dancer_occurred_idx ON public.shift_location_events USING btree (dancer_id, occurred_at DESC);
CREATE INDEX shift_location_events_shift_occurred_idx ON public.shift_location_events USING btree (shift_id, occurred_at DESC);
CREATE INDEX shifts_checked_in_idx ON public.shifts USING btree (checked_in_at);
CREATE INDEX shifts_commission_tracking_started_at_idx ON public.shifts USING btree (commission_tracking_started_at);
CREATE INDEX shifts_dancer_nfc_last_tapped_idx ON public.shifts USING btree (dancer_id, nfc_last_tapped_at DESC) WHERE (nfc_last_tapped_at IS NOT NULL);
CREATE INDEX shifts_dancer_shift_date_idx ON public.shifts USING btree (dancer_id, shift_date DESC) WHERE (status = 'posted'::shift_status);
CREATE INDEX shifts_dancer_starts_idx ON public.shifts USING btree (dancer_id, starts_at);
CREATE INDEX shifts_demo_locked_active_idx ON public.shifts USING btree (dancer_id, venue_id) WHERE ((shift_source = 'demo_locked'::text) AND (status = 'posted'::shift_status) AND (checked_out_at IS NULL));
CREATE INDEX shifts_ended_at_idx ON public.shifts USING btree (ended_at);
CREATE INDEX shifts_location_status_idx ON public.shifts USING btree (location_status);
CREATE INDEX shifts_location_verification_expires_idx ON public.shifts USING btree (location_verification_expires_at) WHERE ((checked_in_at IS NOT NULL) AND (checked_out_at IS NULL));
CREATE INDEX shifts_nfc_active_idx ON public.shifts USING btree (dancer_id, location_verification_expires_at) WHERE ((checked_in_at IS NOT NULL) AND (checked_out_at IS NULL));
CREATE UNIQUE INDEX shifts_one_posted_scheduled_date_idx ON public.shifts USING btree (dancer_id, venue_id, shift_date) WHERE ((shift_source = 'scheduled'::text) AND (status = 'posted'::shift_status));
CREATE INDEX shifts_venue_affiliation_idx ON public.shifts USING btree (venue_affiliation_id) WHERE (venue_affiliation_id IS NOT NULL);
CREATE INDEX shifts_venue_starts_idx ON public.shifts USING btree (venue_id, starts_at);
CREATE INDEX shifts_working_status_idx ON public.shifts USING btree (working_status);
CREATE INDEX social_clicks_dancer_clicked_idx ON public.social_clicks USING btree (dancer_id, clicked_at DESC);
CREATE INDEX support_ai_runs_thread_created_idx ON public.support_ai_runs USING btree (thread_id, created_at DESC);
CREATE INDEX support_messages_thread_created_idx ON public.support_messages USING btree (thread_id, created_at);
CREATE INDEX support_threads_escalation_last_idx ON public.support_threads USING btree (escalation_status, escalation_priority, last_message_at DESC);
CREATE INDEX support_threads_status_last_idx ON public.support_threads USING btree (status, last_message_at DESC);
CREATE INDEX support_threads_user_last_idx ON public.support_threads USING btree (user_id, last_message_at DESC);
CREATE INDEX trending_scores_city_rank_idx ON public.trending_scores USING btree (city, rank);
CREATE INDEX venue_activity_log_venue_time_idx ON public.venue_activity_log USING btree (venue_id, created_at DESC);
CREATE INDEX venue_claim_codes_admin_queue_idx ON public.venue_claim_codes USING btree (venue_id, created_at DESC);
CREATE UNIQUE INDEX venue_claim_codes_one_unconsumed_idx ON public.venue_claim_codes USING btree (venue_id) WHERE ((used_at IS NULL) AND (revoked_at IS NULL));
CREATE INDEX venue_club_deal_requests_status_created_idx ON public.venue_club_deal_requests USING btree (status, created_at DESC);
CREATE INDEX venue_club_deal_requests_venue_created_idx ON public.venue_club_deal_requests USING btree (venue_id, created_at DESC);
CREATE INDEX venue_dancer_affiliation_events_dancer_idx ON public.venue_dancer_affiliation_events USING btree (dancer_id, occurred_at DESC);
CREATE INDEX venue_dancer_affiliation_events_venue_idx ON public.venue_dancer_affiliation_events USING btree (venue_id, occurred_at DESC);
CREATE INDEX venue_dancer_affiliations_dancer_idx ON public.venue_dancer_affiliations USING btree (dancer_id, status, updated_at DESC);
CREATE INDEX venue_dancer_affiliations_venue_idx ON public.venue_dancer_affiliations USING btree (venue_id, status, updated_at DESC);
CREATE UNIQUE INDEX venue_dancer_verification_tokens_one_active_idx ON public.venue_dancer_verification_tokens USING btree (venue_id, dancer_id) WHERE ((used_at IS NULL) AND (revoked_at IS NULL));
CREATE INDEX venue_dancer_verification_tokens_rate_ip_idx ON public.venue_dancer_verification_tokens USING btree (request_ip_hash, created_at DESC);
CREATE INDEX venue_dancer_verification_tokens_rate_user_idx ON public.venue_dancer_verification_tokens USING btree (created_by_user_id, created_at DESC);
CREATE INDEX venue_follows_venue_idx ON public.venue_follows USING btree (venue_id);
CREATE INDEX venue_nfc_support_requests_venue_status_idx ON public.venue_nfc_support_requests USING btree (venue_id, status, created_at DESC);
CREATE UNIQUE INDEX venue_ownership_claims_claim_code_idx ON public.venue_ownership_claims USING btree (claim_code_id) WHERE (claim_code_id IS NOT NULL);
CREATE INDEX venue_ownership_claims_ip_rate_idx ON public.venue_ownership_claims USING btree (request_ip_hash, submitted_at DESC);
CREATE INDEX venue_ownership_claims_pending_queue_idx ON public.venue_ownership_claims USING btree (submitted_at) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX venue_ownership_claims_pending_user_venue_idx ON public.venue_ownership_claims USING btree (claimant_user_id, venue_id) WHERE (status = 'pending'::text);
CREATE INDEX venue_page_events_venue_occurred_idx ON public.venue_page_events USING btree (venue_id, occurred_at DESC);
CREATE INDEX venue_pilot_night_reports_venue_date_idx ON public.venue_pilot_night_reports USING btree (venue_id, service_date DESC);
CREATE UNIQUE INDEX venue_referral_fee_requests_one_pending_idx ON public.venue_referral_fee_change_requests USING btree (venue_id) WHERE (status = 'pending'::text);
CREATE INDEX venue_referral_fee_requests_status_idx ON public.venue_referral_fee_change_requests USING btree (status, created_at DESC);
CREATE INDEX venue_referral_fee_terms_effective_idx ON public.venue_referral_fee_terms USING btree (venue_id, effective_from DESC, effective_until);
CREATE UNIQUE INDEX venue_sales_attributions_one_active_idx ON public.venue_sales_attributions USING btree (venue_id) WHERE (superseded_at IS NULL);
CREATE INDEX venue_sales_attributions_signer_idx ON public.venue_sales_attributions USING btree (signing_agent_id, effective_from DESC);
CREATE INDEX venue_signup_requests_admin_queue_idx ON public.venue_signup_requests USING btree (status, submitted_at);
CREATE INDEX venue_signup_requests_ip_rate_idx ON public.venue_signup_requests USING btree (request_ip_hash, submitted_at DESC);
CREATE UNIQUE INDEX venue_signup_requests_manager_idx ON public.venue_signup_requests USING btree (requester_user_id) WHERE (requester_user_id IS NOT NULL);
CREATE UNIQUE INDEX venue_signup_requests_pending_duplicate_idx ON public.venue_signup_requests USING btree (lower(venue_name), lower(street_address), lower(contact_email)) WHERE (status = ANY (ARRAY['awaiting_email_confirmation'::text, 'pending'::text]));
CREATE INDEX venue_signup_requests_referring_agent_idx ON public.venue_signup_requests USING btree (referring_agent_id, status, submitted_at DESC) WHERE (referring_agent_id IS NOT NULL);
CREATE UNIQUE INDEX venue_team_invitations_pending_email_idx ON public.venue_team_invitations USING btree (venue_id, lower(email)) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));
CREATE INDEX venue_team_invitations_venue_idx ON public.venue_team_invitations USING btree (venue_id, created_at DESC);
CREATE UNIQUE INDEX venue_team_members_active_user_idx ON public.venue_team_members USING btree (user_id) WHERE (status = 'active'::text);
CREATE INDEX venue_team_members_user_status_idx ON public.venue_team_members USING btree (user_id, status, updated_at DESC);
CREATE INDEX venue_team_members_venue_status_idx ON public.venue_team_members USING btree (venue_id, status, role, updated_at DESC);
CREATE INDEX venues_page_review_status_idx ON public.venues USING btree (page_review_status, updated_at DESC);
create view public."dancer_monthly_impact" as  SELECT id AS dancer_id,
    ( SELECT count(*) AS count
           FROM profile_views x
          WHERE x.dancer_id = d.id AND x.viewed_at >= (now() - '30 days'::interval)) AS profile_views_30d,
    ( SELECT count(*) AS count
           FROM schedule_views x
          WHERE x.dancer_id = d.id AND x.viewed_at >= (now() - '30 days'::interval)) AS schedule_views_30d,
    ( SELECT count(*) AS count
           FROM direction_requests x
          WHERE x.dancer_id = d.id AND x.requested_at >= (now() - '30 days'::interval)) AS direction_requests_30d,
    ( SELECT count(*) AS count
           FROM social_clicks x
          WHERE x.dancer_id = d.id AND x.clicked_at >= (now() - '30 days'::interval)) AS social_clicks_30d,
    ( SELECT count(DISTINCT x.shift_id) AS count
           FROM going_signals x
             JOIN shifts s ON s.id = x.shift_id
          WHERE s.dancer_id = d.id AND x.created_at >= (now() - '30 days'::interval)) AS going_signals_30d,
    ( SELECT count(DISTINCT x.customer_id) AS count
           FROM follows x
          WHERE x.dancer_id = d.id AND x.created_at >= (now() - '30 days'::interval)) AS followers_gained_30d
   FROM dancer_profiles d;
create view public."public_dancer_profiles" with (security_invoker=true,security_barrier=true) as  SELECT dp.id,
    dp.stage_name,
    dp.slug,
    dp.city,
    dp.approved_at,
    ts.rank,
    ts.score,
    ts.trend
   FROM dancer_profiles dp
     LEFT JOIN trending_scores ts ON ts.dancer_id = dp.id
  WHERE dp.status = 'approved'::dancer_status AND dp.verification_status = 'approved'::review_status AND dp.venue_approved_at IS NOT NULL AND dp.is_public = true AND dp.disabled_at IS NULL;
create policy "active admins read audit history" on "public"."admin_actions" as PERMISSIVE for SELECT to "authenticated" using (is_admin());
create policy "Admins manage agent commissions" on "public"."agent_commission_events" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Agents read own commissions" on "public"."agent_commission_events" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM sales_agents agent
  WHERE ((agent.id = agent_commission_events.recipient_agent_id) AND (agent.user_id = auth.uid())))));
create policy "users read own profile" on "public"."app_users" as PERMISSIVE for SELECT to "public" using (((id = auth.uid()) OR is_admin()));
create policy "admins manage reviews" on "public"."approval_reviews" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "dancers read own reviews" on "public"."approval_reviews" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = approval_reviews.dancer_id) AND is_current_dancer_owner(dp.id)))) OR is_admin()));
create policy "Active club deals are public" on "public"."club_deals" as PERMISSIVE for SELECT to "public" using (((is_active = true) AND (EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = club_deals.venue_id) AND (venue.is_active = true) AND (venue.published_at IS NOT NULL))))));
create policy "Admins manage club deals" on "public"."club_deals" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue owners read own club deals" on "public"."club_deals" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = club_deals.venue_id) AND is_current_venue_owner(v.id)))));
create policy "Admins manage club finance accounts" on "public"."club_finance_accounts" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue owners read own finance account" on "public"."club_finance_accounts" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = club_finance_accounts.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins manage club invoice items" on "public"."club_invoice_items" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue owners read own invoice items" on "public"."club_invoice_items" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM (club_invoices invoice
     JOIN venues venue ON ((venue.id = invoice.venue_id)))
  WHERE ((invoice.id = club_invoice_items.invoice_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins manage club invoice reminders" on "public"."club_invoice_reminders" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue owners read own invoice reminders" on "public"."club_invoice_reminders" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM (club_invoices invoice
     JOIN venues venue ON ((venue.id = invoice.venue_id)))
  WHERE ((invoice.id = club_invoice_reminders.invoice_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins manage club invoices" on "public"."club_invoices" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue owners read own invoices" on "public"."club_invoices" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = club_invoices.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins read commission events" on "public"."commission_events" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Dancers read own earnings" on "public"."commission_events" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = commission_events.dancer_id) AND is_current_dancer_owner(dancer.id)))));
create policy "admins manage content reports" on "public"."content_reports" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "customers read own saved club deals" on "public"."customer_deal_saves" as PERMISSIVE for SELECT to "authenticated" using ((customer_id = auth.uid()));
create policy "customers remove own saved club deals" on "public"."customer_deal_saves" as PERMISSIVE for DELETE to "authenticated" using ((customer_id = auth.uid()));
create policy "customers save own club deals" on "public"."customer_deal_saves" as PERMISSIVE for INSERT to "authenticated" with check (((customer_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = auth.uid()) AND (account.role = 'customer'::user_role) AND (account.account_state = 'active'::account_state)))) AND (EXISTS ( SELECT 1
   FROM (club_deals deal
     JOIN venues venue ON ((venue.id = deal.venue_id)))
  WHERE ((deal.id = customer_deal_saves.club_deal_id) AND (deal.is_active = true) AND (venue.is_active = true)))) AND ((dancer_id IS NULL) OR (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = customer_deal_saves.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL)))))));
create policy "active account required for inserts" on "public"."customer_profiles" as RESTRICTIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "active account required for updates" on "public"."customer_profiles" as RESTRICTIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state))))) with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "customers manage own profile" on "public"."customer_profiles" as PERMISSIVE for ALL to "public" using (((user_id = auth.uid()) OR is_admin())) with check (((user_id = auth.uid()) OR is_admin()));
create policy "Admins read earning history" on "public"."dancer_earning_status_history" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Dancers read own earning history" on "public"."dancer_earning_status_history" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM (commission_events earning
     JOIN dancer_profiles dancer ON ((dancer.id = earning.dancer_id)))
  WHERE ((earning.id = dancer_earning_status_history.earning_id) AND is_current_dancer_owner(dancer.id)))));
create policy "Admins manage dancer NFC enrollments" on "public"."dancer_nfc_enrollments" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Dancers read own NFC enrollments" on "public"."dancer_nfc_enrollments" as PERMISSIVE for SELECT to "public" using ((dancer_user_id = auth.uid()));
create policy "Venue owners read own dancer NFC enrollments" on "public"."dancer_nfc_enrollments" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = dancer_nfc_enrollments.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins read dancer payout accounts" on "public"."dancer_payout_accounts" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Dancers read own payout account" on "public"."dancer_payout_accounts" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = dancer_payout_accounts.dancer_id) AND is_current_dancer_owner(dancer.id)))));
create policy "Admins read dancer payout batches" on "public"."dancer_payout_batches" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Dancers read own payout batches" on "public"."dancer_payout_batches" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = dancer_payout_batches.dancer_id) AND is_current_dancer_owner(dancer.id)))));
create policy "Admins read dancer payout items" on "public"."dancer_payout_items" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Dancers read own payout items" on "public"."dancer_payout_items" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM (dancer_payout_batches batch
     JOIN dancer_profiles dancer ON ((dancer.id = batch.dancer_id)))
  WHERE ((batch.id = dancer_payout_items.payout_batch_id) AND is_current_dancer_owner(dancer.id)))));
create policy "approved photos are public" on "public"."dancer_photos" as PERMISSIVE for SELECT to "public" using ((((review_status = 'approved'::review_status) AND (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = dancer_photos.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))) OR (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = dancer_photos.dancer_id) AND is_current_dancer_owner(dancer.id)))) OR is_admin()));
create policy "approved public dancers are public" on "public"."dancer_profiles" as PERMISSIVE for SELECT to "public" using ((((status = 'approved'::dancer_status) AND (verification_status = 'approved'::review_status) AND (is_public = true) AND (disabled_at IS NULL)) OR (user_id = auth.uid()) OR is_admin()));
create policy "Admins manage deal revenue events" on "public"."deal_revenue_events" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "dancers read own direction analytics" on "public"."direction_requests" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = direction_requests.dancer_id) AND is_current_dancer_owner(dp.id)))) OR is_admin()));
create policy "admins manage dmca agent settings" on "public"."dmca_agent_settings" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "admins manage dmca cases" on "public"."dmca_cases" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "uploaders read own dmca cases" on "public"."dmca_cases" as PERMISSIVE for SELECT to "public" using (((uploader_id = auth.uid()) OR is_admin()));
create policy "admins manage counter notices" on "public"."dmca_counter_notices" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "uploaders read own counter notices" on "public"."dmca_counter_notices" as PERMISSIVE for SELECT to "public" using (((uploader_id = auth.uid()) OR is_admin()));
create policy "admins manage dmca strikes" on "public"."dmca_strikes" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "users read own dmca strikes" on "public"."dmca_strikes" as PERMISSIVE for SELECT to "public" using (((user_id = auth.uid()) OR is_admin()));
create policy "active account required for inserts" on "public"."favorites" as RESTRICTIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "active account required for updates" on "public"."favorites" as RESTRICTIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state))))) with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "customers manage own favorites" on "public"."favorites" as PERMISSIVE for ALL to "public" using (((customer_id = auth.uid()) OR is_admin())) with check (((customer_id = auth.uid()) OR is_admin()));
create policy "Admins read financial audit" on "public"."financial_audit_events" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "active account required for inserts" on "public"."follows" as RESTRICTIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "active account required for updates" on "public"."follows" as RESTRICTIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state))))) with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "customers manage own follows" on "public"."follows" as PERMISSIVE for ALL to "public" using (((customer_id = auth.uid()) OR is_admin())) with check (((customer_id = auth.uid()) OR is_admin()));
create policy "active account required for inserts" on "public"."going_signals" as RESTRICTIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "active account required for updates" on "public"."going_signals" as RESTRICTIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state))))) with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "customers manage own going signals" on "public"."going_signals" as PERMISSIVE for ALL to "public" using (((customer_id = auth.uid()) OR is_admin())) with check (((customer_id = auth.uid()) OR is_admin()));
create policy "admins manage image moderation" on "public"."image_moderation_records" as PERMISSIVE for ALL to "authenticated" using (is_admin()) with check (is_admin());
create policy "users read own moderation status" on "public"."image_moderation_records" as PERMISSIVE for SELECT to "authenticated" using ((user_id = auth.uid()));
create policy "dancers read own MyDancr TV analytics" on "public"."mydancr_tv_events" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM (mydancr_tv_videos video
     JOIN dancer_profiles dancer ON ((dancer.id = video.dancer_id)))
  WHERE ((video.id = mydancr_tv_events.video_id) AND is_current_dancer_owner(dancer.id)))) OR is_admin()));
create policy "venue owners read MyDancr TV analytics" on "public"."mydancr_tv_events" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM (mydancr_tv_videos video
     JOIN venues venue ON ((venue.id = video.venue_id)))
  WHERE ((video.id = mydancr_tv_events.video_id) AND is_current_venue_owner(venue.id)))) OR is_admin()));
create policy "admins manage MyDancr TV videos" on "public"."mydancr_tv_videos" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "dancers read own MyDancr TV videos" on "public"."mydancr_tv_videos" as PERMISSIVE for SELECT to "public" using (((submitted_by = auth.uid()) OR is_admin()));
create policy "public reads approved MyDancr TV videos" on "public"."mydancr_tv_videos" as PERMISSIVE for SELECT to "public" using (((status = 'approved'::text) AND ((duration_seconds >= (1)::numeric) AND (duration_seconds <= (30)::numeric)) AND (published_at IS NOT NULL) AND (published_at <= now()) AND ((expires_at IS NULL) OR (expires_at > now())) AND (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = mydancr_tv_videos.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.photo_review_status = 'approved'::review_status) AND (dancer.approved_at IS NOT NULL) AND (dancer.disabled_at IS NULL) AND (dancer.is_public = true))))));
create policy "venue owners read tagged MyDancr TV videos" on "public"."mydancr_tv_videos" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = mydancr_tv_videos.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins read NATS affiliate accounts" on "public"."nats_affiliate_accounts" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Dancers read own NATS affiliate account" on "public"."nats_affiliate_accounts" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = nats_affiliate_accounts.dancer_id) AND is_current_dancer_owner(dancer.id)))));
create policy "Admins read NATS agent affiliate accounts" on "public"."nats_agent_affiliate_accounts" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Agents read own NATS affiliate account" on "public"."nats_agent_affiliate_accounts" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM sales_agents agent
  WHERE ((agent.id = nats_agent_affiliate_accounts.agent_id) AND (agent.user_id = auth.uid())))));
create policy "Admins read NATS agent commission exports" on "public"."nats_agent_commission_exports" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Agents read own NATS commission exports" on "public"."nats_agent_commission_exports" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM sales_agents agent
  WHERE ((agent.id = nats_agent_commission_exports.agent_id) AND (agent.user_id = auth.uid())))));
create policy "Admins read NATS commission exports" on "public"."nats_commission_exports" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Dancers read own NATS commission exports" on "public"."nats_commission_exports" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = nats_commission_exports.dancer_id) AND is_current_dancer_owner(dancer.id)))));
create policy "Admins manage NFC tags" on "public"."nfc_tags" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue owners read own NFC tags" on "public"."nfc_tags" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = nfc_tags.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins manage NFC tap events" on "public"."nfc_tap_events" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Dancers read own NFC tap events" on "public"."nfc_tap_events" as PERMISSIVE for SELECT to "public" using ((actor_user_id = auth.uid()));
create policy "Venue owners read own NFC tap events" on "public"."nfc_tap_events" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = nfc_tap_events.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "admins create notifications" on "public"."notifications" as PERMISSIVE for INSERT to "public" with check (is_admin());
create policy "users delete own notifications" on "public"."notifications" as PERMISSIVE for DELETE to "authenticated" using ((recipient_id = auth.uid()));
create policy "users read own notifications" on "public"."notifications" as PERMISSIVE for SELECT to "public" using (((recipient_id = auth.uid()) OR is_admin()));
create policy "users update own notifications" on "public"."notifications" as PERMISSIVE for UPDATE to "public" using ((recipient_id = auth.uid())) with check ((recipient_id = auth.uid()));
create policy "Admins read provider webhooks" on "public"."payment_provider_webhook_events" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "Admins read payout settings" on "public"."payout_settings" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "dancers read own analytics" on "public"."profile_views" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = profile_views.dancer_id) AND is_current_dancer_owner(dp.id)))) OR is_admin()));
create policy "Admins manage QR redemption events" on "public"."qr_redemption_events" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Dancers read own QR redemption events" on "public"."qr_redemption_events" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM (qr_redemptions redemption
     JOIN dancer_profiles dancer ON ((dancer.id = redemption.dancer_id)))
  WHERE ((redemption.id = qr_redemption_events.qr_redemption_id) AND is_current_dancer_owner(dancer.id)))));
create policy "Venue owners read own QR redemption events" on "public"."qr_redemption_events" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM (qr_redemptions redemption
     JOIN venues venue ON ((venue.id = redemption.venue_id)))
  WHERE ((redemption.id = qr_redemption_events.qr_redemption_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins manage qr redemptions" on "public"."qr_redemptions" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Dancers view own attributed redemptions" on "public"."qr_redemptions" as PERMISSIVE for SELECT to "public" using ((dancer_id IN ( SELECT dancer_profiles.id
   FROM dancer_profiles
  WHERE is_current_dancer_owner(dancer_profiles.id))));
create policy "Venue owners read own QR redemptions" on "public"."qr_redemptions" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = qr_redemptions.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "admins manage ranking events" on "public"."ranking_events" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "dancers read own ranking events" on "public"."ranking_events" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = ranking_events.dancer_id) AND is_current_dancer_owner(dp.id)))) OR is_admin()));
create policy "Admins manage sales agents" on "public"."sales_agents" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Agents read own sales record" on "public"."sales_agents" as PERMISSIVE for SELECT to "public" using ((user_id = auth.uid()));
create policy "dancers read own schedule analytics" on "public"."schedule_views" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = schedule_views.dancer_id) AND is_current_dancer_owner(dp.id)))) OR is_admin()));
create policy "dancers read own location events" on "public"."shift_location_events" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = shift_location_events.dancer_id) AND is_current_dancer_owner(dp.id)))) OR is_admin()));
create policy "approved dancers manage own shifts" on "public"."shifts" as PERMISSIVE for ALL to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = shifts.dancer_id) AND is_current_dancer_owner(dp.id) AND (dp.status = 'approved'::dancer_status)))) OR is_admin())) with check (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = shifts.dancer_id) AND is_current_dancer_owner(dp.id) AND (dp.status = 'approved'::dancer_status)))) OR is_admin()));
create policy "posted approved shifts are public" on "public"."shifts" as PERMISSIVE for SELECT to "public" using ((((status = 'posted'::shift_status) AND (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = shifts.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))) OR (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = shifts.dancer_id) AND is_current_dancer_owner(dancer.id)))) OR is_admin()));
create policy "dancers read own social analytics" on "public"."social_clicks" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = social_clicks.dancer_id) AND is_current_dancer_owner(dp.id)))) OR is_admin()));
create policy "approved social links are public" on "public"."social_links" as PERMISSIVE for SELECT to "public" using ((((is_active = true) AND (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = social_links.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))) OR (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = social_links.dancer_id) AND is_current_dancer_owner(dancer.id)))) OR is_admin()));
create policy "admins manage subscriptions" on "public"."subscriptions" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "dancers read own subscription" on "public"."subscriptions" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = subscriptions.dancer_id) AND is_current_dancer_owner(dp.id)))) OR is_admin()));
create policy "admins read support ai runs" on "public"."support_ai_runs" as PERMISSIVE for SELECT to "public" using (is_admin());
create policy "users create own support messages" on "public"."support_messages" as PERMISSIVE for INSERT to "public" with check (((EXISTS ( SELECT 1
   FROM support_threads st
  WHERE ((st.id = support_messages.thread_id) AND (st.user_id = auth.uid())))) OR is_admin()));
create policy "users read own support messages" on "public"."support_messages" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM support_threads st
  WHERE ((st.id = support_messages.thread_id) AND (st.user_id = auth.uid())))) OR is_admin()));
create policy "users create own support threads" on "public"."support_threads" as PERMISSIVE for INSERT to "public" with check (((user_id = auth.uid()) OR is_admin()));
create policy "users read own support threads" on "public"."support_threads" as PERMISSIVE for SELECT to "public" using (((user_id = auth.uid()) OR is_admin()));
create policy "users update own support threads" on "public"."support_threads" as PERMISSIVE for UPDATE to "public" using (((user_id = auth.uid()) OR is_admin())) with check (((user_id = auth.uid()) OR is_admin()));
create policy "admins manage rankings" on "public"."trending_scores" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "approved rankings are public" on "public"."trending_scores" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = trending_scores.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL)))) OR (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = trending_scores.dancer_id) AND is_current_dancer_owner(dancer.id)))) OR is_admin()));
create policy "Admins manage venue activity" on "public"."venue_activity_log" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue team reads own activity" on "public"."venue_activity_log" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_activity_log.venue_id) AND is_current_venue_owner(v.id)))) OR (EXISTS ( SELECT 1
   FROM venue_team_members m
  WHERE ((m.venue_id = venue_activity_log.venue_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));
create policy "admins manage venue claim codes" on "public"."venue_claim_codes" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Admins manage venue Club Deal requests" on "public"."venue_club_deal_requests" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue teams read own Club Deal requests" on "public"."venue_club_deal_requests" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_club_deal_requests.venue_id) AND is_current_venue_owner(v.id)))) OR (EXISTS ( SELECT 1
   FROM venue_team_members m
  WHERE ((m.venue_id = venue_club_deal_requests.venue_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));
create policy "active account required for inserts" on "public"."venue_follows" as RESTRICTIVE for INSERT to "authenticated" with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "active account required for updates" on "public"."venue_follows" as RESTRICTIVE for UPDATE to "authenticated" using ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state))))) with check ((EXISTS ( SELECT 1
   FROM app_users account
  WHERE ((account.id = ( SELECT auth.uid() AS uid)) AND (account.account_state = 'active'::account_state)))));
create policy "customers manage own venue follows" on "public"."venue_follows" as PERMISSIVE for ALL to "public" using (((customer_id = auth.uid()) OR is_admin())) with check (((customer_id = auth.uid()) OR is_admin()));
create policy "Admins manage venue NFC support requests" on "public"."venue_nfc_support_requests" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue team reads own NFC support requests" on "public"."venue_nfc_support_requests" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_nfc_support_requests.venue_id) AND is_current_venue_owner(v.id)))) OR (EXISTS ( SELECT 1
   FROM venue_team_members m
  WHERE ((m.venue_id = venue_nfc_support_requests.venue_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));
create policy "admins manage venue claims" on "public"."venue_ownership_claims" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "claimants read own venue claims" on "public"."venue_ownership_claims" as PERMISSIVE for SELECT to "public" using ((claimant_user_id = auth.uid()));
create policy "venue owners read venue analytics" on "public"."venue_page_events" as PERMISSIVE for SELECT to "public" using (((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_page_events.venue_id) AND is_current_venue_owner(venue.id)))) OR is_admin()));
create policy "Admins manage venue pilot night reports" on "public"."venue_pilot_night_reports" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Admins manage referral fee requests" on "public"."venue_referral_fee_change_requests" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue owners read own referral fee requests" on "public"."venue_referral_fee_change_requests" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_referral_fee_change_requests.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins manage referral fee terms" on "public"."venue_referral_fee_terms" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue owners read own referral fee terms" on "public"."venue_referral_fee_terms" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_referral_fee_terms.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins manage venue sales attribution" on "public"."venue_sales_attributions" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Agents read attributed venues" on "public"."venue_sales_attributions" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM sales_agents agent
  WHERE ((agent.user_id = auth.uid()) AND (agent.id = ANY (ARRAY[venue_sales_attributions.signing_agent_id, venue_sales_attributions.sponsor_level_1_agent_id, venue_sales_attributions.sponsor_level_2_agent_id, venue_sales_attributions.sponsor_level_3_agent_id, venue_sales_attributions.sponsor_level_4_agent_id, venue_sales_attributions.sponsor_level_5_agent_id]))))));
create policy "Admins manage venue signup requests" on "public"."venue_signup_requests" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Admins manage venue team invitations" on "public"."venue_team_invitations" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue owners read own team invitations" on "public"."venue_team_invitations" as PERMISSIVE for SELECT to "public" using ((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_team_invitations.venue_id) AND is_current_venue_owner(venue.id)))));
create policy "Admins manage venue team members" on "public"."venue_team_members" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "Venue users read own team membership" on "public"."venue_team_members" as PERMISSIVE for SELECT to "public" using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_team_members.venue_id) AND is_current_venue_owner(venue.id))))));
create policy "active venues are public" on "public"."venues" as PERMISSIVE for SELECT to "public" using (((is_active = true) OR is_admin()));
create policy "admins manage venues" on "public"."venues" as PERMISSIVE for ALL to "public" using (is_admin()) with check (is_admin());
create policy "venue owners read own venue" on "public"."venues" as PERMISSIVE for SELECT to "public" using ((owner_user_id = auth.uid()));
create policy "Dancer media reads require checked delivery" on "storage"."objects" as RESTRICTIVE for SELECT to "anon","authenticated" using ((bucket_id <> ALL (ARRAY['dancer-photos'::text, 'mydancr-tv-videos'::text])));
create policy "admins manage MyDancr TV files" on "storage"."objects" as PERMISSIVE for ALL to "authenticated" using (((bucket_id = 'mydancr-tv-videos'::text) AND is_admin())) with check (((bucket_id = 'mydancr-tv-videos'::text) AND is_admin()));
create policy "admins manage dancer photo files" on "storage"."objects" as PERMISSIVE for ALL to "authenticated" using (((bucket_id = 'dancer-photos'::text) AND is_admin())) with check (((bucket_id = 'dancer-photos'::text) AND is_admin()));
create policy "admins manage moderation review files" on "storage"."objects" as PERMISSIVE for ALL to "authenticated" using (((bucket_id = 'dancr-image-moderation-review'::text) AND is_admin())) with check (((bucket_id = 'dancr-image-moderation-review'::text) AND is_admin()));
create policy "admins manage moderation temp files" on "storage"."objects" as PERMISSIVE for ALL to "authenticated" using (((bucket_id = 'dancr-image-moderation-temp'::text) AND is_admin())) with check (((bucket_id = 'dancr-image-moderation-temp'::text) AND is_admin()));
create policy "admins manage verification files" on "storage"."objects" as PERMISSIVE for ALL to "authenticated" using (((bucket_id = 'verification-documents'::text) AND is_admin())) with check (((bucket_id = 'verification-documents'::text) AND is_admin()));
create policy "admins read venue ownership proofs" on "storage"."objects" as PERMISSIVE for SELECT to "public" using (((bucket_id = 'venue-ownership-proofs'::text) AND is_admin()));
create policy "approved dancer photos are publicly readable" on "storage"."objects" as PERMISSIVE for SELECT to "public" using (((bucket_id = 'dancer-photos'::text) AND (EXISTS ( SELECT 1
   FROM (dancer_photos photo
     JOIN dancer_profiles dancer ON ((dancer.id = photo.dancer_id)))
  WHERE ((photo.storage_path = objects.name) AND (photo.review_status = 'approved'::review_status) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))));
create policy "claimants read own venue proof" on "storage"."objects" as PERMISSIVE for SELECT to "public" using (((bucket_id = 'venue-ownership-proofs'::text) AND (EXISTS ( SELECT 1
   FROM venue_ownership_claims claim
  WHERE ((claim.claimant_user_id = auth.uid()) AND (claim.proof_storage_path = objects.name))))));
create policy "dancers read own MyDancr TV files" on "storage"."objects" as PERMISSIVE for SELECT to "authenticated" using (((bucket_id = 'mydancr-tv-videos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "dancers read own dancer photo files" on "storage"."objects" as PERMISSIVE for SELECT to "authenticated" using (((bucket_id = 'dancer-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "dancers read own verification files" on "storage"."objects" as PERMISSIVE for SELECT to "authenticated" using (((bucket_id = 'verification-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "public reads venue cover images" on "storage"."objects" as PERMISSIVE for SELECT to "public" using ((bucket_id = 'venue-cover-images'::text));
create policy "public reads venue logo images" on "storage"."objects" as PERMISSIVE for SELECT to "public" using ((bucket_id = 'venue-logo-images'::text));
create policy "public reads venue qr codes" on "storage"."objects" as PERMISSIVE for SELECT to "public" using ((bucket_id = 'venue-qr-codes'::text));
alter table public."account_recovery_events" enable row level security; alter table public."account_recovery_events" no force row level security;
alter table public."account_self_pauses" enable row level security; alter table public."account_self_pauses" no force row level security;
alter table public."admin_actions" enable row level security; alter table public."admin_actions" no force row level security;
alter table public."agent_commission_events" enable row level security; alter table public."agent_commission_events" no force row level security;
alter table public."app_users" enable row level security; alter table public."app_users" no force row level security;
alter table public."approval_reviews" enable row level security; alter table public."approval_reviews" no force row level security;
alter table public."club_deals" enable row level security; alter table public."club_deals" no force row level security;
alter table public."club_finance_accounts" enable row level security; alter table public."club_finance_accounts" no force row level security;
alter table public."club_invoice_items" enable row level security; alter table public."club_invoice_items" no force row level security;
alter table public."club_invoice_reminders" enable row level security; alter table public."club_invoice_reminders" no force row level security;
alter table public."club_invoices" enable row level security; alter table public."club_invoices" no force row level security;
alter table public."club_shuttle_requests" enable row level security; alter table public."club_shuttle_requests" no force row level security;
alter table public."commission_events" enable row level security; alter table public."commission_events" no force row level security;
alter table public."content_reports" enable row level security; alter table public."content_reports" no force row level security;
alter table public."customer_deal_saves" enable row level security; alter table public."customer_deal_saves" no force row level security;
alter table public."customer_profiles" enable row level security; alter table public."customer_profiles" no force row level security;
alter table public."dancer_earning_status_history" enable row level security; alter table public."dancer_earning_status_history" no force row level security;
alter table public."dancer_nfc_enrollments" enable row level security; alter table public."dancer_nfc_enrollments" no force row level security;
alter table public."dancer_payout_accounts" enable row level security; alter table public."dancer_payout_accounts" no force row level security;
alter table public."dancer_payout_batches" enable row level security; alter table public."dancer_payout_batches" no force row level security;
alter table public."dancer_payout_items" enable row level security; alter table public."dancer_payout_items" no force row level security;
alter table public."dancer_photos" enable row level security; alter table public."dancer_photos" no force row level security;
alter table public."dancer_profile_slug_aliases" enable row level security; alter table public."dancer_profile_slug_aliases" no force row level security;
alter table public."dancer_profiles" enable row level security; alter table public."dancer_profiles" no force row level security;
alter table public."deal_revenue_events" enable row level security; alter table public."deal_revenue_events" no force row level security;
alter table public."direction_requests" enable row level security; alter table public."direction_requests" no force row level security;
alter table public."dmca_agent_settings" enable row level security; alter table public."dmca_agent_settings" no force row level security;
alter table public."dmca_cases" enable row level security; alter table public."dmca_cases" no force row level security;
alter table public."dmca_counter_notices" enable row level security; alter table public."dmca_counter_notices" no force row level security;
alter table public."dmca_enforcement_states" enable row level security; alter table public."dmca_enforcement_states" no force row level security;
alter table public."dmca_strikes" enable row level security; alter table public."dmca_strikes" no force row level security;
alter table public."favorites" enable row level security; alter table public."favorites" no force row level security;
alter table public."financial_audit_events" enable row level security; alter table public."financial_audit_events" no force row level security;
alter table public."follows" enable row level security; alter table public."follows" no force row level security;
alter table public."gallery_media_reference_history" enable row level security; alter table public."gallery_media_reference_history" no force row level security;
alter table public."gallery_storage_retirements" enable row level security; alter table public."gallery_storage_retirements" no force row level security;
alter table public."going_signals" enable row level security; alter table public."going_signals" no force row level security;
alter table public."image_moderation_records" enable row level security; alter table public."image_moderation_records" no force row level security;
alter table public."media_likes" enable row level security; alter table public."media_likes" no force row level security;
alter table public."mydancr_tv_events" enable row level security; alter table public."mydancr_tv_events" no force row level security;
alter table public."mydancr_tv_videos" enable row level security; alter table public."mydancr_tv_videos" no force row level security;
alter table public."nats_affiliate_accounts" enable row level security; alter table public."nats_affiliate_accounts" no force row level security;
alter table public."nats_agent_affiliate_accounts" enable row level security; alter table public."nats_agent_affiliate_accounts" no force row level security;
alter table public."nats_agent_commission_exports" enable row level security; alter table public."nats_agent_commission_exports" no force row level security;
alter table public."nats_commission_exports" enable row level security; alter table public."nats_commission_exports" no force row level security;
alter table public."nfc_tags" enable row level security; alter table public."nfc_tags" no force row level security;
alter table public."nfc_tap_events" enable row level security; alter table public."nfc_tap_events" no force row level security;
alter table public."notifications" enable row level security; alter table public."notifications" no force row level security;
alter table public."payment_provider_webhook_events" enable row level security; alter table public."payment_provider_webhook_events" no force row level security;
alter table public."payout_settings" enable row level security; alter table public."payout_settings" no force row level security;
alter table public."profile_views" enable row level security; alter table public."profile_views" no force row level security;
alter table public."qr_redemption_events" enable row level security; alter table public."qr_redemption_events" no force row level security;
alter table public."qr_redemptions" enable row level security; alter table public."qr_redemptions" no force row level security;
alter table public."ranking_events" enable row level security; alter table public."ranking_events" no force row level security;
alter table public."request_rate_limit_buckets" enable row level security; alter table public."request_rate_limit_buckets" no force row level security;
alter table public."sales_agents" enable row level security; alter table public."sales_agents" no force row level security;
alter table public."schedule_views" enable row level security; alter table public."schedule_views" no force row level security;
alter table public."shift_location_events" enable row level security; alter table public."shift_location_events" no force row level security;
alter table public."shifts" enable row level security; alter table public."shifts" no force row level security;
alter table public."social_clicks" enable row level security; alter table public."social_clicks" no force row level security;
alter table public."social_links" enable row level security; alter table public."social_links" no force row level security;
alter table public."subscriptions" enable row level security; alter table public."subscriptions" no force row level security;
alter table public."support_ai_runs" enable row level security; alter table public."support_ai_runs" no force row level security;
alter table public."support_messages" enable row level security; alter table public."support_messages" no force row level security;
alter table public."support_threads" enable row level security; alter table public."support_threads" no force row level security;
alter table public."trending_scores" enable row level security; alter table public."trending_scores" no force row level security;
alter table public."venue_activity_log" enable row level security; alter table public."venue_activity_log" no force row level security;
alter table public."venue_claim_codes" enable row level security; alter table public."venue_claim_codes" no force row level security;
alter table public."venue_club_deal_requests" enable row level security; alter table public."venue_club_deal_requests" no force row level security;
alter table public."venue_dancer_affiliation_events" enable row level security; alter table public."venue_dancer_affiliation_events" no force row level security;
alter table public."venue_dancer_affiliations" enable row level security; alter table public."venue_dancer_affiliations" no force row level security;
alter table public."venue_dancer_verification_tokens" enable row level security; alter table public."venue_dancer_verification_tokens" no force row level security;
alter table public."venue_follows" enable row level security; alter table public."venue_follows" no force row level security;
alter table public."venue_nfc_support_requests" enable row level security; alter table public."venue_nfc_support_requests" no force row level security;
alter table public."venue_ownership_claims" enable row level security; alter table public."venue_ownership_claims" no force row level security;
alter table public."venue_page_events" enable row level security; alter table public."venue_page_events" no force row level security;
alter table public."venue_pilot_night_reports" enable row level security; alter table public."venue_pilot_night_reports" no force row level security;
alter table public."venue_referral_fee_change_requests" enable row level security; alter table public."venue_referral_fee_change_requests" no force row level security;
alter table public."venue_referral_fee_terms" enable row level security; alter table public."venue_referral_fee_terms" no force row level security;
alter table public."venue_sales_attributions" enable row level security; alter table public."venue_sales_attributions" no force row level security;
alter table public."venue_signup_requests" enable row level security; alter table public."venue_signup_requests" no force row level security;
alter table public."venue_team_invitations" enable row level security; alter table public."venue_team_invitations" no force row level security;
alter table public."venue_team_members" enable row level security; alter table public."venue_team_members" no force row level security;
alter table public."venues" enable row level security; alter table public."venues" no force row level security;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
CREATE TRIGGER sync_verified_auth_email AFTER UPDATE OF email ON auth.users FOR EACH ROW WHEN (((old.email)::text IS DISTINCT FROM (new.email)::text)) EXECUTE FUNCTION sync_verified_auth_email();
CREATE TRIGGER venue_request_email_confirmed AFTER UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW WHEN (((new.email_confirmed_at IS NOT NULL) AND (old.email_confirmed_at IS DISTINCT FROM new.email_confirmed_at))) EXECUTE FUNCTION confirm_venue_request_email();
CREATE TRIGGER agent_commission_events_enqueue_nats_export AFTER INSERT OR UPDATE OF status ON public.agent_commission_events FOR EACH ROW EXECUTE FUNCTION enqueue_nats_agent_commission_export();
CREATE TRIGGER agent_commission_events_no_delete BEFORE DELETE ON public.agent_commission_events FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER agent_commission_events_reconcile_nats_void AFTER UPDATE OF status ON public.agent_commission_events FOR EACH ROW EXECUTE FUNCTION flag_voided_nats_agent_commission();
CREATE TRIGGER invalidate_account_pause_after_decision AFTER DELETE OR UPDATE OF role, account_state, dmca_suspended_at ON public.app_users FOR EACH ROW EXECUTE FUNCTION invalidate_account_self_pause();
CREATE TRIGGER invalidate_dmca_account_enforcement AFTER DELETE OR UPDATE OF role, account_state, dmca_suspended_at ON public.app_users FOR EACH ROW EXECUTE FUNCTION invalidate_dmca_enforcement_state();
CREATE TRIGGER commission_events_enqueue_nats_export AFTER INSERT OR UPDATE OF status, held_at, review_flag ON public.commission_events FOR EACH ROW EXECUTE FUNCTION enqueue_nats_commission_export();
CREATE TRIGGER commission_events_no_delete BEFORE DELETE ON public.commission_events FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER commission_events_prepare_earning BEFORE INSERT OR UPDATE ON public.commission_events FOR EACH ROW EXECUTE FUNCTION prepare_dancer_earning();
CREATE TRIGGER commission_events_reconcile_nats_reversal AFTER UPDATE OF status ON public.commission_events FOR EACH ROW EXECUTE FUNCTION flag_reversed_nats_commission();
CREATE TRIGGER commission_events_require_nats_enrollment BEFORE INSERT ON public.commission_events FOR EACH ROW EXECUTE FUNCTION require_enrolled_club_deal_earning();
CREATE TRIGGER commission_events_status_history AFTER INSERT OR UPDATE OF status ON public.commission_events FOR EACH ROW EXECUTE FUNCTION record_dancer_earning_status_history();
CREATE TRIGGER reject_retired_provider_earnings BEFORE INSERT OR UPDATE OF payment_provider ON public.commission_events FOR EACH ROW EXECUTE FUNCTION reject_retired_payout_provider();
CREATE TRIGGER dancer_earning_history_no_delete BEFORE DELETE ON public.dancer_earning_status_history FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER reject_retired_provider_accounts BEFORE INSERT OR UPDATE OF payment_provider ON public.dancer_payout_accounts FOR EACH ROW EXECUTE FUNCTION reject_retired_payout_provider();
CREATE TRIGGER dancer_payout_batches_no_delete BEFORE DELETE ON public.dancer_payout_batches FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER reject_retired_provider_batches BEFORE INSERT OR UPDATE OF payment_provider ON public.dancer_payout_batches FOR EACH ROW EXECUTE FUNCTION reject_retired_payout_provider();
CREATE TRIGGER dancer_payout_items_no_delete BEFORE DELETE ON public.dancer_payout_items FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER dancer_photos_capture_media_reference AFTER INSERT OR DELETE OR UPDATE OF id, dancer_id, storage_path ON public.dancer_photos FOR EACH ROW EXECUTE FUNCTION capture_gallery_media_reference_history();
CREATE TRIGGER dancer_photos_guard_storage_reference AFTER INSERT OR UPDATE ON public.dancer_photos FOR EACH ROW EXECUTE FUNCTION guard_gallery_storage_reference();
CREATE TRIGGER advance_dancer_avatar_version BEFORE UPDATE OF avatar_storage_path, avatar_updated_at ON public.dancer_profiles FOR EACH ROW EXECUTE FUNCTION advance_dancer_avatar_version();
CREATE TRIGGER assign_dancer_profile_link BEFORE INSERT OR UPDATE OF stage_name, slug ON public.dancer_profiles FOR EACH ROW EXECUTE FUNCTION assign_dancer_profile_link();
CREATE TRIGGER dancer_profiles_capture_avatar_reference AFTER INSERT OR DELETE OR UPDATE OF id, avatar_storage_path ON public.dancer_profiles FOR EACH ROW EXECUTE FUNCTION capture_gallery_media_reference_history();
CREATE TRIGGER dancer_profiles_guard_storage_reference AFTER INSERT OR UPDATE ON public.dancer_profiles FOR EACH ROW EXECUTE FUNCTION guard_gallery_storage_reference();
CREATE TRIGGER invalidate_account_pause_after_profile_decision AFTER DELETE OR UPDATE OF user_id, status, is_public, disabled_at, admin_disabled_at, dmca_suspended_at, verification_status, photo_review_status, approved_at, venue_approved_at, venue_approved_by_user_id, venue_approved_venue_id ON public.dancer_profiles FOR EACH ROW EXECUTE FUNCTION invalidate_account_self_pause();
CREATE TRIGGER invalidate_dmca_profile_enforcement AFTER DELETE OR UPDATE OF user_id, status, disabled_at, admin_disabled_at, dmca_suspended_at, is_public, verification_status, photo_review_status, approved_at, venue_approved_at, venue_approved_by_user_id, venue_approved_venue_id ON public.dancer_profiles FOR EACH ROW EXECUTE FUNCTION invalidate_dmca_enforcement_state();
CREATE TRIGGER notify_dancer_profile_live_after_activation AFTER UPDATE OF status, verification_status, is_public ON public.dancer_profiles FOR EACH ROW EXECUTE FUNCTION notify_dancer_profile_live();
CREATE TRIGGER deal_revenue_events_preserve_dancer_eligibility BEFORE UPDATE ON public.deal_revenue_events FOR EACH ROW EXECUTE FUNCTION preserve_dancer_commission_eligibility();
CREATE TRIGGER deal_revenue_events_void_agent_commissions AFTER UPDATE OF status ON public.deal_revenue_events FOR EACH ROW EXECUTE FUNCTION void_agent_commissions_with_revenue();
CREATE TRIGGER financial_audit_no_delete BEFORE DELETE ON public.financial_audit_events FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER advance_avatar_review_version BEFORE UPDATE ON public.image_moderation_records FOR EACH ROW EXECUTE FUNCTION advance_avatar_review_version();
CREATE TRIGGER image_moderation_guard_storage_reference AFTER INSERT OR UPDATE ON public.image_moderation_records FOR EACH ROW EXECUTE FUNCTION guard_gallery_storage_reference();
CREATE TRIGGER sync_media_like_count_after_insert_delete AFTER INSERT OR DELETE ON public.media_likes FOR EACH ROW EXECUTE FUNCTION sync_media_like_count();
CREATE TRIGGER enforce_mydancr_tv_profile_video_limit AFTER INSERT OR UPDATE OF dancer_id, distribution_scope, status ON public.mydancr_tv_videos FOR EACH ROW EXECUTE FUNCTION enforce_mydancr_tv_profile_video_limit();
CREATE TRIGGER invalidate_dmca_video_enforcement AFTER DELETE OR UPDATE OF submitted_by, dancer_id, status, published_at, review_notes, reviewed_by, reviewed_at, moderation_decision, distribution_scope ON public.mydancr_tv_videos FOR EACH ROW EXECUTE FUNCTION invalidate_dmca_enforcement_state();
CREATE TRIGGER record_mydancr_tv_review_decision AFTER UPDATE OF status ON public.mydancr_tv_videos FOR EACH ROW EXECUTE FUNCTION record_mydancr_tv_review_decision();
CREATE TRIGGER validate_mydancr_tv_video_links BEFORE INSERT OR UPDATE OF dancer_id, venue_id, shift_id, venue_tag_status, venue_featured ON public.mydancr_tv_videos FOR EACH ROW EXECUTE FUNCTION validate_mydancr_tv_video_links();
CREATE TRIGGER nats_affiliate_accounts_activate_exports BEFORE INSERT OR UPDATE ON public.nats_affiliate_accounts FOR EACH ROW EXECUTE FUNCTION activate_waiting_nats_exports();
CREATE TRIGGER nats_affiliate_accounts_no_delete BEFORE DELETE ON public.nats_affiliate_accounts FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER nats_dancer_affiliate_login_unique BEFORE INSERT OR UPDATE OF login_id ON public.nats_affiliate_accounts FOR EACH ROW EXECUTE FUNCTION enforce_unique_nats_affiliate_login();
CREATE TRIGGER nats_agent_affiliate_accounts_activate_exports BEFORE UPDATE ON public.nats_agent_affiliate_accounts FOR EACH ROW EXECUTE FUNCTION activate_waiting_nats_agent_exports();
CREATE TRIGGER nats_agent_affiliate_accounts_no_delete BEFORE DELETE ON public.nats_agent_affiliate_accounts FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER nats_agent_affiliate_login_unique BEFORE INSERT OR UPDATE OF login_id ON public.nats_agent_affiliate_accounts FOR EACH ROW EXECUTE FUNCTION enforce_unique_nats_affiliate_login();
CREATE TRIGGER nats_agent_commission_exports_no_delete BEFORE DELETE ON public.nats_agent_commission_exports FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER nats_commission_exports_no_delete BEFORE DELETE ON public.nats_commission_exports FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER enforce_active_venue_nfc_capacity AFTER INSERT OR UPDATE OF venue_id, status ON public.nfc_tags FOR EACH ROW EXECUTE FUNCTION enforce_active_venue_nfc_capacity();
CREATE TRIGGER provider_webhooks_no_delete BEFORE DELETE ON public.payment_provider_webhook_events FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER reject_retired_provider_webhooks BEFORE INSERT OR UPDATE OF payment_provider ON public.payment_provider_webhook_events FOR EACH ROW EXECUTE FUNCTION reject_retired_payout_provider();
CREATE TRIGGER reject_retired_provider_settings BEFORE INSERT OR UPDATE OF payment_provider ON public.payout_settings FOR EACH ROW EXECUTE FUNCTION reject_retired_payout_provider();
CREATE TRIGGER qr_redemptions_log_issued AFTER INSERT ON public.qr_redemptions FOR EACH ROW EXECUTE FUNCTION log_qr_redemption_issued();
CREATE TRIGGER lock_sales_agent_hierarchy_writes BEFORE INSERT OR UPDATE OF sponsor_agent_id, status, commission_depth_limit ON public.sales_agents FOR EACH STATEMENT EXECUTE FUNCTION lock_sales_agent_hierarchy_writes();
CREATE TRIGGER sales_agents_no_delete BEFORE DELETE ON public.sales_agents FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER validate_sales_agent_hierarchy_trigger BEFORE INSERT OR UPDATE OF sponsor_agent_id, status, commission_depth_limit ON public.sales_agents FOR EACH ROW EXECUTE FUNCTION validate_sales_agent_hierarchy();
CREATE TRIGGER enforce_shift_verification_server_only BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION enforce_shift_verification_server_only();
CREATE TRIGGER enforce_verified_venue_affiliation_for_checkin BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION enforce_verified_venue_affiliation_for_checkin();
CREATE TRIGGER set_shift_date_from_starts_at BEFORE INSERT OR UPDATE OF starts_at, timezone, shift_date ON public.shifts FOR EACH ROW EXECUTE FUNCTION set_shift_date_from_starts_at();
CREATE TRIGGER venue_club_deal_requests_touch_updated_at BEFORE UPDATE ON public.venue_club_deal_requests FOR EACH ROW EXECUTE FUNCTION touch_venue_club_deal_request_updated_at();
CREATE TRIGGER venue_affiliation_requires_submitted_profile BEFORE INSERT OR UPDATE OF status ON public.venue_dancer_affiliations FOR EACH ROW EXECUTE FUNCTION require_submitted_dancer_profile_for_active_affiliation();
CREATE TRIGGER enforce_available_venue_ownership_claim BEFORE INSERT ON public.venue_ownership_claims FOR EACH ROW EXECUTE FUNCTION enforce_available_venue_ownership_claim();
CREATE TRIGGER venue_pilot_night_reports_touch_updated_at BEFORE UPDATE ON public.venue_pilot_night_reports FOR EACH ROW EXECUTE FUNCTION touch_venue_pilot_night_report_updated_at();
CREATE TRIGGER venue_sales_attributions_no_delete BEFORE DELETE ON public.venue_sales_attributions FOR EACH ROW EXECUTE FUNCTION prohibit_financial_record_delete();
CREATE TRIGGER venue_request_activate_manager AFTER UPDATE OF status ON public.venue_signup_requests FOR EACH ROW EXECUTE FUNCTION activate_approved_venue_request_manager();
CREATE TRIGGER venue_request_require_email_confirmation BEFORE UPDATE OF status ON public.venue_signup_requests FOR EACH ROW EXECUTE FUNCTION require_venue_request_email_confirmation();
CREATE TRIGGER venue_signup_requests_attribute_agent AFTER UPDATE OF status ON public.venue_signup_requests FOR EACH ROW WHEN (((new.status = 'approved'::text) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION attribute_approved_venue_agent_referral();
CREATE TRIGGER venue_signup_requests_touch_updated_at BEFORE UPDATE ON public.venue_signup_requests FOR EACH ROW EXECUTE FUNCTION touch_venue_signup_request_updated_at();
CREATE TRIGGER invalidate_account_pause_after_venue_decision AFTER DELETE OR UPDATE OF owner_user_id, is_active, page_review_status, published_at ON public.venues FOR EACH ROW EXECUTE FUNCTION invalidate_account_self_pause();
CREATE TRIGGER notify_venue_card_live_after_publication AFTER UPDATE OF is_active, published_at, page_review_status ON public.venues FOR EACH ROW EXECUTE FUNCTION notify_venue_card_live();
CREATE TRIGGER venues_create_default_club_deal AFTER INSERT ON public.venues FOR EACH ROW EXECUTE FUNCTION create_venue_default_club_deal();
revoke all on table public."account_recovery_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."account_self_pauses" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."admin_actions" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."agent_commission_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."app_users" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."approval_reviews" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."club_deals" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."club_finance_accounts" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."club_invoice_items" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."club_invoice_reminders" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."club_invoices" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."club_shuttle_requests" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."commission_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."content_reports" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."customer_deal_saves" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."customer_profiles" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dancer_earning_status_history" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dancer_monthly_impact" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dancer_nfc_enrollments" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dancer_payout_accounts" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dancer_payout_batches" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dancer_payout_items" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dancer_photos" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dancer_profile_slug_aliases" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dancer_profiles" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."deal_revenue_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."direction_requests" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dmca_agent_settings" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dmca_cases" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dmca_counter_notices" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dmca_enforcement_states" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."dmca_strikes" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."favorites" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."financial_audit_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."follows" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."gallery_media_reference_history" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."gallery_storage_retirements" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."going_signals" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."image_moderation_records" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."media_likes" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."mydancr_tv_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."mydancr_tv_videos" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."nats_affiliate_accounts" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."nats_agent_affiliate_accounts" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."nats_agent_commission_exports" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."nats_commission_exports" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."nfc_tags" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."nfc_tap_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."notifications" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."payment_provider_webhook_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."payout_settings" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."profile_views" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."public_dancer_profiles" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."qr_redemption_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."qr_redemptions" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."ranking_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."request_rate_limit_buckets" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."sales_agents" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."schedule_views" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."shift_location_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."shifts" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."social_clicks" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."social_links" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."subscriptions" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."support_ai_runs" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."support_messages" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."support_threads" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."trending_scores" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_activity_log" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_claim_codes" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_club_deal_requests" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_dancer_affiliation_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_dancer_affiliations" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_dancer_verification_tokens" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_follows" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_nfc_support_requests" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_ownership_claims" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_page_events" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_pilot_night_reports" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_referral_fee_change_requests" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_referral_fee_terms" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_sales_attributions" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_signup_requests" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_team_invitations" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venue_team_members" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on table public."venues" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on sequence public."dancer_earning_status_history_id_seq" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on sequence public."financial_audit_events_id_seq" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on sequence public."gallery_media_reference_history_event_id_seq" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.activate_approved_venue_request_manager() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.activate_waiting_nats_agent_exports() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.activate_waiting_nats_exports() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.admin_manage_dancer_earning(uuid,uuid,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.admin_retry_dancer_payout(uuid,uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.admin_update_payout_settings(uuid,boolean,text,integer,integer,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.advance_avatar_review_version() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.advance_dancer_avatar_version() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.agent_allocations_for_venue(uuid,integer,timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.apply_club_invoice_payment(uuid,integer,text,timestamp with time zone,text,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.apply_dmca_takedown(uuid,uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.approve_dancer_venue_affiliation_from_nfc(uuid,uuid,uuid,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.approve_dancer_venue_affiliation(text,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.approve_venue_deal_removal(uuid,uuid,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.assign_dancer_profile_link() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.attribute_approved_venue_agent_referral() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.authorize_dancer_profile_from_nfc(uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.capture_gallery_media_reference_history() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.change_venue_publication_safely(uuid,uuid,text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.claim_dancer_payout_dispatch(uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.claim_gallery_storage_retirement(uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.claim_nats_agent_commission_exports(integer) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.claim_nats_commission_exports(integer) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.claim_payment_provider_webhook(text,text,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.claim_payment_webhook_attempt(text,text,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.clear_dancer_avatar_safely(uuid,uuid,text,timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.club_deal_is_liquor_related(text,text,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.complete_dancer_payout_batch(uuid,text,timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.complete_nats_agent_commission_export(uuid,text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.complete_nats_commission_export(uuid,text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.confirm_deal_redemption_with_financial_details(text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.confirm_deal_redemption(text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.confirm_dmca_counter_forwarding(uuid,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.confirm_venue_request_email() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.consume_request_rate_limit(text,uuid,uuid,integer,integer,integer) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.create_club_invoice_draft(uuid,date,date,timestamp with time zone,uuid[]) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.create_dancer_avatar_review(uuid,uuid,text,timestamp with time zone,text,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.create_dancer_payout_batch(uuid,text,uuid[],text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.create_support_message_safely(uuid,text,uuid,text,text,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.create_venue_default_club_deal() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.create_venue_nfc_support_safely(uuid,uuid,uuid,text,text,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.current_user_role() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.enforce_active_venue_nfc_capacity() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.enforce_available_venue_ownership_claim() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.enforce_mydancr_tv_profile_video_limit() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.enforce_shift_verification_server_only() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.enforce_unique_nats_affiliate_login() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.enforce_verified_venue_affiliation_for_checkin() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[]) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.enqueue_nats_agent_commission_export() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.enqueue_nats_commission_export() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.ensure_dancer_primary_photo(uuid,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.ensure_mydancr_funded_commission() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.fail_nats_agent_commission_export(uuid,text,text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.fail_nats_commission_export(uuid,text,text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.finalize_pending_dancer_nfc_enrollment(uuid,uuid,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.finalize_platform_import_safely(uuid,uuid,text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.flag_dancer_payout_dispatch_review(uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.flag_paid_payout_recovery_safely(uuid,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.flag_reversed_nats_commission() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.flag_voided_nats_agent_commission() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.gallery_storage_family(text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.get_admin_dancer_financial_summary() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.get_dancer_earnings_summary(uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.get_due_club_invoice_reminders(timestamp with time zone,integer) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.get_mydancr_tv_metric_counts(uuid[],timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.get_public_dancer_metric_counts(uuid[],uuid[],timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.get_public_venue_metric_counts(uuid[],timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.get_ranking_metric_batch(uuid[],timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.guard_gallery_storage_reference() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.handle_new_auth_user() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.handoff_club_shuttle_request(uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.has_active_club_deal(venues) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.invalidate_account_self_pause() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.invalidate_dmca_enforcement_state() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.is_admin() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.is_current_dancer_owner(uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.is_current_venue_owner(uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.is_nats_eligible_club_deal_earning(uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.issue_and_confirm_deal_redemption_from_nfc(text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,timestamp with time zone,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.issue_dancer_venue_verification_token(uuid,uuid,uuid,text,text,timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.issue_venue_claim_code(uuid,uuid,text,timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.lock_sales_agent_hierarchy_writes() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.log_qr_redemption_issued() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.mark_dancer_payout_processing(uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.mydancr_placeholder_venue_address(text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.notify_dancer_profile_live() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.notify_venue_card_live() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.prepare_dancer_earning() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.preserve_dancer_commission_eligibility() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.process_dancer_location_verification(uuid,uuid,text,numeric,numeric,numeric,timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.prohibit_financial_record_delete() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.provision_admin_venue_nfc_tag(uuid,uuid,uuid,text,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.provision_app_account_safely(uuid,text,text,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.publish_approved_dancer_avatar(uuid,timestamp with time zone,text,jsonb,jsonb,jsonb,boolean,uuid,text,text,timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.publish_approved_dancer_gallery_photo(uuid,timestamp with time zone,text,jsonb,jsonb,jsonb,boolean,text,uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.recenter_dancer_avatar_safely(uuid,uuid,text,timestamp with time zone,text,text,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.record_account_recovery_event(text,text,text,text,integer,integer,integer) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.record_dancer_earning_status_history() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.record_deal_lifecycle_event_safely(text,text,uuid,text,text,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.record_mydancr_tv_review_decision() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.record_nfc_tag_scan(uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.redeem_venue_signup_code(uuid,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.redeem_venue_team_invitation(uuid,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.register_and_activate_dancer_tap(uuid,uuid,uuid,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.register_dancer_nfc_enrollment(uuid,uuid,uuid,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.reject_admin_venue_referral_fee_request(uuid,uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.reject_retired_payout_provider() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.release_dancer_payout_batch(uuid,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.release_pending_dancer_earnings(integer) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.request_dancer_payout(uuid,text,text,boolean) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.require_enrolled_club_deal_earning() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.require_submitted_dancer_profile_for_active_affiliation() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.require_venue_request_email_confirmation() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.restore_dmca_case(uuid,uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.review_dancer_content_safely(uuid,uuid,text,uuid,text,text,text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.review_dancer_profile_safely(uuid,uuid,text,text,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.review_venue_ownership_claim(uuid,uuid,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.review_venue_signup_request(uuid,uuid,text,uuid,text,text,timestamp with time zone) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.revoke_dancer_venue_affiliation(uuid,uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.revoke_venue_claim_code(uuid,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.rls_auto_enable() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.rotate_admin_venue_nfc_tag(uuid,uuid,uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.save_dancer_social_links_safely(uuid,uuid,jsonb,text[]) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.set_admin_sales_agent(uuid,uuid,uuid,smallint,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.set_admin_venue_nfc_tag_status(uuid,uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.set_admin_venue_referral_fee(uuid,uuid,integer,text,timestamp with time zone,text,text,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.set_shift_date_from_starts_at() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.settle_dancer_commission_event(uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.settle_deal_revenue_event(uuid,text,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.slugify(text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.submit_dmca_counter_notice_safely(uuid,uuid,jsonb) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.sync_media_like_count() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.sync_verified_auth_email() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.touch_venue_club_deal_request_updated_at() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.touch_venue_pilot_night_report_updated_at() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.touch_venue_signup_request_updated_at() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.transition_dancer_publication_safely(uuid,text,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.transition_dmca_admin_case(uuid,uuid,text,text,timestamp with time zone,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.transition_own_account_safely(uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.unique_dancer_slug(text,uuid) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.upsert_venue_pilot_night_report(uuid,uuid,date,integer,integer,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.validate_mydancr_tv_video_links() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.validate_sales_agent_hierarchy() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.void_agent_commissions_with_revenue() from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on function public.void_generated_deal_redemption(uuid,text) from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on type public."account_state" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on type public."dancer_status" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on type public."notification_channel" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on type public."notification_type" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on type public."review_status" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on type public."shift_status" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on type public."social_platform" from PUBLIC,"postgres","anon","authenticated","service_role";
revoke all on type public."user_role" from PUBLIC,"postgres","anon","authenticated","service_role";
grant DELETE on table public."account_recovery_events" to "postgres";
grant INSERT on table public."account_recovery_events" to "postgres";
grant MAINTAIN on table public."account_recovery_events" to "postgres";
grant REFERENCES on table public."account_recovery_events" to "postgres";
grant SELECT on table public."account_recovery_events" to "postgres";
grant TRIGGER on table public."account_recovery_events" to "postgres";
grant TRUNCATE on table public."account_recovery_events" to "postgres";
grant UPDATE on table public."account_recovery_events" to "postgres";
grant DELETE on table public."account_recovery_events" to "service_role";
grant INSERT on table public."account_recovery_events" to "service_role";
grant MAINTAIN on table public."account_recovery_events" to "service_role";
grant REFERENCES on table public."account_recovery_events" to "service_role";
grant SELECT on table public."account_recovery_events" to "service_role";
grant TRIGGER on table public."account_recovery_events" to "service_role";
grant TRUNCATE on table public."account_recovery_events" to "service_role";
grant UPDATE on table public."account_recovery_events" to "service_role";
grant DELETE on table public."account_self_pauses" to "postgres";
grant INSERT on table public."account_self_pauses" to "postgres";
grant MAINTAIN on table public."account_self_pauses" to "postgres";
grant REFERENCES on table public."account_self_pauses" to "postgres";
grant SELECT on table public."account_self_pauses" to "postgres";
grant TRIGGER on table public."account_self_pauses" to "postgres";
grant TRUNCATE on table public."account_self_pauses" to "postgres";
grant UPDATE on table public."account_self_pauses" to "postgres";
grant DELETE on table public."account_self_pauses" to "service_role";
grant INSERT on table public."account_self_pauses" to "service_role";
grant SELECT on table public."account_self_pauses" to "service_role";
grant UPDATE on table public."account_self_pauses" to "service_role";
grant SELECT on table public."admin_actions" to "authenticated";
grant DELETE on table public."admin_actions" to "postgres";
grant INSERT on table public."admin_actions" to "postgres";
grant MAINTAIN on table public."admin_actions" to "postgres";
grant REFERENCES on table public."admin_actions" to "postgres";
grant SELECT on table public."admin_actions" to "postgres";
grant TRIGGER on table public."admin_actions" to "postgres";
grant TRUNCATE on table public."admin_actions" to "postgres";
grant UPDATE on table public."admin_actions" to "postgres";
grant DELETE on table public."admin_actions" to "service_role";
grant INSERT on table public."admin_actions" to "service_role";
grant MAINTAIN on table public."admin_actions" to "service_role";
grant REFERENCES on table public."admin_actions" to "service_role";
grant SELECT on table public."admin_actions" to "service_role";
grant TRIGGER on table public."admin_actions" to "service_role";
grant TRUNCATE on table public."admin_actions" to "service_role";
grant UPDATE on table public."admin_actions" to "service_role";
grant SELECT on table public."agent_commission_events" to "anon";
grant DELETE on table public."agent_commission_events" to "authenticated";
grant INSERT on table public."agent_commission_events" to "authenticated";
grant SELECT on table public."agent_commission_events" to "authenticated";
grant UPDATE on table public."agent_commission_events" to "authenticated";
grant DELETE on table public."agent_commission_events" to "postgres";
grant INSERT on table public."agent_commission_events" to "postgres";
grant MAINTAIN on table public."agent_commission_events" to "postgres";
grant REFERENCES on table public."agent_commission_events" to "postgres";
grant SELECT on table public."agent_commission_events" to "postgres";
grant TRIGGER on table public."agent_commission_events" to "postgres";
grant TRUNCATE on table public."agent_commission_events" to "postgres";
grant UPDATE on table public."agent_commission_events" to "postgres";
grant DELETE on table public."agent_commission_events" to "service_role";
grant INSERT on table public."agent_commission_events" to "service_role";
grant MAINTAIN on table public."agent_commission_events" to "service_role";
grant REFERENCES on table public."agent_commission_events" to "service_role";
grant SELECT on table public."agent_commission_events" to "service_role";
grant TRIGGER on table public."agent_commission_events" to "service_role";
grant TRUNCATE on table public."agent_commission_events" to "service_role";
grant UPDATE on table public."agent_commission_events" to "service_role";
grant SELECT on table public."app_users" to "anon";
grant SELECT on table public."app_users" to "authenticated";
grant DELETE on table public."app_users" to "postgres";
grant INSERT on table public."app_users" to "postgres";
grant MAINTAIN on table public."app_users" to "postgres";
grant REFERENCES on table public."app_users" to "postgres";
grant SELECT on table public."app_users" to "postgres";
grant TRIGGER on table public."app_users" to "postgres";
grant TRUNCATE on table public."app_users" to "postgres";
grant UPDATE on table public."app_users" to "postgres";
grant DELETE on table public."app_users" to "service_role";
grant INSERT on table public."app_users" to "service_role";
grant MAINTAIN on table public."app_users" to "service_role";
grant REFERENCES on table public."app_users" to "service_role";
grant SELECT on table public."app_users" to "service_role";
grant TRIGGER on table public."app_users" to "service_role";
grant TRUNCATE on table public."app_users" to "service_role";
grant SELECT on table public."approval_reviews" to "anon";
grant DELETE on table public."approval_reviews" to "authenticated";
grant INSERT on table public."approval_reviews" to "authenticated";
grant SELECT on table public."approval_reviews" to "authenticated";
grant UPDATE on table public."approval_reviews" to "authenticated";
grant DELETE on table public."approval_reviews" to "postgres";
grant INSERT on table public."approval_reviews" to "postgres";
grant MAINTAIN on table public."approval_reviews" to "postgres";
grant REFERENCES on table public."approval_reviews" to "postgres";
grant SELECT on table public."approval_reviews" to "postgres";
grant TRIGGER on table public."approval_reviews" to "postgres";
grant TRUNCATE on table public."approval_reviews" to "postgres";
grant UPDATE on table public."approval_reviews" to "postgres";
grant DELETE on table public."approval_reviews" to "service_role";
grant INSERT on table public."approval_reviews" to "service_role";
grant MAINTAIN on table public."approval_reviews" to "service_role";
grant REFERENCES on table public."approval_reviews" to "service_role";
grant SELECT on table public."approval_reviews" to "service_role";
grant TRIGGER on table public."approval_reviews" to "service_role";
grant TRUNCATE on table public."approval_reviews" to "service_role";
grant UPDATE on table public."approval_reviews" to "service_role";
grant DELETE on table public."club_deals" to "postgres";
grant INSERT on table public."club_deals" to "postgres";
grant MAINTAIN on table public."club_deals" to "postgres";
grant REFERENCES on table public."club_deals" to "postgres";
grant SELECT on table public."club_deals" to "postgres";
grant TRIGGER on table public."club_deals" to "postgres";
grant TRUNCATE on table public."club_deals" to "postgres";
grant UPDATE on table public."club_deals" to "postgres";
grant DELETE on table public."club_deals" to "service_role";
grant INSERT on table public."club_deals" to "service_role";
grant MAINTAIN on table public."club_deals" to "service_role";
grant REFERENCES on table public."club_deals" to "service_role";
grant SELECT on table public."club_deals" to "service_role";
grant TRIGGER on table public."club_deals" to "service_role";
grant TRUNCATE on table public."club_deals" to "service_role";
grant UPDATE on table public."club_deals" to "service_role";
grant SELECT on table public."club_finance_accounts" to "anon";
grant DELETE on table public."club_finance_accounts" to "authenticated";
grant INSERT on table public."club_finance_accounts" to "authenticated";
grant SELECT on table public."club_finance_accounts" to "authenticated";
grant UPDATE on table public."club_finance_accounts" to "authenticated";
grant DELETE on table public."club_finance_accounts" to "postgres";
grant INSERT on table public."club_finance_accounts" to "postgres";
grant MAINTAIN on table public."club_finance_accounts" to "postgres";
grant REFERENCES on table public."club_finance_accounts" to "postgres";
grant SELECT on table public."club_finance_accounts" to "postgres";
grant TRIGGER on table public."club_finance_accounts" to "postgres";
grant TRUNCATE on table public."club_finance_accounts" to "postgres";
grant UPDATE on table public."club_finance_accounts" to "postgres";
grant DELETE on table public."club_finance_accounts" to "service_role";
grant INSERT on table public."club_finance_accounts" to "service_role";
grant MAINTAIN on table public."club_finance_accounts" to "service_role";
grant REFERENCES on table public."club_finance_accounts" to "service_role";
grant SELECT on table public."club_finance_accounts" to "service_role";
grant TRIGGER on table public."club_finance_accounts" to "service_role";
grant TRUNCATE on table public."club_finance_accounts" to "service_role";
grant UPDATE on table public."club_finance_accounts" to "service_role";
grant SELECT on table public."club_invoice_items" to "anon";
grant DELETE on table public."club_invoice_items" to "authenticated";
grant INSERT on table public."club_invoice_items" to "authenticated";
grant SELECT on table public."club_invoice_items" to "authenticated";
grant UPDATE on table public."club_invoice_items" to "authenticated";
grant DELETE on table public."club_invoice_items" to "postgres";
grant INSERT on table public."club_invoice_items" to "postgres";
grant MAINTAIN on table public."club_invoice_items" to "postgres";
grant REFERENCES on table public."club_invoice_items" to "postgres";
grant SELECT on table public."club_invoice_items" to "postgres";
grant TRIGGER on table public."club_invoice_items" to "postgres";
grant TRUNCATE on table public."club_invoice_items" to "postgres";
grant UPDATE on table public."club_invoice_items" to "postgres";
grant DELETE on table public."club_invoice_items" to "service_role";
grant INSERT on table public."club_invoice_items" to "service_role";
grant MAINTAIN on table public."club_invoice_items" to "service_role";
grant REFERENCES on table public."club_invoice_items" to "service_role";
grant SELECT on table public."club_invoice_items" to "service_role";
grant TRIGGER on table public."club_invoice_items" to "service_role";
grant TRUNCATE on table public."club_invoice_items" to "service_role";
grant UPDATE on table public."club_invoice_items" to "service_role";
grant SELECT on table public."club_invoice_reminders" to "anon";
grant DELETE on table public."club_invoice_reminders" to "authenticated";
grant INSERT on table public."club_invoice_reminders" to "authenticated";
grant SELECT on table public."club_invoice_reminders" to "authenticated";
grant UPDATE on table public."club_invoice_reminders" to "authenticated";
grant DELETE on table public."club_invoice_reminders" to "postgres";
grant INSERT on table public."club_invoice_reminders" to "postgres";
grant MAINTAIN on table public."club_invoice_reminders" to "postgres";
grant REFERENCES on table public."club_invoice_reminders" to "postgres";
grant SELECT on table public."club_invoice_reminders" to "postgres";
grant TRIGGER on table public."club_invoice_reminders" to "postgres";
grant TRUNCATE on table public."club_invoice_reminders" to "postgres";
grant UPDATE on table public."club_invoice_reminders" to "postgres";
grant DELETE on table public."club_invoice_reminders" to "service_role";
grant INSERT on table public."club_invoice_reminders" to "service_role";
grant MAINTAIN on table public."club_invoice_reminders" to "service_role";
grant REFERENCES on table public."club_invoice_reminders" to "service_role";
grant SELECT on table public."club_invoice_reminders" to "service_role";
grant TRIGGER on table public."club_invoice_reminders" to "service_role";
grant TRUNCATE on table public."club_invoice_reminders" to "service_role";
grant UPDATE on table public."club_invoice_reminders" to "service_role";
grant SELECT on table public."club_invoices" to "anon";
grant DELETE on table public."club_invoices" to "authenticated";
grant INSERT on table public."club_invoices" to "authenticated";
grant SELECT on table public."club_invoices" to "authenticated";
grant UPDATE on table public."club_invoices" to "authenticated";
grant DELETE on table public."club_invoices" to "postgres";
grant INSERT on table public."club_invoices" to "postgres";
grant MAINTAIN on table public."club_invoices" to "postgres";
grant REFERENCES on table public."club_invoices" to "postgres";
grant SELECT on table public."club_invoices" to "postgres";
grant TRIGGER on table public."club_invoices" to "postgres";
grant TRUNCATE on table public."club_invoices" to "postgres";
grant UPDATE on table public."club_invoices" to "postgres";
grant DELETE on table public."club_invoices" to "service_role";
grant INSERT on table public."club_invoices" to "service_role";
grant MAINTAIN on table public."club_invoices" to "service_role";
grant REFERENCES on table public."club_invoices" to "service_role";
grant SELECT on table public."club_invoices" to "service_role";
grant TRIGGER on table public."club_invoices" to "service_role";
grant TRUNCATE on table public."club_invoices" to "service_role";
grant UPDATE on table public."club_invoices" to "service_role";
grant DELETE on table public."club_shuttle_requests" to "postgres";
grant INSERT on table public."club_shuttle_requests" to "postgres";
grant MAINTAIN on table public."club_shuttle_requests" to "postgres";
grant REFERENCES on table public."club_shuttle_requests" to "postgres";
grant SELECT on table public."club_shuttle_requests" to "postgres";
grant TRIGGER on table public."club_shuttle_requests" to "postgres";
grant TRUNCATE on table public."club_shuttle_requests" to "postgres";
grant UPDATE on table public."club_shuttle_requests" to "postgres";
grant INSERT on table public."club_shuttle_requests" to "service_role";
grant SELECT on table public."club_shuttle_requests" to "service_role";
grant SELECT on table public."commission_events" to "anon";
grant SELECT on table public."commission_events" to "authenticated";
grant DELETE on table public."commission_events" to "postgres";
grant INSERT on table public."commission_events" to "postgres";
grant MAINTAIN on table public."commission_events" to "postgres";
grant REFERENCES on table public."commission_events" to "postgres";
grant SELECT on table public."commission_events" to "postgres";
grant TRIGGER on table public."commission_events" to "postgres";
grant TRUNCATE on table public."commission_events" to "postgres";
grant UPDATE on table public."commission_events" to "postgres";
grant DELETE on table public."commission_events" to "service_role";
grant INSERT on table public."commission_events" to "service_role";
grant MAINTAIN on table public."commission_events" to "service_role";
grant REFERENCES on table public."commission_events" to "service_role";
grant SELECT on table public."commission_events" to "service_role";
grant TRIGGER on table public."commission_events" to "service_role";
grant TRUNCATE on table public."commission_events" to "service_role";
grant UPDATE on table public."commission_events" to "service_role";
grant SELECT on table public."content_reports" to "anon";
grant DELETE on table public."content_reports" to "authenticated";
grant SELECT on table public."content_reports" to "authenticated";
grant UPDATE on table public."content_reports" to "authenticated";
grant DELETE on table public."content_reports" to "postgres";
grant INSERT on table public."content_reports" to "postgres";
grant MAINTAIN on table public."content_reports" to "postgres";
grant REFERENCES on table public."content_reports" to "postgres";
grant SELECT on table public."content_reports" to "postgres";
grant TRIGGER on table public."content_reports" to "postgres";
grant TRUNCATE on table public."content_reports" to "postgres";
grant UPDATE on table public."content_reports" to "postgres";
grant DELETE on table public."content_reports" to "service_role";
grant INSERT on table public."content_reports" to "service_role";
grant MAINTAIN on table public."content_reports" to "service_role";
grant REFERENCES on table public."content_reports" to "service_role";
grant SELECT on table public."content_reports" to "service_role";
grant TRIGGER on table public."content_reports" to "service_role";
grant TRUNCATE on table public."content_reports" to "service_role";
grant UPDATE on table public."content_reports" to "service_role";
grant DELETE on table public."customer_deal_saves" to "authenticated";
grant INSERT on table public."customer_deal_saves" to "authenticated";
grant SELECT on table public."customer_deal_saves" to "authenticated";
grant DELETE on table public."customer_deal_saves" to "postgres";
grant INSERT on table public."customer_deal_saves" to "postgres";
grant MAINTAIN on table public."customer_deal_saves" to "postgres";
grant REFERENCES on table public."customer_deal_saves" to "postgres";
grant SELECT on table public."customer_deal_saves" to "postgres";
grant TRIGGER on table public."customer_deal_saves" to "postgres";
grant TRUNCATE on table public."customer_deal_saves" to "postgres";
grant UPDATE on table public."customer_deal_saves" to "postgres";
grant DELETE on table public."customer_deal_saves" to "service_role";
grant INSERT on table public."customer_deal_saves" to "service_role";
grant MAINTAIN on table public."customer_deal_saves" to "service_role";
grant REFERENCES on table public."customer_deal_saves" to "service_role";
grant SELECT on table public."customer_deal_saves" to "service_role";
grant TRIGGER on table public."customer_deal_saves" to "service_role";
grant TRUNCATE on table public."customer_deal_saves" to "service_role";
grant UPDATE on table public."customer_deal_saves" to "service_role";
grant SELECT on table public."customer_profiles" to "anon";
grant DELETE on table public."customer_profiles" to "authenticated";
grant INSERT on table public."customer_profiles" to "authenticated";
grant SELECT on table public."customer_profiles" to "authenticated";
grant UPDATE on table public."customer_profiles" to "authenticated";
grant DELETE on table public."customer_profiles" to "postgres";
grant INSERT on table public."customer_profiles" to "postgres";
grant MAINTAIN on table public."customer_profiles" to "postgres";
grant REFERENCES on table public."customer_profiles" to "postgres";
grant SELECT on table public."customer_profiles" to "postgres";
grant TRIGGER on table public."customer_profiles" to "postgres";
grant TRUNCATE on table public."customer_profiles" to "postgres";
grant UPDATE on table public."customer_profiles" to "postgres";
grant DELETE on table public."customer_profiles" to "service_role";
grant INSERT on table public."customer_profiles" to "service_role";
grant MAINTAIN on table public."customer_profiles" to "service_role";
grant REFERENCES on table public."customer_profiles" to "service_role";
grant SELECT on table public."customer_profiles" to "service_role";
grant TRIGGER on table public."customer_profiles" to "service_role";
grant TRUNCATE on table public."customer_profiles" to "service_role";
grant UPDATE on table public."customer_profiles" to "service_role";
grant SELECT on table public."dancer_earning_status_history" to "anon";
grant SELECT on table public."dancer_earning_status_history" to "authenticated";
grant DELETE on table public."dancer_earning_status_history" to "postgres";
grant INSERT on table public."dancer_earning_status_history" to "postgres";
grant MAINTAIN on table public."dancer_earning_status_history" to "postgres";
grant REFERENCES on table public."dancer_earning_status_history" to "postgres";
grant SELECT on table public."dancer_earning_status_history" to "postgres";
grant TRIGGER on table public."dancer_earning_status_history" to "postgres";
grant TRUNCATE on table public."dancer_earning_status_history" to "postgres";
grant UPDATE on table public."dancer_earning_status_history" to "postgres";
grant DELETE on table public."dancer_earning_status_history" to "service_role";
grant INSERT on table public."dancer_earning_status_history" to "service_role";
grant MAINTAIN on table public."dancer_earning_status_history" to "service_role";
grant REFERENCES on table public."dancer_earning_status_history" to "service_role";
grant SELECT on table public."dancer_earning_status_history" to "service_role";
grant TRIGGER on table public."dancer_earning_status_history" to "service_role";
grant TRUNCATE on table public."dancer_earning_status_history" to "service_role";
grant UPDATE on table public."dancer_earning_status_history" to "service_role";
grant USAGE on sequence public."dancer_earning_status_history_id_seq" to "postgres";
grant DELETE on table public."dancer_monthly_impact" to "postgres";
grant INSERT on table public."dancer_monthly_impact" to "postgres";
grant MAINTAIN on table public."dancer_monthly_impact" to "postgres";
grant REFERENCES on table public."dancer_monthly_impact" to "postgres";
grant SELECT on table public."dancer_monthly_impact" to "postgres";
grant TRIGGER on table public."dancer_monthly_impact" to "postgres";
grant TRUNCATE on table public."dancer_monthly_impact" to "postgres";
grant UPDATE on table public."dancer_monthly_impact" to "postgres";
grant DELETE on table public."dancer_monthly_impact" to "service_role";
grant INSERT on table public."dancer_monthly_impact" to "service_role";
grant MAINTAIN on table public."dancer_monthly_impact" to "service_role";
grant REFERENCES on table public."dancer_monthly_impact" to "service_role";
grant SELECT on table public."dancer_monthly_impact" to "service_role";
grant TRIGGER on table public."dancer_monthly_impact" to "service_role";
grant TRUNCATE on table public."dancer_monthly_impact" to "service_role";
grant UPDATE on table public."dancer_monthly_impact" to "service_role";
grant SELECT on table public."dancer_nfc_enrollments" to "anon";
grant DELETE on table public."dancer_nfc_enrollments" to "authenticated";
grant INSERT on table public."dancer_nfc_enrollments" to "authenticated";
grant SELECT on table public."dancer_nfc_enrollments" to "authenticated";
grant UPDATE on table public."dancer_nfc_enrollments" to "authenticated";
grant DELETE on table public."dancer_nfc_enrollments" to "postgres";
grant INSERT on table public."dancer_nfc_enrollments" to "postgres";
grant MAINTAIN on table public."dancer_nfc_enrollments" to "postgres";
grant REFERENCES on table public."dancer_nfc_enrollments" to "postgres";
grant SELECT on table public."dancer_nfc_enrollments" to "postgres";
grant TRIGGER on table public."dancer_nfc_enrollments" to "postgres";
grant TRUNCATE on table public."dancer_nfc_enrollments" to "postgres";
grant UPDATE on table public."dancer_nfc_enrollments" to "postgres";
grant DELETE on table public."dancer_nfc_enrollments" to "service_role";
grant INSERT on table public."dancer_nfc_enrollments" to "service_role";
grant MAINTAIN on table public."dancer_nfc_enrollments" to "service_role";
grant REFERENCES on table public."dancer_nfc_enrollments" to "service_role";
grant SELECT on table public."dancer_nfc_enrollments" to "service_role";
grant TRIGGER on table public."dancer_nfc_enrollments" to "service_role";
grant TRUNCATE on table public."dancer_nfc_enrollments" to "service_role";
grant UPDATE on table public."dancer_nfc_enrollments" to "service_role";
grant SELECT on table public."dancer_payout_accounts" to "anon";
grant SELECT on table public."dancer_payout_accounts" to "authenticated";
grant DELETE on table public."dancer_payout_accounts" to "postgres";
grant INSERT on table public."dancer_payout_accounts" to "postgres";
grant MAINTAIN on table public."dancer_payout_accounts" to "postgres";
grant REFERENCES on table public."dancer_payout_accounts" to "postgres";
grant SELECT on table public."dancer_payout_accounts" to "postgres";
grant TRIGGER on table public."dancer_payout_accounts" to "postgres";
grant TRUNCATE on table public."dancer_payout_accounts" to "postgres";
grant UPDATE on table public."dancer_payout_accounts" to "postgres";
grant DELETE on table public."dancer_payout_accounts" to "service_role";
grant INSERT on table public."dancer_payout_accounts" to "service_role";
grant MAINTAIN on table public."dancer_payout_accounts" to "service_role";
grant REFERENCES on table public."dancer_payout_accounts" to "service_role";
grant SELECT on table public."dancer_payout_accounts" to "service_role";
grant TRIGGER on table public."dancer_payout_accounts" to "service_role";
grant TRUNCATE on table public."dancer_payout_accounts" to "service_role";
grant UPDATE on table public."dancer_payout_accounts" to "service_role";
grant SELECT on table public."dancer_payout_batches" to "anon";
grant SELECT on table public."dancer_payout_batches" to "authenticated";
grant DELETE on table public."dancer_payout_batches" to "postgres";
grant INSERT on table public."dancer_payout_batches" to "postgres";
grant MAINTAIN on table public."dancer_payout_batches" to "postgres";
grant REFERENCES on table public."dancer_payout_batches" to "postgres";
grant SELECT on table public."dancer_payout_batches" to "postgres";
grant TRIGGER on table public."dancer_payout_batches" to "postgres";
grant TRUNCATE on table public."dancer_payout_batches" to "postgres";
grant UPDATE on table public."dancer_payout_batches" to "postgres";
grant DELETE on table public."dancer_payout_batches" to "service_role";
grant INSERT on table public."dancer_payout_batches" to "service_role";
grant MAINTAIN on table public."dancer_payout_batches" to "service_role";
grant REFERENCES on table public."dancer_payout_batches" to "service_role";
grant SELECT on table public."dancer_payout_batches" to "service_role";
grant TRIGGER on table public."dancer_payout_batches" to "service_role";
grant TRUNCATE on table public."dancer_payout_batches" to "service_role";
grant UPDATE on table public."dancer_payout_batches" to "service_role";
grant SELECT on table public."dancer_payout_items" to "anon";
grant SELECT on table public."dancer_payout_items" to "authenticated";
grant DELETE on table public."dancer_payout_items" to "postgres";
grant INSERT on table public."dancer_payout_items" to "postgres";
grant MAINTAIN on table public."dancer_payout_items" to "postgres";
grant REFERENCES on table public."dancer_payout_items" to "postgres";
grant SELECT on table public."dancer_payout_items" to "postgres";
grant TRIGGER on table public."dancer_payout_items" to "postgres";
grant TRUNCATE on table public."dancer_payout_items" to "postgres";
grant UPDATE on table public."dancer_payout_items" to "postgres";
grant DELETE on table public."dancer_payout_items" to "service_role";
grant INSERT on table public."dancer_payout_items" to "service_role";
grant MAINTAIN on table public."dancer_payout_items" to "service_role";
grant REFERENCES on table public."dancer_payout_items" to "service_role";
grant SELECT on table public."dancer_payout_items" to "service_role";
grant TRIGGER on table public."dancer_payout_items" to "service_role";
grant TRUNCATE on table public."dancer_payout_items" to "service_role";
grant UPDATE on table public."dancer_payout_items" to "service_role";
grant SELECT on table public."dancer_photos" to "anon";
grant SELECT on table public."dancer_photos" to "authenticated";
grant DELETE on table public."dancer_photos" to "postgres";
grant INSERT on table public."dancer_photos" to "postgres";
grant MAINTAIN on table public."dancer_photos" to "postgres";
grant REFERENCES on table public."dancer_photos" to "postgres";
grant SELECT on table public."dancer_photos" to "postgres";
grant TRIGGER on table public."dancer_photos" to "postgres";
grant TRUNCATE on table public."dancer_photos" to "postgres";
grant UPDATE on table public."dancer_photos" to "postgres";
grant DELETE on table public."dancer_photos" to "service_role";
grant INSERT on table public."dancer_photos" to "service_role";
grant MAINTAIN on table public."dancer_photos" to "service_role";
grant REFERENCES on table public."dancer_photos" to "service_role";
grant SELECT on table public."dancer_photos" to "service_role";
grant TRIGGER on table public."dancer_photos" to "service_role";
grant TRUNCATE on table public."dancer_photos" to "service_role";
grant UPDATE on table public."dancer_photos" to "service_role";
grant DELETE on table public."dancer_profile_slug_aliases" to "postgres";
grant INSERT on table public."dancer_profile_slug_aliases" to "postgres";
grant MAINTAIN on table public."dancer_profile_slug_aliases" to "postgres";
grant REFERENCES on table public."dancer_profile_slug_aliases" to "postgres";
grant SELECT on table public."dancer_profile_slug_aliases" to "postgres";
grant TRIGGER on table public."dancer_profile_slug_aliases" to "postgres";
grant TRUNCATE on table public."dancer_profile_slug_aliases" to "postgres";
grant UPDATE on table public."dancer_profile_slug_aliases" to "postgres";
grant DELETE on table public."dancer_profile_slug_aliases" to "service_role";
grant INSERT on table public."dancer_profile_slug_aliases" to "service_role";
grant MAINTAIN on table public."dancer_profile_slug_aliases" to "service_role";
grant REFERENCES on table public."dancer_profile_slug_aliases" to "service_role";
grant SELECT on table public."dancer_profile_slug_aliases" to "service_role";
grant TRIGGER on table public."dancer_profile_slug_aliases" to "service_role";
grant TRUNCATE on table public."dancer_profile_slug_aliases" to "service_role";
grant UPDATE on table public."dancer_profile_slug_aliases" to "service_role";
grant DELETE on table public."dancer_profiles" to "postgres";
grant INSERT on table public."dancer_profiles" to "postgres";
grant MAINTAIN on table public."dancer_profiles" to "postgres";
grant REFERENCES on table public."dancer_profiles" to "postgres";
grant SELECT on table public."dancer_profiles" to "postgres";
grant TRIGGER on table public."dancer_profiles" to "postgres";
grant TRUNCATE on table public."dancer_profiles" to "postgres";
grant UPDATE on table public."dancer_profiles" to "postgres";
grant DELETE on table public."dancer_profiles" to "service_role";
grant INSERT on table public."dancer_profiles" to "service_role";
grant MAINTAIN on table public."dancer_profiles" to "service_role";
grant REFERENCES on table public."dancer_profiles" to "service_role";
grant SELECT on table public."dancer_profiles" to "service_role";
grant TRIGGER on table public."dancer_profiles" to "service_role";
grant TRUNCATE on table public."dancer_profiles" to "service_role";
grant UPDATE on table public."dancer_profiles" to "service_role";
grant SELECT on table public."deal_revenue_events" to "anon";
grant DELETE on table public."deal_revenue_events" to "authenticated";
grant INSERT on table public."deal_revenue_events" to "authenticated";
grant SELECT on table public."deal_revenue_events" to "authenticated";
grant UPDATE on table public."deal_revenue_events" to "authenticated";
grant DELETE on table public."deal_revenue_events" to "postgres";
grant INSERT on table public."deal_revenue_events" to "postgres";
grant MAINTAIN on table public."deal_revenue_events" to "postgres";
grant REFERENCES on table public."deal_revenue_events" to "postgres";
grant SELECT on table public."deal_revenue_events" to "postgres";
grant TRIGGER on table public."deal_revenue_events" to "postgres";
grant TRUNCATE on table public."deal_revenue_events" to "postgres";
grant UPDATE on table public."deal_revenue_events" to "postgres";
grant DELETE on table public."deal_revenue_events" to "service_role";
grant INSERT on table public."deal_revenue_events" to "service_role";
grant MAINTAIN on table public."deal_revenue_events" to "service_role";
grant REFERENCES on table public."deal_revenue_events" to "service_role";
grant SELECT on table public."deal_revenue_events" to "service_role";
grant TRIGGER on table public."deal_revenue_events" to "service_role";
grant TRUNCATE on table public."deal_revenue_events" to "service_role";
grant UPDATE on table public."deal_revenue_events" to "service_role";
grant SELECT on table public."direction_requests" to "anon";
grant SELECT on table public."direction_requests" to "authenticated";
grant DELETE on table public."direction_requests" to "postgres";
grant INSERT on table public."direction_requests" to "postgres";
grant MAINTAIN on table public."direction_requests" to "postgres";
grant REFERENCES on table public."direction_requests" to "postgres";
grant SELECT on table public."direction_requests" to "postgres";
grant TRIGGER on table public."direction_requests" to "postgres";
grant TRUNCATE on table public."direction_requests" to "postgres";
grant UPDATE on table public."direction_requests" to "postgres";
grant DELETE on table public."direction_requests" to "service_role";
grant INSERT on table public."direction_requests" to "service_role";
grant MAINTAIN on table public."direction_requests" to "service_role";
grant REFERENCES on table public."direction_requests" to "service_role";
grant SELECT on table public."direction_requests" to "service_role";
grant TRIGGER on table public."direction_requests" to "service_role";
grant TRUNCATE on table public."direction_requests" to "service_role";
grant UPDATE on table public."direction_requests" to "service_role";
grant DELETE on table public."dmca_agent_settings" to "authenticated";
grant INSERT on table public."dmca_agent_settings" to "authenticated";
grant SELECT on table public."dmca_agent_settings" to "authenticated";
grant UPDATE on table public."dmca_agent_settings" to "authenticated";
grant DELETE on table public."dmca_agent_settings" to "postgres";
grant INSERT on table public."dmca_agent_settings" to "postgres";
grant MAINTAIN on table public."dmca_agent_settings" to "postgres";
grant REFERENCES on table public."dmca_agent_settings" to "postgres";
grant SELECT on table public."dmca_agent_settings" to "postgres";
grant TRIGGER on table public."dmca_agent_settings" to "postgres";
grant TRUNCATE on table public."dmca_agent_settings" to "postgres";
grant UPDATE on table public."dmca_agent_settings" to "postgres";
grant DELETE on table public."dmca_agent_settings" to "service_role";
grant INSERT on table public."dmca_agent_settings" to "service_role";
grant MAINTAIN on table public."dmca_agent_settings" to "service_role";
grant REFERENCES on table public."dmca_agent_settings" to "service_role";
grant SELECT on table public."dmca_agent_settings" to "service_role";
grant TRIGGER on table public."dmca_agent_settings" to "service_role";
grant TRUNCATE on table public."dmca_agent_settings" to "service_role";
grant UPDATE on table public."dmca_agent_settings" to "service_role";
grant SELECT on table public."dmca_cases" to "anon";
grant SELECT on table public."dmca_cases" to "authenticated";
grant DELETE on table public."dmca_cases" to "postgres";
grant INSERT on table public."dmca_cases" to "postgres";
grant MAINTAIN on table public."dmca_cases" to "postgres";
grant REFERENCES on table public."dmca_cases" to "postgres";
grant SELECT on table public."dmca_cases" to "postgres";
grant TRIGGER on table public."dmca_cases" to "postgres";
grant TRUNCATE on table public."dmca_cases" to "postgres";
grant UPDATE on table public."dmca_cases" to "postgres";
grant INSERT on table public."dmca_cases" to "service_role";
grant MAINTAIN on table public."dmca_cases" to "service_role";
grant REFERENCES on table public."dmca_cases" to "service_role";
grant SELECT on table public."dmca_cases" to "service_role";
grant TRIGGER on table public."dmca_cases" to "service_role";
grant TRUNCATE on table public."dmca_cases" to "service_role";
grant SELECT on table public."dmca_counter_notices" to "anon";
grant SELECT on table public."dmca_counter_notices" to "authenticated";
grant DELETE on table public."dmca_counter_notices" to "postgres";
grant INSERT on table public."dmca_counter_notices" to "postgres";
grant MAINTAIN on table public."dmca_counter_notices" to "postgres";
grant REFERENCES on table public."dmca_counter_notices" to "postgres";
grant SELECT on table public."dmca_counter_notices" to "postgres";
grant TRIGGER on table public."dmca_counter_notices" to "postgres";
grant TRUNCATE on table public."dmca_counter_notices" to "postgres";
grant UPDATE on table public."dmca_counter_notices" to "postgres";
grant MAINTAIN on table public."dmca_counter_notices" to "service_role";
grant REFERENCES on table public."dmca_counter_notices" to "service_role";
grant SELECT on table public."dmca_counter_notices" to "service_role";
grant TRIGGER on table public."dmca_counter_notices" to "service_role";
grant TRUNCATE on table public."dmca_counter_notices" to "service_role";
grant DELETE on table public."dmca_enforcement_states" to "postgres";
grant INSERT on table public."dmca_enforcement_states" to "postgres";
grant MAINTAIN on table public."dmca_enforcement_states" to "postgres";
grant REFERENCES on table public."dmca_enforcement_states" to "postgres";
grant SELECT on table public."dmca_enforcement_states" to "postgres";
grant TRIGGER on table public."dmca_enforcement_states" to "postgres";
grant TRUNCATE on table public."dmca_enforcement_states" to "postgres";
grant UPDATE on table public."dmca_enforcement_states" to "postgres";
grant DELETE on table public."dmca_enforcement_states" to "service_role";
grant INSERT on table public."dmca_enforcement_states" to "service_role";
grant SELECT on table public."dmca_enforcement_states" to "service_role";
grant UPDATE on table public."dmca_enforcement_states" to "service_role";
grant SELECT on table public."dmca_strikes" to "anon";
grant SELECT on table public."dmca_strikes" to "authenticated";
grant DELETE on table public."dmca_strikes" to "postgres";
grant INSERT on table public."dmca_strikes" to "postgres";
grant MAINTAIN on table public."dmca_strikes" to "postgres";
grant REFERENCES on table public."dmca_strikes" to "postgres";
grant SELECT on table public."dmca_strikes" to "postgres";
grant TRIGGER on table public."dmca_strikes" to "postgres";
grant TRUNCATE on table public."dmca_strikes" to "postgres";
grant UPDATE on table public."dmca_strikes" to "postgres";
grant MAINTAIN on table public."dmca_strikes" to "service_role";
grant REFERENCES on table public."dmca_strikes" to "service_role";
grant SELECT on table public."dmca_strikes" to "service_role";
grant TRIGGER on table public."dmca_strikes" to "service_role";
grant TRUNCATE on table public."dmca_strikes" to "service_role";
grant SELECT on table public."favorites" to "anon";
grant DELETE on table public."favorites" to "authenticated";
grant INSERT on table public."favorites" to "authenticated";
grant SELECT on table public."favorites" to "authenticated";
grant UPDATE on table public."favorites" to "authenticated";
grant DELETE on table public."favorites" to "postgres";
grant INSERT on table public."favorites" to "postgres";
grant MAINTAIN on table public."favorites" to "postgres";
grant REFERENCES on table public."favorites" to "postgres";
grant SELECT on table public."favorites" to "postgres";
grant TRIGGER on table public."favorites" to "postgres";
grant TRUNCATE on table public."favorites" to "postgres";
grant UPDATE on table public."favorites" to "postgres";
grant DELETE on table public."favorites" to "service_role";
grant INSERT on table public."favorites" to "service_role";
grant MAINTAIN on table public."favorites" to "service_role";
grant REFERENCES on table public."favorites" to "service_role";
grant SELECT on table public."favorites" to "service_role";
grant TRIGGER on table public."favorites" to "service_role";
grant TRUNCATE on table public."favorites" to "service_role";
grant UPDATE on table public."favorites" to "service_role";
grant SELECT on table public."financial_audit_events" to "anon";
grant SELECT on table public."financial_audit_events" to "authenticated";
grant DELETE on table public."financial_audit_events" to "postgres";
grant INSERT on table public."financial_audit_events" to "postgres";
grant MAINTAIN on table public."financial_audit_events" to "postgres";
grant REFERENCES on table public."financial_audit_events" to "postgres";
grant SELECT on table public."financial_audit_events" to "postgres";
grant TRIGGER on table public."financial_audit_events" to "postgres";
grant TRUNCATE on table public."financial_audit_events" to "postgres";
grant UPDATE on table public."financial_audit_events" to "postgres";
grant DELETE on table public."financial_audit_events" to "service_role";
grant INSERT on table public."financial_audit_events" to "service_role";
grant MAINTAIN on table public."financial_audit_events" to "service_role";
grant REFERENCES on table public."financial_audit_events" to "service_role";
grant SELECT on table public."financial_audit_events" to "service_role";
grant TRIGGER on table public."financial_audit_events" to "service_role";
grant TRUNCATE on table public."financial_audit_events" to "service_role";
grant UPDATE on table public."financial_audit_events" to "service_role";
grant USAGE on sequence public."financial_audit_events_id_seq" to "postgres";
grant SELECT on table public."follows" to "anon";
grant DELETE on table public."follows" to "authenticated";
grant INSERT on table public."follows" to "authenticated";
grant SELECT on table public."follows" to "authenticated";
grant UPDATE on table public."follows" to "authenticated";
grant DELETE on table public."follows" to "postgres";
grant INSERT on table public."follows" to "postgres";
grant MAINTAIN on table public."follows" to "postgres";
grant REFERENCES on table public."follows" to "postgres";
grant SELECT on table public."follows" to "postgres";
grant TRIGGER on table public."follows" to "postgres";
grant TRUNCATE on table public."follows" to "postgres";
grant UPDATE on table public."follows" to "postgres";
grant DELETE on table public."follows" to "service_role";
grant INSERT on table public."follows" to "service_role";
grant MAINTAIN on table public."follows" to "service_role";
grant REFERENCES on table public."follows" to "service_role";
grant SELECT on table public."follows" to "service_role";
grant TRIGGER on table public."follows" to "service_role";
grant TRUNCATE on table public."follows" to "service_role";
grant UPDATE on table public."follows" to "service_role";
grant DELETE on table public."gallery_media_reference_history" to "postgres";
grant INSERT on table public."gallery_media_reference_history" to "postgres";
grant MAINTAIN on table public."gallery_media_reference_history" to "postgres";
grant REFERENCES on table public."gallery_media_reference_history" to "postgres";
grant SELECT on table public."gallery_media_reference_history" to "postgres";
grant TRIGGER on table public."gallery_media_reference_history" to "postgres";
grant TRUNCATE on table public."gallery_media_reference_history" to "postgres";
grant UPDATE on table public."gallery_media_reference_history" to "postgres";
grant SELECT on table public."gallery_media_reference_history" to "service_role";
grant SELECT on sequence public."gallery_media_reference_history_event_id_seq" to "postgres";
grant UPDATE on sequence public."gallery_media_reference_history_event_id_seq" to "postgres";
grant USAGE on sequence public."gallery_media_reference_history_event_id_seq" to "postgres";
grant DELETE on table public."gallery_storage_retirements" to "postgres";
grant INSERT on table public."gallery_storage_retirements" to "postgres";
grant MAINTAIN on table public."gallery_storage_retirements" to "postgres";
grant REFERENCES on table public."gallery_storage_retirements" to "postgres";
grant SELECT on table public."gallery_storage_retirements" to "postgres";
grant TRIGGER on table public."gallery_storage_retirements" to "postgres";
grant TRUNCATE on table public."gallery_storage_retirements" to "postgres";
grant UPDATE on table public."gallery_storage_retirements" to "postgres";
grant SELECT on table public."gallery_storage_retirements" to "service_role";
grant SELECT on table public."going_signals" to "anon";
grant DELETE on table public."going_signals" to "authenticated";
grant INSERT on table public."going_signals" to "authenticated";
grant SELECT on table public."going_signals" to "authenticated";
grant UPDATE on table public."going_signals" to "authenticated";
grant DELETE on table public."going_signals" to "postgres";
grant INSERT on table public."going_signals" to "postgres";
grant MAINTAIN on table public."going_signals" to "postgres";
grant REFERENCES on table public."going_signals" to "postgres";
grant SELECT on table public."going_signals" to "postgres";
grant TRIGGER on table public."going_signals" to "postgres";
grant TRUNCATE on table public."going_signals" to "postgres";
grant UPDATE on table public."going_signals" to "postgres";
grant DELETE on table public."going_signals" to "service_role";
grant INSERT on table public."going_signals" to "service_role";
grant MAINTAIN on table public."going_signals" to "service_role";
grant REFERENCES on table public."going_signals" to "service_role";
grant SELECT on table public."going_signals" to "service_role";
grant TRIGGER on table public."going_signals" to "service_role";
grant TRUNCATE on table public."going_signals" to "service_role";
grant UPDATE on table public."going_signals" to "service_role";
grant SELECT on table public."image_moderation_records" to "anon";
grant SELECT on table public."image_moderation_records" to "authenticated";
grant DELETE on table public."image_moderation_records" to "postgres";
grant INSERT on table public."image_moderation_records" to "postgres";
grant MAINTAIN on table public."image_moderation_records" to "postgres";
grant REFERENCES on table public."image_moderation_records" to "postgres";
grant SELECT on table public."image_moderation_records" to "postgres";
grant TRIGGER on table public."image_moderation_records" to "postgres";
grant TRUNCATE on table public."image_moderation_records" to "postgres";
grant UPDATE on table public."image_moderation_records" to "postgres";
grant DELETE on table public."image_moderation_records" to "service_role";
grant INSERT on table public."image_moderation_records" to "service_role";
grant MAINTAIN on table public."image_moderation_records" to "service_role";
grant REFERENCES on table public."image_moderation_records" to "service_role";
grant SELECT on table public."image_moderation_records" to "service_role";
grant TRIGGER on table public."image_moderation_records" to "service_role";
grant TRUNCATE on table public."image_moderation_records" to "service_role";
grant UPDATE on table public."image_moderation_records" to "service_role";
grant DELETE on table public."media_likes" to "postgres";
grant INSERT on table public."media_likes" to "postgres";
grant MAINTAIN on table public."media_likes" to "postgres";
grant REFERENCES on table public."media_likes" to "postgres";
grant SELECT on table public."media_likes" to "postgres";
grant TRIGGER on table public."media_likes" to "postgres";
grant TRUNCATE on table public."media_likes" to "postgres";
grant UPDATE on table public."media_likes" to "postgres";
grant DELETE on table public."media_likes" to "service_role";
grant INSERT on table public."media_likes" to "service_role";
grant MAINTAIN on table public."media_likes" to "service_role";
grant REFERENCES on table public."media_likes" to "service_role";
grant SELECT on table public."media_likes" to "service_role";
grant TRIGGER on table public."media_likes" to "service_role";
grant TRUNCATE on table public."media_likes" to "service_role";
grant UPDATE on table public."media_likes" to "service_role";
grant SELECT on table public."mydancr_tv_events" to "anon";
grant SELECT on table public."mydancr_tv_events" to "authenticated";
grant DELETE on table public."mydancr_tv_events" to "postgres";
grant INSERT on table public."mydancr_tv_events" to "postgres";
grant MAINTAIN on table public."mydancr_tv_events" to "postgres";
grant REFERENCES on table public."mydancr_tv_events" to "postgres";
grant SELECT on table public."mydancr_tv_events" to "postgres";
grant TRIGGER on table public."mydancr_tv_events" to "postgres";
grant TRUNCATE on table public."mydancr_tv_events" to "postgres";
grant UPDATE on table public."mydancr_tv_events" to "postgres";
grant DELETE on table public."mydancr_tv_events" to "service_role";
grant INSERT on table public."mydancr_tv_events" to "service_role";
grant MAINTAIN on table public."mydancr_tv_events" to "service_role";
grant REFERENCES on table public."mydancr_tv_events" to "service_role";
grant SELECT on table public."mydancr_tv_events" to "service_role";
grant TRIGGER on table public."mydancr_tv_events" to "service_role";
grant TRUNCATE on table public."mydancr_tv_events" to "service_role";
grant UPDATE on table public."mydancr_tv_events" to "service_role";
grant DELETE on table public."mydancr_tv_videos" to "postgres";
grant INSERT on table public."mydancr_tv_videos" to "postgres";
grant MAINTAIN on table public."mydancr_tv_videos" to "postgres";
grant REFERENCES on table public."mydancr_tv_videos" to "postgres";
grant SELECT on table public."mydancr_tv_videos" to "postgres";
grant TRIGGER on table public."mydancr_tv_videos" to "postgres";
grant TRUNCATE on table public."mydancr_tv_videos" to "postgres";
grant UPDATE on table public."mydancr_tv_videos" to "postgres";
grant DELETE on table public."mydancr_tv_videos" to "service_role";
grant INSERT on table public."mydancr_tv_videos" to "service_role";
grant MAINTAIN on table public."mydancr_tv_videos" to "service_role";
grant REFERENCES on table public."mydancr_tv_videos" to "service_role";
grant SELECT on table public."mydancr_tv_videos" to "service_role";
grant TRIGGER on table public."mydancr_tv_videos" to "service_role";
grant TRUNCATE on table public."mydancr_tv_videos" to "service_role";
grant UPDATE on table public."mydancr_tv_videos" to "service_role";
grant SELECT on table public."nats_affiliate_accounts" to "anon";
grant SELECT on table public."nats_affiliate_accounts" to "authenticated";
grant DELETE on table public."nats_affiliate_accounts" to "postgres";
grant INSERT on table public."nats_affiliate_accounts" to "postgres";
grant MAINTAIN on table public."nats_affiliate_accounts" to "postgres";
grant REFERENCES on table public."nats_affiliate_accounts" to "postgres";
grant SELECT on table public."nats_affiliate_accounts" to "postgres";
grant TRIGGER on table public."nats_affiliate_accounts" to "postgres";
grant TRUNCATE on table public."nats_affiliate_accounts" to "postgres";
grant UPDATE on table public."nats_affiliate_accounts" to "postgres";
grant DELETE on table public."nats_affiliate_accounts" to "service_role";
grant INSERT on table public."nats_affiliate_accounts" to "service_role";
grant MAINTAIN on table public."nats_affiliate_accounts" to "service_role";
grant REFERENCES on table public."nats_affiliate_accounts" to "service_role";
grant SELECT on table public."nats_affiliate_accounts" to "service_role";
grant TRIGGER on table public."nats_affiliate_accounts" to "service_role";
grant TRUNCATE on table public."nats_affiliate_accounts" to "service_role";
grant UPDATE on table public."nats_affiliate_accounts" to "service_role";
grant SELECT on table public."nats_agent_affiliate_accounts" to "anon";
grant SELECT on table public."nats_agent_affiliate_accounts" to "authenticated";
grant DELETE on table public."nats_agent_affiliate_accounts" to "postgres";
grant INSERT on table public."nats_agent_affiliate_accounts" to "postgres";
grant MAINTAIN on table public."nats_agent_affiliate_accounts" to "postgres";
grant REFERENCES on table public."nats_agent_affiliate_accounts" to "postgres";
grant SELECT on table public."nats_agent_affiliate_accounts" to "postgres";
grant TRIGGER on table public."nats_agent_affiliate_accounts" to "postgres";
grant TRUNCATE on table public."nats_agent_affiliate_accounts" to "postgres";
grant UPDATE on table public."nats_agent_affiliate_accounts" to "postgres";
grant DELETE on table public."nats_agent_affiliate_accounts" to "service_role";
grant INSERT on table public."nats_agent_affiliate_accounts" to "service_role";
grant MAINTAIN on table public."nats_agent_affiliate_accounts" to "service_role";
grant REFERENCES on table public."nats_agent_affiliate_accounts" to "service_role";
grant SELECT on table public."nats_agent_affiliate_accounts" to "service_role";
grant TRIGGER on table public."nats_agent_affiliate_accounts" to "service_role";
grant TRUNCATE on table public."nats_agent_affiliate_accounts" to "service_role";
grant UPDATE on table public."nats_agent_affiliate_accounts" to "service_role";
grant SELECT on table public."nats_agent_commission_exports" to "anon";
grant SELECT on table public."nats_agent_commission_exports" to "authenticated";
grant DELETE on table public."nats_agent_commission_exports" to "postgres";
grant INSERT on table public."nats_agent_commission_exports" to "postgres";
grant MAINTAIN on table public."nats_agent_commission_exports" to "postgres";
grant REFERENCES on table public."nats_agent_commission_exports" to "postgres";
grant SELECT on table public."nats_agent_commission_exports" to "postgres";
grant TRIGGER on table public."nats_agent_commission_exports" to "postgres";
grant TRUNCATE on table public."nats_agent_commission_exports" to "postgres";
grant UPDATE on table public."nats_agent_commission_exports" to "postgres";
grant DELETE on table public."nats_agent_commission_exports" to "service_role";
grant INSERT on table public."nats_agent_commission_exports" to "service_role";
grant MAINTAIN on table public."nats_agent_commission_exports" to "service_role";
grant REFERENCES on table public."nats_agent_commission_exports" to "service_role";
grant SELECT on table public."nats_agent_commission_exports" to "service_role";
grant TRIGGER on table public."nats_agent_commission_exports" to "service_role";
grant TRUNCATE on table public."nats_agent_commission_exports" to "service_role";
grant UPDATE on table public."nats_agent_commission_exports" to "service_role";
grant SELECT on table public."nats_commission_exports" to "anon";
grant SELECT on table public."nats_commission_exports" to "authenticated";
grant DELETE on table public."nats_commission_exports" to "postgres";
grant INSERT on table public."nats_commission_exports" to "postgres";
grant MAINTAIN on table public."nats_commission_exports" to "postgres";
grant REFERENCES on table public."nats_commission_exports" to "postgres";
grant SELECT on table public."nats_commission_exports" to "postgres";
grant TRIGGER on table public."nats_commission_exports" to "postgres";
grant TRUNCATE on table public."nats_commission_exports" to "postgres";
grant UPDATE on table public."nats_commission_exports" to "postgres";
grant DELETE on table public."nats_commission_exports" to "service_role";
grant INSERT on table public."nats_commission_exports" to "service_role";
grant MAINTAIN on table public."nats_commission_exports" to "service_role";
grant REFERENCES on table public."nats_commission_exports" to "service_role";
grant SELECT on table public."nats_commission_exports" to "service_role";
grant TRIGGER on table public."nats_commission_exports" to "service_role";
grant TRUNCATE on table public."nats_commission_exports" to "service_role";
grant UPDATE on table public."nats_commission_exports" to "service_role";
grant SELECT on table public."nfc_tags" to "anon";
grant DELETE on table public."nfc_tags" to "authenticated";
grant INSERT on table public."nfc_tags" to "authenticated";
grant SELECT on table public."nfc_tags" to "authenticated";
grant UPDATE on table public."nfc_tags" to "authenticated";
grant DELETE on table public."nfc_tags" to "postgres";
grant INSERT on table public."nfc_tags" to "postgres";
grant MAINTAIN on table public."nfc_tags" to "postgres";
grant REFERENCES on table public."nfc_tags" to "postgres";
grant SELECT on table public."nfc_tags" to "postgres";
grant TRIGGER on table public."nfc_tags" to "postgres";
grant TRUNCATE on table public."nfc_tags" to "postgres";
grant UPDATE on table public."nfc_tags" to "postgres";
grant DELETE on table public."nfc_tags" to "service_role";
grant INSERT on table public."nfc_tags" to "service_role";
grant MAINTAIN on table public."nfc_tags" to "service_role";
grant REFERENCES on table public."nfc_tags" to "service_role";
grant SELECT on table public."nfc_tags" to "service_role";
grant TRIGGER on table public."nfc_tags" to "service_role";
grant TRUNCATE on table public."nfc_tags" to "service_role";
grant UPDATE on table public."nfc_tags" to "service_role";
grant SELECT on table public."nfc_tap_events" to "anon";
grant DELETE on table public."nfc_tap_events" to "authenticated";
grant INSERT on table public."nfc_tap_events" to "authenticated";
grant SELECT on table public."nfc_tap_events" to "authenticated";
grant UPDATE on table public."nfc_tap_events" to "authenticated";
grant DELETE on table public."nfc_tap_events" to "postgres";
grant INSERT on table public."nfc_tap_events" to "postgres";
grant MAINTAIN on table public."nfc_tap_events" to "postgres";
grant REFERENCES on table public."nfc_tap_events" to "postgres";
grant SELECT on table public."nfc_tap_events" to "postgres";
grant TRIGGER on table public."nfc_tap_events" to "postgres";
grant TRUNCATE on table public."nfc_tap_events" to "postgres";
grant UPDATE on table public."nfc_tap_events" to "postgres";
grant DELETE on table public."nfc_tap_events" to "service_role";
grant INSERT on table public."nfc_tap_events" to "service_role";
grant MAINTAIN on table public."nfc_tap_events" to "service_role";
grant REFERENCES on table public."nfc_tap_events" to "service_role";
grant SELECT on table public."nfc_tap_events" to "service_role";
grant TRIGGER on table public."nfc_tap_events" to "service_role";
grant TRUNCATE on table public."nfc_tap_events" to "service_role";
grant UPDATE on table public."nfc_tap_events" to "service_role";
grant SELECT on table public."notifications" to "anon";
grant DELETE on table public."notifications" to "authenticated";
grant INSERT on table public."notifications" to "authenticated";
grant SELECT on table public."notifications" to "authenticated";
grant DELETE on table public."notifications" to "postgres";
grant INSERT on table public."notifications" to "postgres";
grant MAINTAIN on table public."notifications" to "postgres";
grant REFERENCES on table public."notifications" to "postgres";
grant SELECT on table public."notifications" to "postgres";
grant TRIGGER on table public."notifications" to "postgres";
grant TRUNCATE on table public."notifications" to "postgres";
grant UPDATE on table public."notifications" to "postgres";
grant DELETE on table public."notifications" to "service_role";
grant INSERT on table public."notifications" to "service_role";
grant MAINTAIN on table public."notifications" to "service_role";
grant REFERENCES on table public."notifications" to "service_role";
grant SELECT on table public."notifications" to "service_role";
grant TRIGGER on table public."notifications" to "service_role";
grant TRUNCATE on table public."notifications" to "service_role";
grant UPDATE on table public."notifications" to "service_role";
grant SELECT on table public."payment_provider_webhook_events" to "anon";
grant SELECT on table public."payment_provider_webhook_events" to "authenticated";
grant DELETE on table public."payment_provider_webhook_events" to "postgres";
grant INSERT on table public."payment_provider_webhook_events" to "postgres";
grant MAINTAIN on table public."payment_provider_webhook_events" to "postgres";
grant REFERENCES on table public."payment_provider_webhook_events" to "postgres";
grant SELECT on table public."payment_provider_webhook_events" to "postgres";
grant TRIGGER on table public."payment_provider_webhook_events" to "postgres";
grant TRUNCATE on table public."payment_provider_webhook_events" to "postgres";
grant UPDATE on table public."payment_provider_webhook_events" to "postgres";
grant DELETE on table public."payment_provider_webhook_events" to "service_role";
grant INSERT on table public."payment_provider_webhook_events" to "service_role";
grant MAINTAIN on table public."payment_provider_webhook_events" to "service_role";
grant REFERENCES on table public."payment_provider_webhook_events" to "service_role";
grant SELECT on table public."payment_provider_webhook_events" to "service_role";
grant TRIGGER on table public."payment_provider_webhook_events" to "service_role";
grant TRUNCATE on table public."payment_provider_webhook_events" to "service_role";
grant UPDATE on table public."payment_provider_webhook_events" to "service_role";
grant SELECT on table public."payout_settings" to "anon";
grant SELECT on table public."payout_settings" to "authenticated";
grant DELETE on table public."payout_settings" to "postgres";
grant INSERT on table public."payout_settings" to "postgres";
grant MAINTAIN on table public."payout_settings" to "postgres";
grant REFERENCES on table public."payout_settings" to "postgres";
grant SELECT on table public."payout_settings" to "postgres";
grant TRIGGER on table public."payout_settings" to "postgres";
grant TRUNCATE on table public."payout_settings" to "postgres";
grant UPDATE on table public."payout_settings" to "postgres";
grant DELETE on table public."payout_settings" to "service_role";
grant INSERT on table public."payout_settings" to "service_role";
grant MAINTAIN on table public."payout_settings" to "service_role";
grant REFERENCES on table public."payout_settings" to "service_role";
grant SELECT on table public."payout_settings" to "service_role";
grant TRIGGER on table public."payout_settings" to "service_role";
grant TRUNCATE on table public."payout_settings" to "service_role";
grant UPDATE on table public."payout_settings" to "service_role";
grant SELECT on table public."profile_views" to "anon";
grant SELECT on table public."profile_views" to "authenticated";
grant DELETE on table public."profile_views" to "postgres";
grant INSERT on table public."profile_views" to "postgres";
grant MAINTAIN on table public."profile_views" to "postgres";
grant REFERENCES on table public."profile_views" to "postgres";
grant SELECT on table public."profile_views" to "postgres";
grant TRIGGER on table public."profile_views" to "postgres";
grant TRUNCATE on table public."profile_views" to "postgres";
grant UPDATE on table public."profile_views" to "postgres";
grant DELETE on table public."profile_views" to "service_role";
grant INSERT on table public."profile_views" to "service_role";
grant MAINTAIN on table public."profile_views" to "service_role";
grant REFERENCES on table public."profile_views" to "service_role";
grant SELECT on table public."profile_views" to "service_role";
grant TRIGGER on table public."profile_views" to "service_role";
grant TRUNCATE on table public."profile_views" to "service_role";
grant UPDATE on table public."profile_views" to "service_role";
grant SELECT on table public."public_dancer_profiles" to "anon";
grant SELECT on table public."public_dancer_profiles" to "authenticated";
grant DELETE on table public."public_dancer_profiles" to "postgres";
grant INSERT on table public."public_dancer_profiles" to "postgres";
grant MAINTAIN on table public."public_dancer_profiles" to "postgres";
grant REFERENCES on table public."public_dancer_profiles" to "postgres";
grant SELECT on table public."public_dancer_profiles" to "postgres";
grant TRIGGER on table public."public_dancer_profiles" to "postgres";
grant TRUNCATE on table public."public_dancer_profiles" to "postgres";
grant UPDATE on table public."public_dancer_profiles" to "postgres";
grant DELETE on table public."public_dancer_profiles" to "service_role";
grant INSERT on table public."public_dancer_profiles" to "service_role";
grant MAINTAIN on table public."public_dancer_profiles" to "service_role";
grant REFERENCES on table public."public_dancer_profiles" to "service_role";
grant SELECT on table public."public_dancer_profiles" to "service_role";
grant TRIGGER on table public."public_dancer_profiles" to "service_role";
grant TRUNCATE on table public."public_dancer_profiles" to "service_role";
grant UPDATE on table public."public_dancer_profiles" to "service_role";
grant SELECT on table public."qr_redemption_events" to "anon";
grant DELETE on table public."qr_redemption_events" to "authenticated";
grant INSERT on table public."qr_redemption_events" to "authenticated";
grant SELECT on table public."qr_redemption_events" to "authenticated";
grant UPDATE on table public."qr_redemption_events" to "authenticated";
grant DELETE on table public."qr_redemption_events" to "postgres";
grant INSERT on table public."qr_redemption_events" to "postgres";
grant MAINTAIN on table public."qr_redemption_events" to "postgres";
grant REFERENCES on table public."qr_redemption_events" to "postgres";
grant SELECT on table public."qr_redemption_events" to "postgres";
grant TRIGGER on table public."qr_redemption_events" to "postgres";
grant TRUNCATE on table public."qr_redemption_events" to "postgres";
grant UPDATE on table public."qr_redemption_events" to "postgres";
grant DELETE on table public."qr_redemption_events" to "service_role";
grant INSERT on table public."qr_redemption_events" to "service_role";
grant MAINTAIN on table public."qr_redemption_events" to "service_role";
grant REFERENCES on table public."qr_redemption_events" to "service_role";
grant SELECT on table public."qr_redemption_events" to "service_role";
grant TRIGGER on table public."qr_redemption_events" to "service_role";
grant TRUNCATE on table public."qr_redemption_events" to "service_role";
grant UPDATE on table public."qr_redemption_events" to "service_role";
grant SELECT on table public."qr_redemptions" to "anon";
grant DELETE on table public."qr_redemptions" to "authenticated";
grant INSERT on table public."qr_redemptions" to "authenticated";
grant SELECT on table public."qr_redemptions" to "authenticated";
grant UPDATE on table public."qr_redemptions" to "authenticated";
grant DELETE on table public."qr_redemptions" to "postgres";
grant INSERT on table public."qr_redemptions" to "postgres";
grant MAINTAIN on table public."qr_redemptions" to "postgres";
grant REFERENCES on table public."qr_redemptions" to "postgres";
grant SELECT on table public."qr_redemptions" to "postgres";
grant TRIGGER on table public."qr_redemptions" to "postgres";
grant TRUNCATE on table public."qr_redemptions" to "postgres";
grant UPDATE on table public."qr_redemptions" to "postgres";
grant DELETE on table public."qr_redemptions" to "service_role";
grant INSERT on table public."qr_redemptions" to "service_role";
grant MAINTAIN on table public."qr_redemptions" to "service_role";
grant REFERENCES on table public."qr_redemptions" to "service_role";
grant SELECT on table public."qr_redemptions" to "service_role";
grant TRIGGER on table public."qr_redemptions" to "service_role";
grant TRUNCATE on table public."qr_redemptions" to "service_role";
grant UPDATE on table public."qr_redemptions" to "service_role";
grant SELECT on table public."ranking_events" to "anon";
grant DELETE on table public."ranking_events" to "authenticated";
grant INSERT on table public."ranking_events" to "authenticated";
grant SELECT on table public."ranking_events" to "authenticated";
grant UPDATE on table public."ranking_events" to "authenticated";
grant DELETE on table public."ranking_events" to "postgres";
grant INSERT on table public."ranking_events" to "postgres";
grant MAINTAIN on table public."ranking_events" to "postgres";
grant REFERENCES on table public."ranking_events" to "postgres";
grant SELECT on table public."ranking_events" to "postgres";
grant TRIGGER on table public."ranking_events" to "postgres";
grant TRUNCATE on table public."ranking_events" to "postgres";
grant UPDATE on table public."ranking_events" to "postgres";
grant DELETE on table public."ranking_events" to "service_role";
grant INSERT on table public."ranking_events" to "service_role";
grant MAINTAIN on table public."ranking_events" to "service_role";
grant REFERENCES on table public."ranking_events" to "service_role";
grant SELECT on table public."ranking_events" to "service_role";
grant TRIGGER on table public."ranking_events" to "service_role";
grant TRUNCATE on table public."ranking_events" to "service_role";
grant UPDATE on table public."ranking_events" to "service_role";
grant DELETE on table public."request_rate_limit_buckets" to "postgres";
grant INSERT on table public."request_rate_limit_buckets" to "postgres";
grant MAINTAIN on table public."request_rate_limit_buckets" to "postgres";
grant REFERENCES on table public."request_rate_limit_buckets" to "postgres";
grant SELECT on table public."request_rate_limit_buckets" to "postgres";
grant TRIGGER on table public."request_rate_limit_buckets" to "postgres";
grant TRUNCATE on table public."request_rate_limit_buckets" to "postgres";
grant UPDATE on table public."request_rate_limit_buckets" to "postgres";
grant DELETE on table public."request_rate_limit_buckets" to "service_role";
grant INSERT on table public."request_rate_limit_buckets" to "service_role";
grant MAINTAIN on table public."request_rate_limit_buckets" to "service_role";
grant REFERENCES on table public."request_rate_limit_buckets" to "service_role";
grant SELECT on table public."request_rate_limit_buckets" to "service_role";
grant TRIGGER on table public."request_rate_limit_buckets" to "service_role";
grant TRUNCATE on table public."request_rate_limit_buckets" to "service_role";
grant UPDATE on table public."request_rate_limit_buckets" to "service_role";
grant SELECT on table public."sales_agents" to "anon";
grant DELETE on table public."sales_agents" to "authenticated";
grant INSERT on table public."sales_agents" to "authenticated";
grant SELECT on table public."sales_agents" to "authenticated";
grant UPDATE on table public."sales_agents" to "authenticated";
grant DELETE on table public."sales_agents" to "postgres";
grant INSERT on table public."sales_agents" to "postgres";
grant MAINTAIN on table public."sales_agents" to "postgres";
grant REFERENCES on table public."sales_agents" to "postgres";
grant SELECT on table public."sales_agents" to "postgres";
grant TRIGGER on table public."sales_agents" to "postgres";
grant TRUNCATE on table public."sales_agents" to "postgres";
grant UPDATE on table public."sales_agents" to "postgres";
grant DELETE on table public."sales_agents" to "service_role";
grant INSERT on table public."sales_agents" to "service_role";
grant MAINTAIN on table public."sales_agents" to "service_role";
grant REFERENCES on table public."sales_agents" to "service_role";
grant SELECT on table public."sales_agents" to "service_role";
grant TRIGGER on table public."sales_agents" to "service_role";
grant TRUNCATE on table public."sales_agents" to "service_role";
grant UPDATE on table public."sales_agents" to "service_role";
grant SELECT on table public."schedule_views" to "anon";
grant SELECT on table public."schedule_views" to "authenticated";
grant DELETE on table public."schedule_views" to "postgres";
grant INSERT on table public."schedule_views" to "postgres";
grant MAINTAIN on table public."schedule_views" to "postgres";
grant REFERENCES on table public."schedule_views" to "postgres";
grant SELECT on table public."schedule_views" to "postgres";
grant TRIGGER on table public."schedule_views" to "postgres";
grant TRUNCATE on table public."schedule_views" to "postgres";
grant UPDATE on table public."schedule_views" to "postgres";
grant DELETE on table public."schedule_views" to "service_role";
grant INSERT on table public."schedule_views" to "service_role";
grant MAINTAIN on table public."schedule_views" to "service_role";
grant REFERENCES on table public."schedule_views" to "service_role";
grant SELECT on table public."schedule_views" to "service_role";
grant TRIGGER on table public."schedule_views" to "service_role";
grant TRUNCATE on table public."schedule_views" to "service_role";
grant UPDATE on table public."schedule_views" to "service_role";
grant SELECT on table public."shift_location_events" to "authenticated";
grant DELETE on table public."shift_location_events" to "postgres";
grant INSERT on table public."shift_location_events" to "postgres";
grant MAINTAIN on table public."shift_location_events" to "postgres";
grant REFERENCES on table public."shift_location_events" to "postgres";
grant SELECT on table public."shift_location_events" to "postgres";
grant TRIGGER on table public."shift_location_events" to "postgres";
grant TRUNCATE on table public."shift_location_events" to "postgres";
grant UPDATE on table public."shift_location_events" to "postgres";
grant DELETE on table public."shift_location_events" to "service_role";
grant INSERT on table public."shift_location_events" to "service_role";
grant MAINTAIN on table public."shift_location_events" to "service_role";
grant REFERENCES on table public."shift_location_events" to "service_role";
grant SELECT on table public."shift_location_events" to "service_role";
grant TRIGGER on table public."shift_location_events" to "service_role";
grant TRUNCATE on table public."shift_location_events" to "service_role";
grant UPDATE on table public."shift_location_events" to "service_role";
grant DELETE on table public."shifts" to "postgres";
grant INSERT on table public."shifts" to "postgres";
grant MAINTAIN on table public."shifts" to "postgres";
grant REFERENCES on table public."shifts" to "postgres";
grant SELECT on table public."shifts" to "postgres";
grant TRIGGER on table public."shifts" to "postgres";
grant TRUNCATE on table public."shifts" to "postgres";
grant UPDATE on table public."shifts" to "postgres";
grant DELETE on table public."shifts" to "service_role";
grant INSERT on table public."shifts" to "service_role";
grant MAINTAIN on table public."shifts" to "service_role";
grant REFERENCES on table public."shifts" to "service_role";
grant SELECT on table public."shifts" to "service_role";
grant TRIGGER on table public."shifts" to "service_role";
grant TRUNCATE on table public."shifts" to "service_role";
grant UPDATE on table public."shifts" to "service_role";
grant SELECT on table public."social_clicks" to "anon";
grant SELECT on table public."social_clicks" to "authenticated";
grant DELETE on table public."social_clicks" to "postgres";
grant INSERT on table public."social_clicks" to "postgres";
grant MAINTAIN on table public."social_clicks" to "postgres";
grant REFERENCES on table public."social_clicks" to "postgres";
grant SELECT on table public."social_clicks" to "postgres";
grant TRIGGER on table public."social_clicks" to "postgres";
grant TRUNCATE on table public."social_clicks" to "postgres";
grant UPDATE on table public."social_clicks" to "postgres";
grant DELETE on table public."social_clicks" to "service_role";
grant INSERT on table public."social_clicks" to "service_role";
grant MAINTAIN on table public."social_clicks" to "service_role";
grant REFERENCES on table public."social_clicks" to "service_role";
grant SELECT on table public."social_clicks" to "service_role";
grant TRIGGER on table public."social_clicks" to "service_role";
grant TRUNCATE on table public."social_clicks" to "service_role";
grant UPDATE on table public."social_clicks" to "service_role";
grant SELECT on table public."social_links" to "anon";
grant SELECT on table public."social_links" to "authenticated";
grant DELETE on table public."social_links" to "postgres";
grant INSERT on table public."social_links" to "postgres";
grant MAINTAIN on table public."social_links" to "postgres";
grant REFERENCES on table public."social_links" to "postgres";
grant SELECT on table public."social_links" to "postgres";
grant TRIGGER on table public."social_links" to "postgres";
grant TRUNCATE on table public."social_links" to "postgres";
grant UPDATE on table public."social_links" to "postgres";
grant DELETE on table public."social_links" to "service_role";
grant INSERT on table public."social_links" to "service_role";
grant MAINTAIN on table public."social_links" to "service_role";
grant REFERENCES on table public."social_links" to "service_role";
grant SELECT on table public."social_links" to "service_role";
grant TRIGGER on table public."social_links" to "service_role";
grant TRUNCATE on table public."social_links" to "service_role";
grant UPDATE on table public."social_links" to "service_role";
grant SELECT on table public."subscriptions" to "anon";
grant DELETE on table public."subscriptions" to "authenticated";
grant INSERT on table public."subscriptions" to "authenticated";
grant SELECT on table public."subscriptions" to "authenticated";
grant UPDATE on table public."subscriptions" to "authenticated";
grant DELETE on table public."subscriptions" to "postgres";
grant INSERT on table public."subscriptions" to "postgres";
grant MAINTAIN on table public."subscriptions" to "postgres";
grant REFERENCES on table public."subscriptions" to "postgres";
grant SELECT on table public."subscriptions" to "postgres";
grant TRIGGER on table public."subscriptions" to "postgres";
grant TRUNCATE on table public."subscriptions" to "postgres";
grant UPDATE on table public."subscriptions" to "postgres";
grant DELETE on table public."subscriptions" to "service_role";
grant INSERT on table public."subscriptions" to "service_role";
grant MAINTAIN on table public."subscriptions" to "service_role";
grant REFERENCES on table public."subscriptions" to "service_role";
grant SELECT on table public."subscriptions" to "service_role";
grant TRIGGER on table public."subscriptions" to "service_role";
grant TRUNCATE on table public."subscriptions" to "service_role";
grant UPDATE on table public."subscriptions" to "service_role";
grant SELECT on table public."support_ai_runs" to "anon";
grant SELECT on table public."support_ai_runs" to "authenticated";
grant DELETE on table public."support_ai_runs" to "postgres";
grant INSERT on table public."support_ai_runs" to "postgres";
grant MAINTAIN on table public."support_ai_runs" to "postgres";
grant REFERENCES on table public."support_ai_runs" to "postgres";
grant SELECT on table public."support_ai_runs" to "postgres";
grant TRIGGER on table public."support_ai_runs" to "postgres";
grant TRUNCATE on table public."support_ai_runs" to "postgres";
grant UPDATE on table public."support_ai_runs" to "postgres";
grant DELETE on table public."support_ai_runs" to "service_role";
grant INSERT on table public."support_ai_runs" to "service_role";
grant MAINTAIN on table public."support_ai_runs" to "service_role";
grant REFERENCES on table public."support_ai_runs" to "service_role";
grant SELECT on table public."support_ai_runs" to "service_role";
grant TRIGGER on table public."support_ai_runs" to "service_role";
grant TRUNCATE on table public."support_ai_runs" to "service_role";
grant UPDATE on table public."support_ai_runs" to "service_role";
grant SELECT on table public."support_messages" to "anon";
grant SELECT on table public."support_messages" to "authenticated";
grant DELETE on table public."support_messages" to "postgres";
grant INSERT on table public."support_messages" to "postgres";
grant MAINTAIN on table public."support_messages" to "postgres";
grant REFERENCES on table public."support_messages" to "postgres";
grant SELECT on table public."support_messages" to "postgres";
grant TRIGGER on table public."support_messages" to "postgres";
grant TRUNCATE on table public."support_messages" to "postgres";
grant UPDATE on table public."support_messages" to "postgres";
grant DELETE on table public."support_messages" to "service_role";
grant INSERT on table public."support_messages" to "service_role";
grant MAINTAIN on table public."support_messages" to "service_role";
grant REFERENCES on table public."support_messages" to "service_role";
grant SELECT on table public."support_messages" to "service_role";
grant TRIGGER on table public."support_messages" to "service_role";
grant TRUNCATE on table public."support_messages" to "service_role";
grant UPDATE on table public."support_messages" to "service_role";
grant SELECT on table public."support_threads" to "anon";
grant SELECT on table public."support_threads" to "authenticated";
grant DELETE on table public."support_threads" to "postgres";
grant INSERT on table public."support_threads" to "postgres";
grant MAINTAIN on table public."support_threads" to "postgres";
grant REFERENCES on table public."support_threads" to "postgres";
grant SELECT on table public."support_threads" to "postgres";
grant TRIGGER on table public."support_threads" to "postgres";
grant TRUNCATE on table public."support_threads" to "postgres";
grant UPDATE on table public."support_threads" to "postgres";
grant DELETE on table public."support_threads" to "service_role";
grant INSERT on table public."support_threads" to "service_role";
grant MAINTAIN on table public."support_threads" to "service_role";
grant REFERENCES on table public."support_threads" to "service_role";
grant SELECT on table public."support_threads" to "service_role";
grant TRIGGER on table public."support_threads" to "service_role";
grant TRUNCATE on table public."support_threads" to "service_role";
grant UPDATE on table public."support_threads" to "service_role";
grant SELECT on table public."trending_scores" to "anon";
grant DELETE on table public."trending_scores" to "authenticated";
grant INSERT on table public."trending_scores" to "authenticated";
grant SELECT on table public."trending_scores" to "authenticated";
grant UPDATE on table public."trending_scores" to "authenticated";
grant DELETE on table public."trending_scores" to "postgres";
grant INSERT on table public."trending_scores" to "postgres";
grant MAINTAIN on table public."trending_scores" to "postgres";
grant REFERENCES on table public."trending_scores" to "postgres";
grant SELECT on table public."trending_scores" to "postgres";
grant TRIGGER on table public."trending_scores" to "postgres";
grant TRUNCATE on table public."trending_scores" to "postgres";
grant UPDATE on table public."trending_scores" to "postgres";
grant DELETE on table public."trending_scores" to "service_role";
grant INSERT on table public."trending_scores" to "service_role";
grant MAINTAIN on table public."trending_scores" to "service_role";
grant REFERENCES on table public."trending_scores" to "service_role";
grant SELECT on table public."trending_scores" to "service_role";
grant TRIGGER on table public."trending_scores" to "service_role";
grant TRUNCATE on table public."trending_scores" to "service_role";
grant UPDATE on table public."trending_scores" to "service_role";
grant SELECT on table public."venue_activity_log" to "anon";
grant DELETE on table public."venue_activity_log" to "authenticated";
grant INSERT on table public."venue_activity_log" to "authenticated";
grant SELECT on table public."venue_activity_log" to "authenticated";
grant UPDATE on table public."venue_activity_log" to "authenticated";
grant DELETE on table public."venue_activity_log" to "postgres";
grant INSERT on table public."venue_activity_log" to "postgres";
grant MAINTAIN on table public."venue_activity_log" to "postgres";
grant REFERENCES on table public."venue_activity_log" to "postgres";
grant SELECT on table public."venue_activity_log" to "postgres";
grant TRIGGER on table public."venue_activity_log" to "postgres";
grant TRUNCATE on table public."venue_activity_log" to "postgres";
grant UPDATE on table public."venue_activity_log" to "postgres";
grant DELETE on table public."venue_activity_log" to "service_role";
grant INSERT on table public."venue_activity_log" to "service_role";
grant MAINTAIN on table public."venue_activity_log" to "service_role";
grant REFERENCES on table public."venue_activity_log" to "service_role";
grant SELECT on table public."venue_activity_log" to "service_role";
grant TRIGGER on table public."venue_activity_log" to "service_role";
grant TRUNCATE on table public."venue_activity_log" to "service_role";
grant UPDATE on table public."venue_activity_log" to "service_role";
grant DELETE on table public."venue_claim_codes" to "postgres";
grant INSERT on table public."venue_claim_codes" to "postgres";
grant MAINTAIN on table public."venue_claim_codes" to "postgres";
grant REFERENCES on table public."venue_claim_codes" to "postgres";
grant SELECT on table public."venue_claim_codes" to "postgres";
grant TRIGGER on table public."venue_claim_codes" to "postgres";
grant TRUNCATE on table public."venue_claim_codes" to "postgres";
grant UPDATE on table public."venue_claim_codes" to "postgres";
grant DELETE on table public."venue_claim_codes" to "service_role";
grant INSERT on table public."venue_claim_codes" to "service_role";
grant MAINTAIN on table public."venue_claim_codes" to "service_role";
grant REFERENCES on table public."venue_claim_codes" to "service_role";
grant SELECT on table public."venue_claim_codes" to "service_role";
grant TRIGGER on table public."venue_claim_codes" to "service_role";
grant TRUNCATE on table public."venue_claim_codes" to "service_role";
grant UPDATE on table public."venue_claim_codes" to "service_role";
grant SELECT on table public."venue_club_deal_requests" to "anon";
grant DELETE on table public."venue_club_deal_requests" to "authenticated";
grant INSERT on table public."venue_club_deal_requests" to "authenticated";
grant SELECT on table public."venue_club_deal_requests" to "authenticated";
grant UPDATE on table public."venue_club_deal_requests" to "authenticated";
grant DELETE on table public."venue_club_deal_requests" to "postgres";
grant INSERT on table public."venue_club_deal_requests" to "postgres";
grant MAINTAIN on table public."venue_club_deal_requests" to "postgres";
grant REFERENCES on table public."venue_club_deal_requests" to "postgres";
grant SELECT on table public."venue_club_deal_requests" to "postgres";
grant TRIGGER on table public."venue_club_deal_requests" to "postgres";
grant TRUNCATE on table public."venue_club_deal_requests" to "postgres";
grant UPDATE on table public."venue_club_deal_requests" to "postgres";
grant DELETE on table public."venue_club_deal_requests" to "service_role";
grant INSERT on table public."venue_club_deal_requests" to "service_role";
grant MAINTAIN on table public."venue_club_deal_requests" to "service_role";
grant REFERENCES on table public."venue_club_deal_requests" to "service_role";
grant SELECT on table public."venue_club_deal_requests" to "service_role";
grant TRIGGER on table public."venue_club_deal_requests" to "service_role";
grant TRUNCATE on table public."venue_club_deal_requests" to "service_role";
grant UPDATE on table public."venue_club_deal_requests" to "service_role";
grant DELETE on table public."venue_dancer_affiliation_events" to "postgres";
grant INSERT on table public."venue_dancer_affiliation_events" to "postgres";
grant MAINTAIN on table public."venue_dancer_affiliation_events" to "postgres";
grant REFERENCES on table public."venue_dancer_affiliation_events" to "postgres";
grant SELECT on table public."venue_dancer_affiliation_events" to "postgres";
grant TRIGGER on table public."venue_dancer_affiliation_events" to "postgres";
grant TRUNCATE on table public."venue_dancer_affiliation_events" to "postgres";
grant UPDATE on table public."venue_dancer_affiliation_events" to "postgres";
grant DELETE on table public."venue_dancer_affiliation_events" to "service_role";
grant INSERT on table public."venue_dancer_affiliation_events" to "service_role";
grant MAINTAIN on table public."venue_dancer_affiliation_events" to "service_role";
grant REFERENCES on table public."venue_dancer_affiliation_events" to "service_role";
grant SELECT on table public."venue_dancer_affiliation_events" to "service_role";
grant TRIGGER on table public."venue_dancer_affiliation_events" to "service_role";
grant TRUNCATE on table public."venue_dancer_affiliation_events" to "service_role";
grant UPDATE on table public."venue_dancer_affiliation_events" to "service_role";
grant DELETE on table public."venue_dancer_affiliations" to "postgres";
grant INSERT on table public."venue_dancer_affiliations" to "postgres";
grant MAINTAIN on table public."venue_dancer_affiliations" to "postgres";
grant REFERENCES on table public."venue_dancer_affiliations" to "postgres";
grant SELECT on table public."venue_dancer_affiliations" to "postgres";
grant TRIGGER on table public."venue_dancer_affiliations" to "postgres";
grant TRUNCATE on table public."venue_dancer_affiliations" to "postgres";
grant UPDATE on table public."venue_dancer_affiliations" to "postgres";
grant DELETE on table public."venue_dancer_affiliations" to "service_role";
grant INSERT on table public."venue_dancer_affiliations" to "service_role";
grant MAINTAIN on table public."venue_dancer_affiliations" to "service_role";
grant REFERENCES on table public."venue_dancer_affiliations" to "service_role";
grant SELECT on table public."venue_dancer_affiliations" to "service_role";
grant TRIGGER on table public."venue_dancer_affiliations" to "service_role";
grant TRUNCATE on table public."venue_dancer_affiliations" to "service_role";
grant UPDATE on table public."venue_dancer_affiliations" to "service_role";
grant DELETE on table public."venue_dancer_verification_tokens" to "postgres";
grant INSERT on table public."venue_dancer_verification_tokens" to "postgres";
grant MAINTAIN on table public."venue_dancer_verification_tokens" to "postgres";
grant REFERENCES on table public."venue_dancer_verification_tokens" to "postgres";
grant SELECT on table public."venue_dancer_verification_tokens" to "postgres";
grant TRIGGER on table public."venue_dancer_verification_tokens" to "postgres";
grant TRUNCATE on table public."venue_dancer_verification_tokens" to "postgres";
grant UPDATE on table public."venue_dancer_verification_tokens" to "postgres";
grant DELETE on table public."venue_dancer_verification_tokens" to "service_role";
grant INSERT on table public."venue_dancer_verification_tokens" to "service_role";
grant MAINTAIN on table public."venue_dancer_verification_tokens" to "service_role";
grant REFERENCES on table public."venue_dancer_verification_tokens" to "service_role";
grant SELECT on table public."venue_dancer_verification_tokens" to "service_role";
grant TRIGGER on table public."venue_dancer_verification_tokens" to "service_role";
grant TRUNCATE on table public."venue_dancer_verification_tokens" to "service_role";
grant UPDATE on table public."venue_dancer_verification_tokens" to "service_role";
grant SELECT on table public."venue_follows" to "anon";
grant DELETE on table public."venue_follows" to "authenticated";
grant INSERT on table public."venue_follows" to "authenticated";
grant SELECT on table public."venue_follows" to "authenticated";
grant UPDATE on table public."venue_follows" to "authenticated";
grant DELETE on table public."venue_follows" to "postgres";
grant INSERT on table public."venue_follows" to "postgres";
grant MAINTAIN on table public."venue_follows" to "postgres";
grant REFERENCES on table public."venue_follows" to "postgres";
grant SELECT on table public."venue_follows" to "postgres";
grant TRIGGER on table public."venue_follows" to "postgres";
grant TRUNCATE on table public."venue_follows" to "postgres";
grant UPDATE on table public."venue_follows" to "postgres";
grant DELETE on table public."venue_follows" to "service_role";
grant INSERT on table public."venue_follows" to "service_role";
grant MAINTAIN on table public."venue_follows" to "service_role";
grant REFERENCES on table public."venue_follows" to "service_role";
grant SELECT on table public."venue_follows" to "service_role";
grant TRIGGER on table public."venue_follows" to "service_role";
grant TRUNCATE on table public."venue_follows" to "service_role";
grant UPDATE on table public."venue_follows" to "service_role";
grant SELECT on table public."venue_nfc_support_requests" to "anon";
grant DELETE on table public."venue_nfc_support_requests" to "authenticated";
grant INSERT on table public."venue_nfc_support_requests" to "authenticated";
grant SELECT on table public."venue_nfc_support_requests" to "authenticated";
grant UPDATE on table public."venue_nfc_support_requests" to "authenticated";
grant DELETE on table public."venue_nfc_support_requests" to "postgres";
grant INSERT on table public."venue_nfc_support_requests" to "postgres";
grant MAINTAIN on table public."venue_nfc_support_requests" to "postgres";
grant REFERENCES on table public."venue_nfc_support_requests" to "postgres";
grant SELECT on table public."venue_nfc_support_requests" to "postgres";
grant TRIGGER on table public."venue_nfc_support_requests" to "postgres";
grant TRUNCATE on table public."venue_nfc_support_requests" to "postgres";
grant UPDATE on table public."venue_nfc_support_requests" to "postgres";
grant DELETE on table public."venue_nfc_support_requests" to "service_role";
grant INSERT on table public."venue_nfc_support_requests" to "service_role";
grant MAINTAIN on table public."venue_nfc_support_requests" to "service_role";
grant REFERENCES on table public."venue_nfc_support_requests" to "service_role";
grant SELECT on table public."venue_nfc_support_requests" to "service_role";
grant TRIGGER on table public."venue_nfc_support_requests" to "service_role";
grant TRUNCATE on table public."venue_nfc_support_requests" to "service_role";
grant UPDATE on table public."venue_nfc_support_requests" to "service_role";
grant SELECT on table public."venue_ownership_claims" to "anon";
grant DELETE on table public."venue_ownership_claims" to "authenticated";
grant INSERT on table public."venue_ownership_claims" to "authenticated";
grant SELECT on table public."venue_ownership_claims" to "authenticated";
grant UPDATE on table public."venue_ownership_claims" to "authenticated";
grant DELETE on table public."venue_ownership_claims" to "postgres";
grant INSERT on table public."venue_ownership_claims" to "postgres";
grant MAINTAIN on table public."venue_ownership_claims" to "postgres";
grant REFERENCES on table public."venue_ownership_claims" to "postgres";
grant SELECT on table public."venue_ownership_claims" to "postgres";
grant TRIGGER on table public."venue_ownership_claims" to "postgres";
grant TRUNCATE on table public."venue_ownership_claims" to "postgres";
grant UPDATE on table public."venue_ownership_claims" to "postgres";
grant DELETE on table public."venue_ownership_claims" to "service_role";
grant INSERT on table public."venue_ownership_claims" to "service_role";
grant MAINTAIN on table public."venue_ownership_claims" to "service_role";
grant REFERENCES on table public."venue_ownership_claims" to "service_role";
grant SELECT on table public."venue_ownership_claims" to "service_role";
grant TRIGGER on table public."venue_ownership_claims" to "service_role";
grant TRUNCATE on table public."venue_ownership_claims" to "service_role";
grant UPDATE on table public."venue_ownership_claims" to "service_role";
grant SELECT on table public."venue_page_events" to "anon";
grant SELECT on table public."venue_page_events" to "authenticated";
grant DELETE on table public."venue_page_events" to "postgres";
grant INSERT on table public."venue_page_events" to "postgres";
grant MAINTAIN on table public."venue_page_events" to "postgres";
grant REFERENCES on table public."venue_page_events" to "postgres";
grant SELECT on table public."venue_page_events" to "postgres";
grant TRIGGER on table public."venue_page_events" to "postgres";
grant TRUNCATE on table public."venue_page_events" to "postgres";
grant UPDATE on table public."venue_page_events" to "postgres";
grant DELETE on table public."venue_page_events" to "service_role";
grant INSERT on table public."venue_page_events" to "service_role";
grant MAINTAIN on table public."venue_page_events" to "service_role";
grant REFERENCES on table public."venue_page_events" to "service_role";
grant SELECT on table public."venue_page_events" to "service_role";
grant TRIGGER on table public."venue_page_events" to "service_role";
grant TRUNCATE on table public."venue_page_events" to "service_role";
grant UPDATE on table public."venue_page_events" to "service_role";
grant SELECT on table public."venue_pilot_night_reports" to "anon";
grant DELETE on table public."venue_pilot_night_reports" to "authenticated";
grant INSERT on table public."venue_pilot_night_reports" to "authenticated";
grant SELECT on table public."venue_pilot_night_reports" to "authenticated";
grant UPDATE on table public."venue_pilot_night_reports" to "authenticated";
grant DELETE on table public."venue_pilot_night_reports" to "postgres";
grant INSERT on table public."venue_pilot_night_reports" to "postgres";
grant MAINTAIN on table public."venue_pilot_night_reports" to "postgres";
grant REFERENCES on table public."venue_pilot_night_reports" to "postgres";
grant SELECT on table public."venue_pilot_night_reports" to "postgres";
grant TRIGGER on table public."venue_pilot_night_reports" to "postgres";
grant TRUNCATE on table public."venue_pilot_night_reports" to "postgres";
grant UPDATE on table public."venue_pilot_night_reports" to "postgres";
grant DELETE on table public."venue_pilot_night_reports" to "service_role";
grant INSERT on table public."venue_pilot_night_reports" to "service_role";
grant MAINTAIN on table public."venue_pilot_night_reports" to "service_role";
grant REFERENCES on table public."venue_pilot_night_reports" to "service_role";
grant SELECT on table public."venue_pilot_night_reports" to "service_role";
grant TRIGGER on table public."venue_pilot_night_reports" to "service_role";
grant TRUNCATE on table public."venue_pilot_night_reports" to "service_role";
grant UPDATE on table public."venue_pilot_night_reports" to "service_role";
grant SELECT on table public."venue_referral_fee_change_requests" to "anon";
grant DELETE on table public."venue_referral_fee_change_requests" to "authenticated";
grant INSERT on table public."venue_referral_fee_change_requests" to "authenticated";
grant SELECT on table public."venue_referral_fee_change_requests" to "authenticated";
grant UPDATE on table public."venue_referral_fee_change_requests" to "authenticated";
grant DELETE on table public."venue_referral_fee_change_requests" to "postgres";
grant INSERT on table public."venue_referral_fee_change_requests" to "postgres";
grant MAINTAIN on table public."venue_referral_fee_change_requests" to "postgres";
grant REFERENCES on table public."venue_referral_fee_change_requests" to "postgres";
grant SELECT on table public."venue_referral_fee_change_requests" to "postgres";
grant TRIGGER on table public."venue_referral_fee_change_requests" to "postgres";
grant TRUNCATE on table public."venue_referral_fee_change_requests" to "postgres";
grant UPDATE on table public."venue_referral_fee_change_requests" to "postgres";
grant DELETE on table public."venue_referral_fee_change_requests" to "service_role";
grant INSERT on table public."venue_referral_fee_change_requests" to "service_role";
grant MAINTAIN on table public."venue_referral_fee_change_requests" to "service_role";
grant REFERENCES on table public."venue_referral_fee_change_requests" to "service_role";
grant SELECT on table public."venue_referral_fee_change_requests" to "service_role";
grant TRIGGER on table public."venue_referral_fee_change_requests" to "service_role";
grant TRUNCATE on table public."venue_referral_fee_change_requests" to "service_role";
grant UPDATE on table public."venue_referral_fee_change_requests" to "service_role";
grant SELECT on table public."venue_referral_fee_terms" to "anon";
grant DELETE on table public."venue_referral_fee_terms" to "authenticated";
grant INSERT on table public."venue_referral_fee_terms" to "authenticated";
grant SELECT on table public."venue_referral_fee_terms" to "authenticated";
grant UPDATE on table public."venue_referral_fee_terms" to "authenticated";
grant DELETE on table public."venue_referral_fee_terms" to "postgres";
grant INSERT on table public."venue_referral_fee_terms" to "postgres";
grant MAINTAIN on table public."venue_referral_fee_terms" to "postgres";
grant REFERENCES on table public."venue_referral_fee_terms" to "postgres";
grant SELECT on table public."venue_referral_fee_terms" to "postgres";
grant TRIGGER on table public."venue_referral_fee_terms" to "postgres";
grant TRUNCATE on table public."venue_referral_fee_terms" to "postgres";
grant UPDATE on table public."venue_referral_fee_terms" to "postgres";
grant DELETE on table public."venue_referral_fee_terms" to "service_role";
grant INSERT on table public."venue_referral_fee_terms" to "service_role";
grant MAINTAIN on table public."venue_referral_fee_terms" to "service_role";
grant REFERENCES on table public."venue_referral_fee_terms" to "service_role";
grant SELECT on table public."venue_referral_fee_terms" to "service_role";
grant TRIGGER on table public."venue_referral_fee_terms" to "service_role";
grant TRUNCATE on table public."venue_referral_fee_terms" to "service_role";
grant UPDATE on table public."venue_referral_fee_terms" to "service_role";
grant SELECT on table public."venue_sales_attributions" to "anon";
grant DELETE on table public."venue_sales_attributions" to "authenticated";
grant INSERT on table public."venue_sales_attributions" to "authenticated";
grant SELECT on table public."venue_sales_attributions" to "authenticated";
grant UPDATE on table public."venue_sales_attributions" to "authenticated";
grant DELETE on table public."venue_sales_attributions" to "postgres";
grant INSERT on table public."venue_sales_attributions" to "postgres";
grant MAINTAIN on table public."venue_sales_attributions" to "postgres";
grant REFERENCES on table public."venue_sales_attributions" to "postgres";
grant SELECT on table public."venue_sales_attributions" to "postgres";
grant TRIGGER on table public."venue_sales_attributions" to "postgres";
grant TRUNCATE on table public."venue_sales_attributions" to "postgres";
grant UPDATE on table public."venue_sales_attributions" to "postgres";
grant DELETE on table public."venue_sales_attributions" to "service_role";
grant INSERT on table public."venue_sales_attributions" to "service_role";
grant MAINTAIN on table public."venue_sales_attributions" to "service_role";
grant REFERENCES on table public."venue_sales_attributions" to "service_role";
grant SELECT on table public."venue_sales_attributions" to "service_role";
grant TRIGGER on table public."venue_sales_attributions" to "service_role";
grant TRUNCATE on table public."venue_sales_attributions" to "service_role";
grant UPDATE on table public."venue_sales_attributions" to "service_role";
grant DELETE on table public."venue_signup_requests" to "postgres";
grant INSERT on table public."venue_signup_requests" to "postgres";
grant MAINTAIN on table public."venue_signup_requests" to "postgres";
grant REFERENCES on table public."venue_signup_requests" to "postgres";
grant SELECT on table public."venue_signup_requests" to "postgres";
grant TRIGGER on table public."venue_signup_requests" to "postgres";
grant TRUNCATE on table public."venue_signup_requests" to "postgres";
grant UPDATE on table public."venue_signup_requests" to "postgres";
grant DELETE on table public."venue_signup_requests" to "service_role";
grant INSERT on table public."venue_signup_requests" to "service_role";
grant MAINTAIN on table public."venue_signup_requests" to "service_role";
grant REFERENCES on table public."venue_signup_requests" to "service_role";
grant SELECT on table public."venue_signup_requests" to "service_role";
grant TRIGGER on table public."venue_signup_requests" to "service_role";
grant TRUNCATE on table public."venue_signup_requests" to "service_role";
grant UPDATE on table public."venue_signup_requests" to "service_role";
grant SELECT on table public."venue_team_invitations" to "anon";
grant DELETE on table public."venue_team_invitations" to "authenticated";
grant INSERT on table public."venue_team_invitations" to "authenticated";
grant SELECT on table public."venue_team_invitations" to "authenticated";
grant UPDATE on table public."venue_team_invitations" to "authenticated";
grant DELETE on table public."venue_team_invitations" to "postgres";
grant INSERT on table public."venue_team_invitations" to "postgres";
grant MAINTAIN on table public."venue_team_invitations" to "postgres";
grant REFERENCES on table public."venue_team_invitations" to "postgres";
grant SELECT on table public."venue_team_invitations" to "postgres";
grant TRIGGER on table public."venue_team_invitations" to "postgres";
grant TRUNCATE on table public."venue_team_invitations" to "postgres";
grant UPDATE on table public."venue_team_invitations" to "postgres";
grant DELETE on table public."venue_team_invitations" to "service_role";
grant INSERT on table public."venue_team_invitations" to "service_role";
grant MAINTAIN on table public."venue_team_invitations" to "service_role";
grant REFERENCES on table public."venue_team_invitations" to "service_role";
grant SELECT on table public."venue_team_invitations" to "service_role";
grant TRIGGER on table public."venue_team_invitations" to "service_role";
grant TRUNCATE on table public."venue_team_invitations" to "service_role";
grant UPDATE on table public."venue_team_invitations" to "service_role";
grant SELECT on table public."venue_team_members" to "anon";
grant DELETE on table public."venue_team_members" to "authenticated";
grant INSERT on table public."venue_team_members" to "authenticated";
grant SELECT on table public."venue_team_members" to "authenticated";
grant UPDATE on table public."venue_team_members" to "authenticated";
grant DELETE on table public."venue_team_members" to "postgres";
grant INSERT on table public."venue_team_members" to "postgres";
grant MAINTAIN on table public."venue_team_members" to "postgres";
grant REFERENCES on table public."venue_team_members" to "postgres";
grant SELECT on table public."venue_team_members" to "postgres";
grant TRIGGER on table public."venue_team_members" to "postgres";
grant TRUNCATE on table public."venue_team_members" to "postgres";
grant UPDATE on table public."venue_team_members" to "postgres";
grant DELETE on table public."venue_team_members" to "service_role";
grant INSERT on table public."venue_team_members" to "service_role";
grant MAINTAIN on table public."venue_team_members" to "service_role";
grant REFERENCES on table public."venue_team_members" to "service_role";
grant SELECT on table public."venue_team_members" to "service_role";
grant TRIGGER on table public."venue_team_members" to "service_role";
grant TRUNCATE on table public."venue_team_members" to "service_role";
grant UPDATE on table public."venue_team_members" to "service_role";
grant DELETE on table public."venues" to "authenticated";
grant INSERT on table public."venues" to "authenticated";
grant UPDATE on table public."venues" to "authenticated";
grant DELETE on table public."venues" to "postgres";
grant INSERT on table public."venues" to "postgres";
grant MAINTAIN on table public."venues" to "postgres";
grant REFERENCES on table public."venues" to "postgres";
grant SELECT on table public."venues" to "postgres";
grant TRIGGER on table public."venues" to "postgres";
grant TRUNCATE on table public."venues" to "postgres";
grant UPDATE on table public."venues" to "postgres";
grant DELETE on table public."venues" to "service_role";
grant INSERT on table public."venues" to "service_role";
grant MAINTAIN on table public."venues" to "service_role";
grant REFERENCES on table public."venues" to "service_role";
grant SELECT on table public."venues" to "service_role";
grant TRIGGER on table public."venues" to "service_role";
grant TRUNCATE on table public."venues" to "service_role";
grant UPDATE ("created_at") on public."app_users" to "service_role";
grant UPDATE ("display_name") on public."app_users" to "service_role";
grant UPDATE ("dmca_suspended_at") on public."app_users" to "service_role";
grant UPDATE ("email") on public."app_users" to "service_role";
grant UPDATE ("id") on public."app_users" to "service_role";
grant UPDATE ("role") on public."app_users" to "service_role";
grant UPDATE ("updated_at") on public."app_users" to "service_role";
grant SELECT ("booking_url") on public."club_deals" to "anon";
grant SELECT ("booking_url") on public."club_deals" to "authenticated";
grant SELECT ("deal_description") on public."club_deals" to "anon";
grant SELECT ("deal_description") on public."club_deals" to "authenticated";
grant SELECT ("deal_terms") on public."club_deals" to "anon";
grant SELECT ("deal_terms") on public."club_deals" to "authenticated";
grant SELECT ("deal_title") on public."club_deals" to "anon";
grant SELECT ("deal_title") on public."club_deals" to "authenticated";
grant SELECT ("id") on public."club_deals" to "anon";
grant SELECT ("id") on public."club_deals" to "authenticated";
grant SELECT ("is_active") on public."club_deals" to "anon";
grant SELECT ("is_active") on public."club_deals" to "authenticated";
grant SELECT ("offer_type") on public."club_deals" to "anon";
grant SELECT ("offer_type") on public."club_deals" to "authenticated";
grant SELECT ("sort_order") on public."club_deals" to "anon";
grant SELECT ("sort_order") on public."club_deals" to "authenticated";
grant SELECT ("valid_days") on public."club_deals" to "anon";
grant SELECT ("valid_days") on public."club_deals" to "authenticated";
grant SELECT ("valid_end_time") on public."club_deals" to "anon";
grant SELECT ("valid_end_time") on public."club_deals" to "authenticated";
grant SELECT ("valid_start_time") on public."club_deals" to "anon";
grant SELECT ("valid_start_time") on public."club_deals" to "authenticated";
grant SELECT ("venue_id") on public."club_deals" to "anon";
grant SELECT ("venue_id") on public."club_deals" to "authenticated";
grant UPDATE ("handed_off_at") on public."club_shuttle_requests" to "service_role";
grant SELECT ("approved_at") on public."dancer_profiles" to "anon";
grant SELECT ("approved_at") on public."dancer_profiles" to "authenticated";
grant SELECT ("avatar_storage_path") on public."dancer_profiles" to "anon";
grant SELECT ("avatar_storage_path") on public."dancer_profiles" to "authenticated";
grant SELECT ("avatar_updated_at") on public."dancer_profiles" to "anon";
grant SELECT ("avatar_updated_at") on public."dancer_profiles" to "authenticated";
grant SELECT ("city") on public."dancer_profiles" to "anon";
grant SELECT ("city") on public."dancer_profiles" to "authenticated";
grant SELECT ("disabled_at") on public."dancer_profiles" to "anon";
grant SELECT ("disabled_at") on public."dancer_profiles" to "authenticated";
grant SELECT ("id") on public."dancer_profiles" to "anon";
grant SELECT ("id") on public."dancer_profiles" to "authenticated";
grant SELECT ("is_public") on public."dancer_profiles" to "anon";
grant SELECT ("is_public") on public."dancer_profiles" to "authenticated";
grant SELECT ("photo_review_status") on public."dancer_profiles" to "anon";
grant SELECT ("photo_review_status") on public."dancer_profiles" to "authenticated";
grant SELECT ("slug") on public."dancer_profiles" to "anon";
grant SELECT ("slug") on public."dancer_profiles" to "authenticated";
grant SELECT ("stage_name") on public."dancer_profiles" to "anon";
grant SELECT ("stage_name") on public."dancer_profiles" to "authenticated";
grant SELECT ("status") on public."dancer_profiles" to "anon";
grant SELECT ("status") on public."dancer_profiles" to "authenticated";
grant SELECT ("venue_approved_at") on public."dancer_profiles" to "anon";
grant SELECT ("venue_approved_at") on public."dancer_profiles" to "authenticated";
grant SELECT ("verification_status") on public."dancer_profiles" to "anon";
grant SELECT ("verification_status") on public."dancer_profiles" to "authenticated";
grant SELECT ("caption") on public."mydancr_tv_videos" to "anon";
grant SELECT ("caption") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("dancer_id") on public."mydancr_tv_videos" to "anon";
grant SELECT ("dancer_id") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("distribution_scope") on public."mydancr_tv_videos" to "anon";
grant SELECT ("distribution_scope") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("duration_seconds") on public."mydancr_tv_videos" to "anon";
grant SELECT ("duration_seconds") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("expires_at") on public."mydancr_tv_videos" to "anon";
grant SELECT ("expires_at") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("height") on public."mydancr_tv_videos" to "anon";
grant SELECT ("height") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("id") on public."mydancr_tv_videos" to "anon";
grant SELECT ("id") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("is_pinned") on public."mydancr_tv_videos" to "anon";
grant SELECT ("is_pinned") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("like_count") on public."mydancr_tv_videos" to "anon";
grant SELECT ("like_count") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("published_at") on public."mydancr_tv_videos" to "anon";
grant SELECT ("published_at") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("shift_id") on public."mydancr_tv_videos" to "anon";
grant SELECT ("shift_id") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("status") on public."mydancr_tv_videos" to "anon";
grant SELECT ("status") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("venue_featured") on public."mydancr_tv_videos" to "anon";
grant SELECT ("venue_featured") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("venue_id") on public."mydancr_tv_videos" to "anon";
grant SELECT ("venue_id") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("venue_tag_status") on public."mydancr_tv_videos" to "anon";
grant SELECT ("venue_tag_status") on public."mydancr_tv_videos" to "authenticated";
grant SELECT ("width") on public."mydancr_tv_videos" to "anon";
grant SELECT ("width") on public."mydancr_tv_videos" to "authenticated";
grant UPDATE ("read_at") on public."notifications" to "authenticated";
grant SELECT ("checked_in_at") on public."shifts" to "anon";
grant SELECT ("checked_in_at") on public."shifts" to "authenticated";
grant SELECT ("checked_out_at") on public."shifts" to "anon";
grant SELECT ("checked_out_at") on public."shifts" to "authenticated";
grant SELECT ("dancer_id") on public."shifts" to "anon";
grant SELECT ("dancer_id") on public."shifts" to "authenticated";
grant SELECT ("ends_at") on public."shifts" to "anon";
grant SELECT ("ends_at") on public."shifts" to "authenticated";
grant SELECT ("id") on public."shifts" to "anon";
grant SELECT ("id") on public."shifts" to "authenticated";
grant SELECT ("location_status") on public."shifts" to "anon";
grant SELECT ("location_status") on public."shifts" to "authenticated";
grant SELECT ("location_verification_expires_at") on public."shifts" to "anon";
grant SELECT ("location_verification_expires_at") on public."shifts" to "authenticated";
grant SELECT ("shift_date") on public."shifts" to "anon";
grant SELECT ("shift_date") on public."shifts" to "authenticated";
grant SELECT ("shift_source") on public."shifts" to "anon";
grant SELECT ("shift_source") on public."shifts" to "authenticated";
grant SELECT ("starts_at") on public."shifts" to "anon";
grant SELECT ("starts_at") on public."shifts" to "authenticated";
grant SELECT ("status") on public."shifts" to "anon";
grant SELECT ("status") on public."shifts" to "authenticated";
grant SELECT ("timezone") on public."shifts" to "anon";
grant SELECT ("timezone") on public."shifts" to "authenticated";
grant SELECT ("venue_id") on public."shifts" to "anon";
grant SELECT ("venue_id") on public."shifts" to "authenticated";
grant SELECT ("address") on public."venues" to "anon";
grant SELECT ("address") on public."venues" to "authenticated";
grant UPDATE ("address") on public."venues" to "service_role";
grant SELECT ("city") on public."venues" to "anon";
grant SELECT ("city") on public."venues" to "authenticated";
grant UPDATE ("city") on public."venues" to "service_role";
grant SELECT ("closes_at") on public."venues" to "anon";
grant SELECT ("closes_at") on public."venues" to "authenticated";
grant UPDATE ("closes_at") on public."venues" to "service_role";
grant SELECT ("cover_image_storage_path") on public."venues" to "anon";
grant SELECT ("cover_image_storage_path") on public."venues" to "authenticated";
grant UPDATE ("cover_image_storage_path") on public."venues" to "service_role";
grant SELECT ("cover_image_updated_at") on public."venues" to "anon";
grant SELECT ("cover_image_updated_at") on public."venues" to "authenticated";
grant UPDATE ("cover_image_updated_at") on public."venues" to "service_role";
grant UPDATE ("created_at") on public."venues" to "service_role";
grant SELECT ("id") on public."venues" to "anon";
grant SELECT ("id") on public."venues" to "authenticated";
grant UPDATE ("id") on public."venues" to "service_role";
grant SELECT ("is_active") on public."venues" to "anon";
grant SELECT ("is_active") on public."venues" to "authenticated";
grant SELECT ("latitude") on public."venues" to "anon";
grant SELECT ("latitude") on public."venues" to "authenticated";
grant UPDATE ("latitude") on public."venues" to "service_role";
grant SELECT ("logo_storage_path") on public."venues" to "anon";
grant SELECT ("logo_storage_path") on public."venues" to "authenticated";
grant UPDATE ("logo_storage_path") on public."venues" to "service_role";
grant SELECT ("logo_updated_at") on public."venues" to "anon";
grant SELECT ("logo_updated_at") on public."venues" to "authenticated";
grant UPDATE ("logo_updated_at") on public."venues" to "service_role";
grant SELECT ("longitude") on public."venues" to "anon";
grant SELECT ("longitude") on public."venues" to "authenticated";
grant UPDATE ("longitude") on public."venues" to "service_role";
grant SELECT ("name") on public."venues" to "anon";
grant SELECT ("name") on public."venues" to "authenticated";
grant UPDATE ("name") on public."venues" to "service_role";
grant SELECT ("opens_at") on public."venues" to "anon";
grant SELECT ("opens_at") on public."venues" to "authenticated";
grant UPDATE ("opens_at") on public."venues" to "service_role";
grant UPDATE ("owner_user_id") on public."venues" to "service_role";
grant UPDATE ("page_review_notes") on public."venues" to "service_role";
grant UPDATE ("page_review_sent_at") on public."venues" to "service_role";
grant UPDATE ("page_review_status") on public."venues" to "service_role";
grant UPDATE ("page_reviewed_at") on public."venues" to "service_role";
grant UPDATE ("page_reviewed_by_user_id") on public."venues" to "service_role";
grant SELECT ("phone") on public."venues" to "anon";
grant SELECT ("phone") on public."venues" to "authenticated";
grant UPDATE ("phone") on public."venues" to "service_role";
grant SELECT ("published_at") on public."venues" to "anon";
grant SELECT ("published_at") on public."venues" to "authenticated";
grant UPDATE ("published_at") on public."venues" to "service_role";
grant UPDATE ("qr_code_label") on public."venues" to "service_role";
grant UPDATE ("qr_code_storage_path") on public."venues" to "service_role";
grant UPDATE ("qr_code_updated_at") on public."venues" to "service_role";
grant SELECT ("slug") on public."venues" to "anon";
grant SELECT ("slug") on public."venues" to "authenticated";
grant UPDATE ("slug") on public."venues" to "service_role";
grant SELECT ("state") on public."venues" to "anon";
grant SELECT ("state") on public."venues" to "authenticated";
grant UPDATE ("state") on public."venues" to "service_role";
grant SELECT ("timezone") on public."venues" to "anon";
grant SELECT ("timezone") on public."venues" to "authenticated";
grant UPDATE ("timezone") on public."venues" to "service_role";
grant UPDATE ("updated_at") on public."venues" to "service_role";
grant SELECT ("website") on public."venues" to "anon";
grant SELECT ("website") on public."venues" to "authenticated";
grant UPDATE ("website") on public."venues" to "service_role";
grant EXECUTE on function public.activate_approved_venue_request_manager() to "postgres";
grant EXECUTE on function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb) to "postgres";
grant EXECUTE on function public.activate_dancer_shift_from_nfc(uuid,uuid,uuid,jsonb) to "service_role";
grant EXECUTE on function public.activate_waiting_nats_agent_exports() to "postgres";
grant EXECUTE on function public.activate_waiting_nats_exports() to "postgres";
grant EXECUTE on function public.admin_manage_dancer_earning(uuid,uuid,text,text) to "postgres";
grant EXECUTE on function public.admin_manage_dancer_earning(uuid,uuid,text,text) to "service_role";
grant EXECUTE on function public.admin_retry_dancer_payout(uuid,uuid,text) to "postgres";
grant EXECUTE on function public.admin_retry_dancer_payout(uuid,uuid,text) to "service_role";
grant EXECUTE on function public.admin_update_payout_settings(uuid,boolean,text,integer,integer,text) to "postgres";
grant EXECUTE on function public.admin_update_payout_settings(uuid,boolean,text,integer,integer,text) to "service_role";
grant EXECUTE on function public.advance_avatar_review_version() to "postgres";
grant EXECUTE on function public.advance_dancer_avatar_version() to "postgres";
grant EXECUTE on function public.agent_allocations_for_venue(uuid,integer,timestamp with time zone) to "postgres";
grant EXECUTE on function public.agent_allocations_for_venue(uuid,integer,timestamp with time zone) to "service_role";
grant EXECUTE on function public.apply_club_invoice_payment(uuid,integer,text,timestamp with time zone,text,text,text) to "postgres";
grant EXECUTE on function public.apply_club_invoice_payment(uuid,integer,text,timestamp with time zone,text,text,text) to "service_role";
grant EXECUTE on function public.apply_dmca_takedown(uuid,uuid,text) to "postgres";
grant EXECUTE on function public.apply_dmca_takedown(uuid,uuid,text) to "service_role";
grant EXECUTE on function public.approve_dancer_venue_affiliation_from_nfc(uuid,uuid,uuid,jsonb) to "postgres";
grant EXECUTE on function public.approve_dancer_venue_affiliation_from_nfc(uuid,uuid,uuid,jsonb) to "service_role";
grant EXECUTE on function public.approve_dancer_venue_affiliation(text,uuid) to "postgres";
grant EXECUTE on function public.approve_dancer_venue_affiliation(text,uuid) to "service_role";
grant EXECUTE on function public.approve_venue_deal_removal(uuid,uuid,uuid) to "postgres";
grant EXECUTE on function public.approve_venue_deal_removal(uuid,uuid,uuid) to "service_role";
grant EXECUTE on function public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamp with time zone) to "postgres";
grant EXECUTE on function public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamp with time zone) to "service_role";
grant EXECUTE on function public.assign_dancer_profile_link() to "postgres";
grant EXECUTE on function public.attribute_approved_venue_agent_referral() to "postgres";
grant EXECUTE on function public.authorize_dancer_profile_from_nfc(uuid) to "postgres";
grant EXECUTE on function public.authorize_dancer_profile_from_nfc(uuid) to "service_role";
grant EXECUTE on function public.capture_gallery_media_reference_history() to "postgres";
grant EXECUTE on function public.change_venue_publication_safely(uuid,uuid,text,jsonb) to "postgres";
grant EXECUTE on function public.change_venue_publication_safely(uuid,uuid,text,jsonb) to "service_role";
grant EXECUTE on function public.claim_dancer_payout_dispatch(uuid) to "postgres";
grant EXECUTE on function public.claim_dancer_payout_dispatch(uuid) to "service_role";
grant EXECUTE on function public.claim_gallery_storage_retirement(uuid,text) to "postgres";
grant EXECUTE on function public.claim_gallery_storage_retirement(uuid,text) to "service_role";
grant EXECUTE on function public.claim_nats_agent_commission_exports(integer) to "postgres";
grant EXECUTE on function public.claim_nats_agent_commission_exports(integer) to "service_role";
grant EXECUTE on function public.claim_nats_commission_exports(integer) to "postgres";
grant EXECUTE on function public.claim_nats_commission_exports(integer) to "service_role";
grant EXECUTE on function public.claim_payment_provider_webhook(text,text,text,text) to "postgres";
grant EXECUTE on function public.claim_payment_provider_webhook(text,text,text,text) to "service_role";
grant EXECUTE on function public.claim_payment_webhook_attempt(text,text,text,text) to "postgres";
grant EXECUTE on function public.claim_payment_webhook_attempt(text,text,text,text) to "service_role";
grant EXECUTE on function public.clear_dancer_avatar_safely(uuid,uuid,text,timestamp with time zone) to "postgres";
grant EXECUTE on function public.clear_dancer_avatar_safely(uuid,uuid,text,timestamp with time zone) to "service_role";
grant EXECUTE on function public.club_deal_is_liquor_related(text,text,text,text) to "authenticated";
grant EXECUTE on function public.club_deal_is_liquor_related(text,text,text,text) to "postgres";
grant EXECUTE on function public.club_deal_is_liquor_related(text,text,text,text) to "service_role";
grant EXECUTE on function public.complete_dancer_payout_batch(uuid,text,timestamp with time zone) to "postgres";
grant EXECUTE on function public.complete_dancer_payout_batch(uuid,text,timestamp with time zone) to "service_role";
grant EXECUTE on function public.complete_nats_agent_commission_export(uuid,text,jsonb) to "postgres";
grant EXECUTE on function public.complete_nats_agent_commission_export(uuid,text,jsonb) to "service_role";
grant EXECUTE on function public.complete_nats_commission_export(uuid,text,jsonb) to "postgres";
grant EXECUTE on function public.complete_nats_commission_export(uuid,text,jsonb) to "service_role";
grant EXECUTE on function public.confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb) to "postgres";
grant EXECUTE on function public.confirm_deal_redemption_from_nfc(text,uuid,uuid,jsonb) to "service_role";
grant EXECUTE on function public.confirm_deal_redemption_with_financial_details(text,jsonb) to "postgres";
grant EXECUTE on function public.confirm_deal_redemption(text,jsonb) to "postgres";
grant EXECUTE on function public.confirm_dmca_counter_forwarding(uuid,uuid) to "postgres";
grant EXECUTE on function public.confirm_dmca_counter_forwarding(uuid,uuid) to "service_role";
grant EXECUTE on function public.confirm_venue_request_email() to "postgres";
grant EXECUTE on function public.consume_request_rate_limit(text,uuid,uuid,integer,integer,integer) to "postgres";
grant EXECUTE on function public.consume_request_rate_limit(text,uuid,uuid,integer,integer,integer) to "service_role";
grant EXECUTE on function public.create_club_invoice_draft(uuid,date,date,timestamp with time zone,uuid[]) to "postgres";
grant EXECUTE on function public.create_club_invoice_draft(uuid,date,date,timestamp with time zone,uuid[]) to "service_role";
grant EXECUTE on function public.create_dancer_avatar_review(uuid,uuid,text,timestamp with time zone,text,text,text) to "postgres";
grant EXECUTE on function public.create_dancer_avatar_review(uuid,uuid,text,timestamp with time zone,text,text,text) to "service_role";
grant EXECUTE on function public.create_dancer_payout_batch(uuid,text,uuid[],text) to "postgres";
grant EXECUTE on function public.create_dancer_payout_batch(uuid,text,uuid[],text) to "service_role";
grant EXECUTE on function public.create_support_message_safely(uuid,text,uuid,text,text,uuid) to "postgres";
grant EXECUTE on function public.create_support_message_safely(uuid,text,uuid,text,text,uuid) to "service_role";
grant EXECUTE on function public.create_venue_default_club_deal() to "postgres";
grant EXECUTE on function public.create_venue_nfc_support_safely(uuid,uuid,uuid,text,text,uuid) to "postgres";
grant EXECUTE on function public.create_venue_nfc_support_safely(uuid,uuid,uuid,text,text,uuid) to "service_role";
grant EXECUTE on function public.current_user_role() to PUBLIC;
grant EXECUTE on function public.current_user_role() to "postgres";
grant EXECUTE on function public.enforce_active_venue_nfc_capacity() to "postgres";
grant EXECUTE on function public.enforce_available_venue_ownership_claim() to "postgres";
grant EXECUTE on function public.enforce_mydancr_tv_profile_video_limit() to "postgres";
grant EXECUTE on function public.enforce_shift_verification_server_only() to "postgres";
grant EXECUTE on function public.enforce_unique_nats_affiliate_login() to "postgres";
grant EXECUTE on function public.enforce_verified_venue_affiliation_for_checkin() to "postgres";
grant EXECUTE on function public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[]) to "postgres";
grant EXECUTE on function public.enqueue_dancer_content_reviews(uuid,uuid,text,uuid[]) to "service_role";
grant EXECUTE on function public.enqueue_nats_agent_commission_export() to "postgres";
grant EXECUTE on function public.enqueue_nats_commission_export() to "postgres";
grant EXECUTE on function public.ensure_dancer_primary_photo(uuid,uuid) to "postgres";
grant EXECUTE on function public.ensure_dancer_primary_photo(uuid,uuid) to "service_role";
grant EXECUTE on function public.ensure_mydancr_funded_commission() to "postgres";
grant EXECUTE on function public.fail_nats_agent_commission_export(uuid,text,text,jsonb) to "postgres";
grant EXECUTE on function public.fail_nats_agent_commission_export(uuid,text,text,jsonb) to "service_role";
grant EXECUTE on function public.fail_nats_commission_export(uuid,text,text,jsonb) to "postgres";
grant EXECUTE on function public.fail_nats_commission_export(uuid,text,text,jsonb) to "service_role";
grant EXECUTE on function public.finalize_pending_dancer_nfc_enrollment(uuid,uuid,jsonb) to "postgres";
grant EXECUTE on function public.finalize_pending_dancer_nfc_enrollment(uuid,uuid,jsonb) to "service_role";
grant EXECUTE on function public.finalize_platform_import_safely(uuid,uuid,text,jsonb) to "postgres";
grant EXECUTE on function public.finalize_platform_import_safely(uuid,uuid,text,jsonb) to "service_role";
grant EXECUTE on function public.flag_dancer_payout_dispatch_review(uuid,text) to "postgres";
grant EXECUTE on function public.flag_dancer_payout_dispatch_review(uuid,text) to "service_role";
grant EXECUTE on function public.flag_paid_payout_recovery_safely(uuid,text,text) to "postgres";
grant EXECUTE on function public.flag_paid_payout_recovery_safely(uuid,text,text) to "service_role";
grant EXECUTE on function public.flag_reversed_nats_commission() to "postgres";
grant EXECUTE on function public.flag_voided_nats_agent_commission() to "postgres";
grant EXECUTE on function public.gallery_storage_family(text) to "postgres";
grant EXECUTE on function public.get_admin_dancer_financial_summary() to "postgres";
grant EXECUTE on function public.get_admin_dancer_financial_summary() to "service_role";
grant EXECUTE on function public.get_dancer_earnings_summary(uuid) to "postgres";
grant EXECUTE on function public.get_dancer_earnings_summary(uuid) to "service_role";
grant EXECUTE on function public.get_due_club_invoice_reminders(timestamp with time zone,integer) to "postgres";
grant EXECUTE on function public.get_due_club_invoice_reminders(timestamp with time zone,integer) to "service_role";
grant EXECUTE on function public.get_mydancr_tv_metric_counts(uuid[],timestamp with time zone) to "postgres";
grant EXECUTE on function public.get_mydancr_tv_metric_counts(uuid[],timestamp with time zone) to "service_role";
grant EXECUTE on function public.get_public_dancer_metric_counts(uuid[],uuid[],timestamp with time zone) to "postgres";
grant EXECUTE on function public.get_public_dancer_metric_counts(uuid[],uuid[],timestamp with time zone) to "service_role";
grant EXECUTE on function public.get_public_venue_metric_counts(uuid[],timestamp with time zone) to "postgres";
grant EXECUTE on function public.get_public_venue_metric_counts(uuid[],timestamp with time zone) to "service_role";
grant EXECUTE on function public.get_ranking_metric_batch(uuid[],timestamp with time zone) to "postgres";
grant EXECUTE on function public.get_ranking_metric_batch(uuid[],timestamp with time zone) to "service_role";
grant EXECUTE on function public.guard_gallery_storage_reference() to "postgres";
grant EXECUTE on function public.handle_new_auth_user() to "postgres";
grant EXECUTE on function public.handoff_club_shuttle_request(uuid) to "postgres";
grant EXECUTE on function public.handoff_club_shuttle_request(uuid) to "service_role";
grant EXECUTE on function public.has_active_club_deal(venues) to "anon";
grant EXECUTE on function public.has_active_club_deal(venues) to "authenticated";
grant EXECUTE on function public.has_active_club_deal(venues) to "postgres";
grant EXECUTE on function public.has_active_club_deal(venues) to "service_role";
grant EXECUTE on function public.invalidate_account_self_pause() to "postgres";
grant EXECUTE on function public.invalidate_dmca_enforcement_state() to "postgres";
grant EXECUTE on function public.is_admin() to PUBLIC;
grant EXECUTE on function public.is_admin() to "postgres";
grant EXECUTE on function public.is_current_dancer_owner(uuid) to "anon";
grant EXECUTE on function public.is_current_dancer_owner(uuid) to "authenticated";
grant EXECUTE on function public.is_current_dancer_owner(uuid) to "postgres";
grant EXECUTE on function public.is_current_dancer_owner(uuid) to "service_role";
grant EXECUTE on function public.is_current_venue_owner(uuid) to "anon";
grant EXECUTE on function public.is_current_venue_owner(uuid) to "authenticated";
grant EXECUTE on function public.is_current_venue_owner(uuid) to "postgres";
grant EXECUTE on function public.is_current_venue_owner(uuid) to "service_role";
grant EXECUTE on function public.is_nats_eligible_club_deal_earning(uuid) to "postgres";
grant EXECUTE on function public.is_nats_eligible_club_deal_earning(uuid) to "service_role";
grant EXECUTE on function public.issue_and_confirm_deal_redemption_from_nfc(text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,timestamp with time zone,jsonb) to "postgres";
grant EXECUTE on function public.issue_and_confirm_deal_redemption_from_nfc(text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,timestamp with time zone,jsonb) to "service_role";
grant EXECUTE on function public.issue_dancer_venue_verification_token(uuid,uuid,uuid,text,text,timestamp with time zone) to "postgres";
grant EXECUTE on function public.issue_dancer_venue_verification_token(uuid,uuid,uuid,text,text,timestamp with time zone) to "service_role";
grant EXECUTE on function public.issue_venue_claim_code(uuid,uuid,text,timestamp with time zone) to "postgres";
grant EXECUTE on function public.issue_venue_claim_code(uuid,uuid,text,timestamp with time zone) to "service_role";
grant EXECUTE on function public.lock_sales_agent_hierarchy_writes() to "postgres";
grant EXECUTE on function public.log_qr_redemption_issued() to "postgres";
grant EXECUTE on function public.mark_dancer_payout_processing(uuid,text) to "postgres";
grant EXECUTE on function public.mark_dancer_payout_processing(uuid,text) to "service_role";
grant EXECUTE on function public.mydancr_placeholder_venue_address(text,text) to PUBLIC;
grant EXECUTE on function public.mydancr_placeholder_venue_address(text,text) to "postgres";
grant EXECUTE on function public.notify_dancer_profile_live() to "postgres";
grant EXECUTE on function public.notify_venue_card_live() to "postgres";
grant EXECUTE on function public.prepare_dancer_earning() to "postgres";
grant EXECUTE on function public.preserve_dancer_commission_eligibility() to "postgres";
grant EXECUTE on function public.process_dancer_location_verification(uuid,uuid,text,numeric,numeric,numeric,timestamp with time zone) to "postgres";
grant EXECUTE on function public.prohibit_financial_record_delete() to "postgres";
grant EXECUTE on function public.provision_admin_venue_nfc_tag(uuid,uuid,uuid,text,text,text) to "postgres";
grant EXECUTE on function public.provision_admin_venue_nfc_tag(uuid,uuid,uuid,text,text,text) to "service_role";
grant EXECUTE on function public.provision_app_account_safely(uuid,text,text,text,text) to "postgres";
grant EXECUTE on function public.provision_app_account_safely(uuid,text,text,text,text) to "service_role";
grant EXECUTE on function public.publish_approved_dancer_avatar(uuid,timestamp with time zone,text,jsonb,jsonb,jsonb,boolean,uuid,text,text,timestamp with time zone) to "postgres";
grant EXECUTE on function public.publish_approved_dancer_avatar(uuid,timestamp with time zone,text,jsonb,jsonb,jsonb,boolean,uuid,text,text,timestamp with time zone) to "service_role";
grant EXECUTE on function public.publish_approved_dancer_gallery_photo(uuid,timestamp with time zone,text,jsonb,jsonb,jsonb,boolean,text,uuid,text) to "postgres";
grant EXECUTE on function public.publish_approved_dancer_gallery_photo(uuid,timestamp with time zone,text,jsonb,jsonb,jsonb,boolean,text,uuid,text) to "service_role";
grant EXECUTE on function public.recenter_dancer_avatar_safely(uuid,uuid,text,timestamp with time zone,text,text,uuid) to "postgres";
grant EXECUTE on function public.recenter_dancer_avatar_safely(uuid,uuid,text,timestamp with time zone,text,text,uuid) to "service_role";
grant EXECUTE on function public.record_account_recovery_event(text,text,text,text,integer,integer,integer) to "postgres";
grant EXECUTE on function public.record_account_recovery_event(text,text,text,text,integer,integer,integer) to "service_role";
grant EXECUTE on function public.record_dancer_earning_status_history() to "postgres";
grant EXECUTE on function public.record_deal_lifecycle_event_safely(text,text,uuid,text,text,text,text) to "postgres";
grant EXECUTE on function public.record_deal_lifecycle_event_safely(text,text,uuid,text,text,text,text) to "service_role";
grant EXECUTE on function public.record_mydancr_tv_review_decision() to "postgres";
grant EXECUTE on function public.record_nfc_tag_scan(uuid) to "postgres";
grant EXECUTE on function public.record_nfc_tag_scan(uuid) to "service_role";
grant EXECUTE on function public.redeem_venue_signup_code(uuid,uuid) to "postgres";
grant EXECUTE on function public.redeem_venue_signup_code(uuid,uuid) to "service_role";
grant EXECUTE on function public.redeem_venue_team_invitation(uuid,uuid) to "postgres";
grant EXECUTE on function public.redeem_venue_team_invitation(uuid,uuid) to "service_role";
grant EXECUTE on function public.register_and_activate_dancer_tap(uuid,uuid,uuid,jsonb) to "postgres";
grant EXECUTE on function public.register_and_activate_dancer_tap(uuid,uuid,uuid,jsonb) to "service_role";
grant EXECUTE on function public.register_dancer_nfc_enrollment(uuid,uuid,uuid,jsonb) to "postgres";
grant EXECUTE on function public.register_dancer_nfc_enrollment(uuid,uuid,uuid,jsonb) to "service_role";
grant EXECUTE on function public.reject_admin_venue_referral_fee_request(uuid,uuid,text) to "postgres";
grant EXECUTE on function public.reject_admin_venue_referral_fee_request(uuid,uuid,text) to "service_role";
grant EXECUTE on function public.reject_retired_payout_provider() to "postgres";
grant EXECUTE on function public.release_dancer_payout_batch(uuid,text,text) to "postgres";
grant EXECUTE on function public.release_dancer_payout_batch(uuid,text,text) to "service_role";
grant EXECUTE on function public.release_pending_dancer_earnings(integer) to "postgres";
grant EXECUTE on function public.release_pending_dancer_earnings(integer) to "service_role";
grant EXECUTE on function public.request_dancer_payout(uuid,text,text,boolean) to "postgres";
grant EXECUTE on function public.request_dancer_payout(uuid,text,text,boolean) to "service_role";
grant EXECUTE on function public.require_enrolled_club_deal_earning() to "postgres";
grant EXECUTE on function public.require_submitted_dancer_profile_for_active_affiliation() to "postgres";
grant EXECUTE on function public.require_venue_request_email_confirmation() to "postgres";
grant EXECUTE on function public.restore_dmca_case(uuid,uuid,text) to "postgres";
grant EXECUTE on function public.restore_dmca_case(uuid,uuid,text) to "service_role";
grant EXECUTE on function public.review_dancer_content_safely(uuid,uuid,text,uuid,text,text,text,jsonb) to "postgres";
grant EXECUTE on function public.review_dancer_content_safely(uuid,uuid,text,uuid,text,text,text,jsonb) to "service_role";
grant EXECUTE on function public.review_dancer_profile_safely(uuid,uuid,text,text,jsonb) to "postgres";
grant EXECUTE on function public.review_dancer_profile_safely(uuid,uuid,text,text,jsonb) to "service_role";
grant EXECUTE on function public.review_venue_ownership_claim(uuid,uuid,text,text) to "postgres";
grant EXECUTE on function public.review_venue_signup_request(uuid,uuid,text,uuid,text,text,timestamp with time zone) to "postgres";
grant EXECUTE on function public.review_venue_signup_request(uuid,uuid,text,uuid,text,text,timestamp with time zone) to "service_role";
grant EXECUTE on function public.revoke_dancer_venue_affiliation(uuid,uuid,text) to "postgres";
grant EXECUTE on function public.revoke_dancer_venue_affiliation(uuid,uuid,text) to "service_role";
grant EXECUTE on function public.revoke_venue_claim_code(uuid,uuid) to "postgres";
grant EXECUTE on function public.revoke_venue_claim_code(uuid,uuid) to "service_role";
grant EXECUTE on function public.rls_auto_enable() to "postgres";
grant EXECUTE on function public.rotate_admin_venue_nfc_tag(uuid,uuid,uuid,text) to "postgres";
grant EXECUTE on function public.rotate_admin_venue_nfc_tag(uuid,uuid,uuid,text) to "service_role";
grant EXECUTE on function public.save_dancer_social_links_safely(uuid,uuid,jsonb,text[]) to "postgres";
grant EXECUTE on function public.save_dancer_social_links_safely(uuid,uuid,jsonb,text[]) to "service_role";
grant EXECUTE on function public.set_admin_sales_agent(uuid,uuid,uuid,smallint,text) to "postgres";
grant EXECUTE on function public.set_admin_sales_agent(uuid,uuid,uuid,smallint,text) to "service_role";
grant EXECUTE on function public.set_admin_venue_nfc_tag_status(uuid,uuid,text) to "postgres";
grant EXECUTE on function public.set_admin_venue_nfc_tag_status(uuid,uuid,text) to "service_role";
grant EXECUTE on function public.set_admin_venue_referral_fee(uuid,uuid,integer,text,timestamp with time zone,text,text,uuid) to "postgres";
grant EXECUTE on function public.set_admin_venue_referral_fee(uuid,uuid,integer,text,timestamp with time zone,text,text,uuid) to "service_role";
grant EXECUTE on function public.set_shift_date_from_starts_at() to "postgres";
grant EXECUTE on function public.settle_dancer_commission_event(uuid,text) to "postgres";
grant EXECUTE on function public.settle_deal_revenue_event(uuid,text,text) to "authenticated";
grant EXECUTE on function public.settle_deal_revenue_event(uuid,text,text) to "postgres";
grant EXECUTE on function public.slugify(text) to "postgres";
grant EXECUTE on function public.submit_dmca_counter_notice_safely(uuid,uuid,jsonb) to "postgres";
grant EXECUTE on function public.submit_dmca_counter_notice_safely(uuid,uuid,jsonb) to "service_role";
grant EXECUTE on function public.sync_media_like_count() to "postgres";
grant EXECUTE on function public.sync_verified_auth_email() to "postgres";
grant EXECUTE on function public.touch_venue_club_deal_request_updated_at() to "postgres";
grant EXECUTE on function public.touch_venue_pilot_night_report_updated_at() to "postgres";
grant EXECUTE on function public.touch_venue_signup_request_updated_at() to "postgres";
grant EXECUTE on function public.transition_dancer_publication_safely(uuid,text,uuid) to "postgres";
grant EXECUTE on function public.transition_dancer_publication_safely(uuid,text,uuid) to "service_role";
grant EXECUTE on function public.transition_dmca_admin_case(uuid,uuid,text,text,timestamp with time zone,text) to "postgres";
grant EXECUTE on function public.transition_dmca_admin_case(uuid,uuid,text,text,timestamp with time zone,text) to "service_role";
grant EXECUTE on function public.transition_own_account_safely(uuid,text) to "postgres";
grant EXECUTE on function public.transition_own_account_safely(uuid,text) to "service_role";
grant EXECUTE on function public.unique_dancer_slug(text,uuid) to "postgres";
grant EXECUTE on function public.upsert_venue_pilot_night_report(uuid,uuid,date,integer,integer,text) to "postgres";
grant EXECUTE on function public.upsert_venue_pilot_night_report(uuid,uuid,date,integer,integer,text) to "service_role";
grant EXECUTE on function public.validate_mydancr_tv_video_links() to "postgres";
grant EXECUTE on function public.validate_sales_agent_hierarchy() to "postgres";
grant EXECUTE on function public.void_agent_commissions_with_revenue() to "postgres";
grant EXECUTE on function public.void_generated_deal_redemption(uuid,text) to "authenticated";
grant EXECUTE on function public.void_generated_deal_redemption(uuid,text) to "postgres";
grant USAGE on type public."account_state" to PUBLIC;
grant USAGE on type public."account_state" to "postgres";
grant USAGE on type public."dancer_status" to PUBLIC;
grant USAGE on type public."dancer_status" to "postgres";
grant USAGE on type public."notification_channel" to PUBLIC;
grant USAGE on type public."notification_channel" to "postgres";
grant USAGE on type public."notification_type" to PUBLIC;
grant USAGE on type public."notification_type" to "postgres";
grant USAGE on type public."review_status" to PUBLIC;
grant USAGE on type public."review_status" to "postgres";
grant USAGE on type public."shift_status" to PUBLIC;
grant USAGE on type public."shift_status" to "postgres";
grant USAGE on type public."social_platform" to PUBLIC;
grant USAGE on type public."social_platform" to "postgres";
grant USAGE on type public."user_role" to PUBLIC;
grant USAGE on type public."user_role" to "postgres";
alter default privileges for role postgres in schema "public" revoke all on sequences from PUBLIC,"postgres","anon","authenticated","service_role";
alter default privileges for role postgres in schema "public" revoke all on functions from PUBLIC,"postgres","anon","authenticated","service_role";
alter default privileges for role postgres in schema "public" revoke all on tables from PUBLIC,"postgres","anon","authenticated","service_role";
alter default privileges for role postgres in schema "public" grant SELECT on sequences to "postgres";
alter default privileges for role postgres in schema "public" grant UPDATE on sequences to "postgres";
alter default privileges for role postgres in schema "public" grant USAGE on sequences to "postgres";
alter default privileges for role postgres in schema "public" grant EXECUTE on functions to "postgres";
alter default privileges for role postgres in schema "public" grant DELETE on tables to "postgres";
alter default privileges for role postgres in schema "public" grant INSERT on tables to "postgres";
alter default privileges for role postgres in schema "public" grant MAINTAIN on tables to "postgres";
alter default privileges for role postgres in schema "public" grant REFERENCES on tables to "postgres";
alter default privileges for role postgres in schema "public" grant SELECT on tables to "postgres";
alter default privileges for role postgres in schema "public" grant TRIGGER on tables to "postgres";
alter default privileges for role postgres in schema "public" grant TRUNCATE on tables to "postgres";
alter default privileges for role postgres in schema "public" grant UPDATE on tables to "postgres";
alter default privileges for role postgres in schema "public" grant DELETE on tables to "service_role";
alter default privileges for role postgres in schema "public" grant INSERT on tables to "service_role";
alter default privileges for role postgres in schema "public" grant MAINTAIN on tables to "service_role";
alter default privileges for role postgres in schema "public" grant REFERENCES on tables to "service_role";
alter default privileges for role postgres in schema "public" grant SELECT on tables to "service_role";
alter default privileges for role postgres in schema "public" grant TRIGGER on tables to "service_role";
alter default privileges for role postgres in schema "public" grant TRUNCATE on tables to "service_role";
alter default privileges for role postgres in schema "public" grant UPDATE on tables to "service_role";
revoke all on schema public from PUBLIC,"anon","authenticated","pg_database_owner","postgres","service_role";
grant USAGE on schema public to PUBLIC;
grant USAGE on schema public to "anon";
grant USAGE on schema public to "authenticated";
grant CREATE on schema public to "pg_database_owner";
grant USAGE on schema public to "pg_database_owner";
grant USAGE on schema public to "postgres";
grant USAGE on schema public to "service_role";
revoke all on storage."objects" from PUBLIC,"anon","authenticated","service_role";
revoke all on storage."buckets" from PUBLIC,"anon","authenticated","service_role";
grant DELETE on storage."buckets" to "anon";
grant INSERT on storage."buckets" to "anon";
grant MAINTAIN on storage."buckets" to "anon";
grant REFERENCES on storage."buckets" to "anon";
grant SELECT on storage."buckets" to "anon";
grant TRIGGER on storage."buckets" to "anon";
grant TRUNCATE on storage."buckets" to "anon";
grant UPDATE on storage."buckets" to "anon";
grant DELETE on storage."buckets" to "authenticated";
grant INSERT on storage."buckets" to "authenticated";
grant MAINTAIN on storage."buckets" to "authenticated";
grant REFERENCES on storage."buckets" to "authenticated";
grant SELECT on storage."buckets" to "authenticated";
grant TRIGGER on storage."buckets" to "authenticated";
grant TRUNCATE on storage."buckets" to "authenticated";
grant UPDATE on storage."buckets" to "authenticated";
grant DELETE on storage."buckets" to "service_role";
grant INSERT on storage."buckets" to "service_role";
grant MAINTAIN on storage."buckets" to "service_role";
grant REFERENCES on storage."buckets" to "service_role";
grant SELECT on storage."buckets" to "service_role";
grant TRIGGER on storage."buckets" to "service_role";
grant TRUNCATE on storage."buckets" to "service_role";
grant UPDATE on storage."buckets" to "service_role";
grant DELETE on storage."objects" to "anon";
grant INSERT on storage."objects" to "anon";
grant MAINTAIN on storage."objects" to "anon";
grant REFERENCES on storage."objects" to "anon";
grant SELECT on storage."objects" to "anon";
grant TRIGGER on storage."objects" to "anon";
grant TRUNCATE on storage."objects" to "anon";
grant UPDATE on storage."objects" to "anon";
grant DELETE on storage."objects" to "authenticated";
grant INSERT on storage."objects" to "authenticated";
grant MAINTAIN on storage."objects" to "authenticated";
grant REFERENCES on storage."objects" to "authenticated";
grant SELECT on storage."objects" to "authenticated";
grant TRIGGER on storage."objects" to "authenticated";
grant TRUNCATE on storage."objects" to "authenticated";
grant UPDATE on storage."objects" to "authenticated";
grant DELETE on storage."objects" to "service_role";
grant INSERT on storage."objects" to "service_role";
grant MAINTAIN on storage."objects" to "service_role";
grant REFERENCES on storage."objects" to "service_role";
grant SELECT on storage."objects" to "service_role";
grant TRIGGER on storage."objects" to "service_role";
grant TRUNCATE on storage."objects" to "service_role";
grant UPDATE on storage."objects" to "service_role";
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('dancer-photos','dancer-photos',false,10485760,array['image/jpeg','image/png','image/webp']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('dancr-image-moderation-review','dancr-image-moderation-review',false,10485760,array['image/jpeg','image/png','image/webp']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('dancr-image-moderation-temp','dancr-image-moderation-temp',false,10485760,array['image/jpeg','image/png','image/webp']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('dancr-media-originals','dancr-media-originals',false,10485760,array['image/jpeg','image/png','image/webp']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('mydancr-tv-videos','mydancr-tv-videos',false,78643200,array['video/mp4','video/webm','video/quicktime']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('venue-cover-images','venue-cover-images',true,10485760,array['image/jpeg','image/png','image/webp']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('venue-logo-images','venue-logo-images',true,10485760,array['image/jpeg','image/png','image/webp']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('venue-ownership-proofs','venue-ownership-proofs',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('venue-qr-codes','venue-qr-codes',true,10485760,array['image/jpeg','image/png','image/webp']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('verification-documents','verification-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']::text[]) on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
commit;
