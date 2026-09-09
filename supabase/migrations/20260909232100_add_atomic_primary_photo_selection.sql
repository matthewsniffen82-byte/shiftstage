-- Add an unused service-only selector before switching deletion callers.
-- No existing profile, photo, policy or index is changed by this migration.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public.ensure_dancer_primary_photo(p_dancer_id uuid, p_actor_user_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '3s'
as $function$
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
$function$;

revoke all on function public.ensure_dancer_primary_photo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_dancer_primary_photo(uuid, uuid) to service_role;
comment on function public.ensure_dancer_primary_photo(uuid, uuid) is
  'Service-only, owner/admin-authorized fallback after photo removal. Preserves an existing active primary; otherwise promotes one approved photo atomically under the gallery publisher profile lock.';
commit;
