create table public.admin_review_email_events (
 event_key text,
 kind text,
 source_id uuid,
 title text,
 body text,
 created_at timestamptz,
 primary key(event_key)
);
create table public.admin_review_email_deliveries (
 id uuid,
 event_key text,
 recipient_id uuid,
 notification_id uuid,
 destination text,
 status text,
 attempts integer,
 created_at timestamptz,
 next_attempt_at timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 provider_id text,
 outcome text,
 finished_at timestamptz,
 mailbox text,
 primary key(id)
);
create table public.dancer_media_email_deliveries (
 id uuid,
 notification_id uuid,
 recipient_id uuid,
 title text,
 body text,
 payload jsonb,
 destination text,
 status text,
 attempts integer,
 created_at timestamptz,
 next_attempt_at timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 provider_id text,
 outcome text,
 finished_at timestamptz,
 summary_id uuid,
 primary key(id)
);
create table public.venue_email_deliveries (
 id uuid,
 notification_id uuid,
 recipient_id uuid,
 venue_id uuid,
 notification_type text,
 title text,
 body text,
 payload jsonb,
 destination text,
 status text,
 attempts integer,
 created_at timestamptz,
 next_attempt_at timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 provider_id text,
 outcome text,
 finished_at timestamptz,
 primary key(id)
);
create table public.internal_request_email_deliveries (
 id uuid,
 table_label text,
 stage_name text,
 venue_name text,
 state text,
 attempts integer,
 available_at timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 created_at timestamptz,
 finished_at timestamptz,
 primary key(id)
);
create table public.internal_request_push_deliveries (
 id uuid,
 request_id uuid,
 recipient_id uuid,
 state text,
 attempts integer,
 available_at timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 created_at timestamptz,
 finished_at timestamptz,
 event_kind text,
 primary key(id)
);
create table public.dancer_table_request_deliveries (
 id uuid,
 request_id uuid,
 recipient_id uuid,
 channel text,
 table_label text,
 venue_name text,
 state text,
 attempts integer,
 available_at timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 created_at timestamptz,
 finished_at timestamptz,
 primary key(id)
);
create table public.web_push_receipts (
 delivery_id uuid,
 endpoint_hash text,
 delivered_at timestamptz,
 primary key(delivery_id,endpoint_hash)
);
create table public.support_ai_runs (
 id uuid,
 thread_id uuid,
 trigger_message_id uuid,
 response_message_id uuid,
 provider_response_id text,
 model text,
 outcome text,
 escalation_category text,
 escalation_priority text,
 escalation_reason text,
 confidence numeric,
 moderation jsonb,
 error_code text,
 created_at timestamptz,
 primary key(id)
);
create table public.dancer_photo_hair_analysis (
 id uuid,
 dancer_id uuid,
 photo_id uuid,
 storage_path text,
 status text,
 color text,
 confidence double precision,
 model text,
 created_at timestamptz,
 attempts integer,
 next_attempt_at timestamptz,
 locked_until timestamptz,
 lease_token uuid,
 primary key(id)
);
create table public.venue_email_events (
 event_key text,
 venue_id uuid,
 created_at timestamptz,
 primary key(event_key)
);
create table public.club_media_permissions (
 venue_id uuid,
 dancer_id uuid,
 source text,
 media_id uuid,
 content_version text,
 decision text,
 reviewer_id uuid,
 notes text,
 provenance text,
 revision uuid,
 reviewed_at timestamptz,
 primary key(venue_id,source,media_id)
);
create function public.dancer_club_media(uuid[]) returns table(id uuid,source text,content_version text) language sql as $$select null::uuid,null::text,null::text where false$$;
