begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Venue-owned labels never replace guest identities or leave the manager API.
alter table public.venue_vip_members add column nickname text not null default ''
 check (length(nickname)<=80 and nickname=trim(nickname) and nickname !~ '[[:cntrl:]]');

create function public.vip_set_member_nickname(p_actor uuid,p_venue uuid,p_member uuid,p_nickname text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_nickname text:=trim(p_nickname); v_id uuid;
begin
 if not public.vip_manager_access(p_actor,p_venue) then
   raise exception 'MANAGER_REQUIRED' using errcode='42501';
 end if;
 if v_nickname is null or length(v_nickname)>80 or v_nickname ~ '[[:cntrl:]]' then
   raise exception 'INVALID_NICKNAME' using errcode='22023';
 end if;
 update public.venue_vip_members set nickname=v_nickname
 where id=p_member and venue_id=p_venue and active returning id into v_id;
 if v_id is null then raise exception 'MEMBER_UNAVAILABLE' using errcode='P0002'; end if;
 return jsonb_build_object('id',v_id,'nickname',v_nickname);
end;
$$;

create function public.vip_search_members(p_actor uuid,p_venue uuid,p_search text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_search text:=lower(trim(p_search)); v_result jsonb;
begin
 if not public.vip_manager_access(p_actor,p_venue) then
   raise exception 'MANAGER_REQUIRED' using errcode='42501';
 end if;
 if v_search is null or length(v_search)>80 or v_search ~ '[[:cntrl:]]'
 or p_offset is null or p_offset<0 or p_offset>50000 then
   raise exception 'INVALID_MEMBER_SEARCH' using errcode='22023';
 end if;
 -- Literal substring matching keeps punctuation and SQL wildcards harmless.
 with matches as materialized (
   select m.id,m.display_name,m.nickname from public.venue_vip_members m
   where m.venue_id=p_venue and m.active
   and (v_search='' or strpos(lower(m.display_name),v_search)>0 or strpos(lower(m.nickname),v_search)>0)
 ), page as (
   select * from matches order by lower(coalesce(nullif(nickname,''),display_name)),id limit 50 offset p_offset
 ) select jsonb_build_object(
   'members',coalesce((select jsonb_agg(to_jsonb(p) order by lower(coalesce(nullif(p.nickname,''),p.display_name)),p.id) from page p),'[]'::jsonb),
   'memberCount',(select count(*) from matches),
   'membersHasMore',(select count(*)>p_offset+50 from matches)
 ) into v_result;
 return v_result;
end;
$$;

revoke all on function public.vip_set_member_nickname(uuid,uuid,uuid,text),public.vip_search_members(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.vip_set_member_nickname(uuid,uuid,uuid,text),public.vip_search_members(uuid,uuid,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
