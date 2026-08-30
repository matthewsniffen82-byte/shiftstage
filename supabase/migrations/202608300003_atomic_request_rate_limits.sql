begin;

create table if not exists public.request_rate_limit_buckets (
  namespace text not null,
  key_type text not null,
  key_hash uuid not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  expires_at timestamptz not null,
  primary key (namespace, key_type, key_hash),
  constraint request_rate_limit_namespace_check
    check (namespace ~ '^[a-z0-9_]{1,40}$'),
  constraint request_rate_limit_key_type_check
    check (key_type in ('ip', 'subject')),
  constraint request_rate_limit_count_check
    check (request_count > 0)
);

create index if not exists request_rate_limit_buckets_expiry_idx
  on public.request_rate_limit_buckets (expires_at);

alter table public.request_rate_limit_buckets enable row level security;
revoke all on table public.request_rate_limit_buckets from public, anon, authenticated;

create or replace function public.consume_request_rate_limit(
  p_namespace text,
  p_ip_hash uuid,
  p_subject_hash uuid,
  p_window_seconds integer,
  p_ip_limit integer,
  p_subject_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.consume_request_rate_limit(
  text, uuid, uuid, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.consume_request_rate_limit(
  text, uuid, uuid, integer, integer, integer
) to service_role;

comment on table public.request_rate_limit_buckets is
  'Private fixed-window counters keyed only by HMAC-derived UUIDs; raw network addresses and user input are never stored.';
comment on function public.consume_request_rate_limit(
  text, uuid, uuid, integer, integer, integer
) is 'Atomically consumes IP and subject request-rate buckets for trusted server callers.';

commit;
