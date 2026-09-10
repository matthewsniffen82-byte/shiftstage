-- Protect only pending photo/social review requests; preserve completed history.
-- Add the service-only batch function before switching the profile-save callers.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create unique index approval_reviews_one_pending_content_idx
  on public.approval_reviews(dancer_id, review_type)
  where status = 'pending' and (review_type like 'photo:%' or review_type like 'social_link:%');

create function public.enqueue_dancer_content_reviews(
  p_dancer_id uuid, p_actor_user_id uuid, p_target_type text, p_target_ids uuid[]
) returns integer
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '3s'
as $function$
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
$function$;

revoke all on function public.enqueue_dancer_content_reviews(uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.enqueue_dancer_content_reviews(uuid, uuid, text, uuid[]) to service_role;
comment on function public.enqueue_dancer_content_reviews(uuid, uuid, text, uuid[]) is
  'Service-only active-owner content review enqueue. Locks profile and owned targets; preserves existing decisions/history and suppresses duplicate pending photo/social requests atomically.';
commit;
