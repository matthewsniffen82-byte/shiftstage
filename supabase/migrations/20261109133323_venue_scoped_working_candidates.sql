-- Keep the cursor over raw identities. Filtering a 1,000-row page in SQL
-- before returning its cursor could silently truncate the remaining city.
create function public.get_public_directory_candidates(p_city text, p_after uuid, p_working_venue uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with dancers as materialized (
    select d.id,d.city from public.dancer_profiles d
    where status='approved' and verification_status='approved' and is_public and disabled_at is null
      and (p_city='' or lower(city)=lower(p_city)) and (p_after is null or id>p_after)
    -- Restrict the identity scan before paging. The lateral lookup below still
    -- resolves competing live shifts in the same order as public card hydration.
    and (p_working_venue is null or exists (
      select 1 from public.shifts s where s.dancer_id=d.id and s.venue_id=p_working_venue
        and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
        and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
        and isfinite(s.location_verification_expires_at)
    ))
    order by d.id limit 1000
  ), affiliations as materialized (
    select * from public.public_dancer_club_affiliations(array(select id from dancers)) where p_working_venue is null
  ), candidates as materialized (
    select d.id,d.city,coalesce(live.venue_id,a.venue_id) venue_id,live.expires
    from dancers d left join affiliations a on a.dancer_id=d.id
    left join lateral (
      select s.venue_id,s.location_verification_expires_at expires
      from public.shifts s join public.venues v on v.id=s.venue_id
      where s.dancer_id=d.id and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
        and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
        and isfinite(s.location_verification_expires_at) and v.is_active and public.has_active_club_deal(v)
      order by s.starts_at,s.id limit 1
    ) live on true
  ), clubs as (
    select venue_id,array_agg(id) ids from candidates where venue_id is not null group by venue_id
  ), visible as materialized (
    select c.venue_id,e.dancer_id from clubs c
    cross join lateral private.club_media_eligibility(c.venue_id,c.ids) e
    where e.eligible and exists (
      -- Match the approved gallery window hydrated by getLiveDancerDiscovery.
      select 1 from (select p.id,p.storage_path from public.dancer_photos p
        where p.dancer_id=e.dancer_id and p.review_status='approved'
        order by p.is_primary desc nulls last,p.is_pinned desc nulls last,p.sort_order asc nulls first,p.id limit 50) gallery
      where nullif(trim(gallery.storage_path),'') is not null and trim(gallery.storage_path) !~* '^https?://'
        and e.media @> jsonb_build_array(jsonb_build_object('photoId',gallery.id))
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'city',c.city,'venueId',c.venue_id,
    'availableUntil',c.expires,'cardEligible',(p_working_venue is null or (c.venue_id is not distinct from p_working_venue and c.expires is not null))
      and (c.venue_id is null or v.dancer_id is not null)) order by c.id),'[]'::jsonb)
  from candidates c left join visible v on v.dancer_id=c.id and v.venue_id=c.venue_id
$$;

revoke all on function public.get_public_directory_candidates(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_public_directory_candidates(text,uuid,uuid) to service_role;

-- Keep the existing city-wide RPC and its paging contract for older clients.
create or replace function public.get_public_directory_candidates(p_city text, p_after uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select public.get_public_directory_candidates(p_city,p_after,null::uuid)
$$;
