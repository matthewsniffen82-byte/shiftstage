begin;

-- Visibility is independent of the club's completed approval. Keep the same
-- account-before-venue lock order as account pause and publication transitions.
create function public.set_venue_visibility_safely(
  p_actor_user_id uuid, p_venue_id uuid, p_visible boolean
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $function$
declare
  v_actor public.app_users%rowtype;
  v_venue public.venues%rowtype;
  v_owner uuid;
  v_result jsonb;
  v_affected bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'VENUE_VISIBILITY_SERVICE_REQUIRED' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_venue_id is null or p_visible is null then
    raise exception 'VENUE_VISIBILITY_INVALID_INPUT' using errcode = '22023';
  end if;
  select owner_user_id into v_owner from public.venues where id = p_venue_id;
  if not found then raise exception 'VENUE_VISIBILITY_NOT_FOUND' using errcode = '42501'; end if;
  perform id from public.app_users where id = p_actor_user_id or id = v_owner order by id for share;
  select * into v_actor from public.app_users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.account_state <> 'active' or v_actor.dmca_suspended_at is not null then
    raise exception 'VENUE_VISIBILITY_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select * into v_venue from public.venues where id = p_venue_id for update;
  if not found or v_venue.owner_user_id is distinct from v_owner then
    raise exception 'VENUE_VISIBILITY_OWNER_CHANGED' using errcode = '40001';
  end if;
  if v_venue.page_review_status <> 'published' or v_venue.published_at is null then
    raise exception 'VENUE_VISIBILITY_APPROVAL_REQUIRED' using errcode = '40001';
  end if;
  if p_visible and (v_owner is null or not exists (
    select 1 from public.app_users where id = v_owner and account_state = 'active' and dmca_suspended_at is null
  )) then
    raise exception 'VENUE_VISIBILITY_ACTIVE_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if p_visible and not public.has_active_club_deal(v_venue) then
    raise exception 'VENUE_VISIBILITY_ACTIVE_DEAL_REQUIRED' using errcode = '40001';
  end if;
  -- Existing departure guards and account-pause invalidation still run.
  update public.venues set is_active = p_visible where id = p_venue_id returning to_jsonb(venues) into v_result;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then raise exception 'VENUE_VISIBILITY_WRITE_MISMATCH' using errcode = '40001'; end if;
  select to_jsonb(v) into v_result from public.venues v where id = p_venue_id;
  if v_result->'is_active' is distinct from to_jsonb(p_visible)
    or v_result->>'page_review_status' is distinct from 'published'
    or (v_result->>'published_at')::timestamptz is distinct from v_venue.published_at then
    raise exception 'VENUE_VISIBILITY_WRITE_MISMATCH' using errcode = '40001';
  end if;
  return v_result;
end;
$function$;
revoke all on function public.set_venue_visibility_safely(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_venue_visibility_safely(uuid,uuid,boolean) to service_role;
commit;
