-- Add the transaction before switching profile-save callers. Preserve review history.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create function public.save_dancer_social_links_safely(
  p_dancer_id uuid, p_actor_user_id uuid, p_links jsonb, p_review_platforms text[]
) returns jsonb
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '3s'
as $function$
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
$function$;

revoke all on function public.save_dancer_social_links_safely(uuid,uuid,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.save_dancer_social_links_safely(uuid,uuid,jsonb,text[]) to service_role;
comment on function public.save_dancer_social_links_safely(uuid,uuid,jsonb,text[]) is
  'Service-only active-owner canonical social save plus pending reviews. Preserves unchanged links and completed history; rolls back all changes if saving or queueing cannot be confirmed.';
commit;
