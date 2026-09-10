-- Add an unused server-only event boundary before changing application callers.
-- No existing records, tables, policies, indexes or triggers are changed.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create function public.record_deal_lifecycle_event_safely(
  p_token text,
  p_event_type text,
  p_actor_user_id uuid default null,
  p_session_id text default null,
  p_ip_address text default null,
  p_user_agent text default null,
  p_device_fingerprint text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '3s'
as $function$
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
$function$;

revoke all on function public.record_deal_lifecycle_event_safely(text,text,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_deal_lifecycle_event_safely(text,text,uuid,text,text,text,text) to service_role;
comment on function public.record_deal_lifecycle_event_safely(text,text,uuid,text,text,text,text) is
  'Server-only non-paying redemption engagement. Atomically preserves first activity time and records each saved/shared/scanner-opened event; never confirms redemption or awards revenue.';
commit;
