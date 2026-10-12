begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Private, derived appearance estimates. No image bytes, face embeddings or guest identities.
create table public.dancer_photo_hair_analysis (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  photo_id uuid references public.dancer_photos(id) on delete set null,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending','processing','complete','failed','unavailable')),
  color text not null default 'unknown' check (color in ('black','brown','blonde','red','gray_white','vivid','multicolor','unknown')),
  confidence double precision check (confidence >= 0 and confidence <= 1),
  model text,
  created_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  unique(photo_id,storage_path),
  check (color = 'unknown' or (status = 'complete' and confidence is not null and confidence >= 0.8))
);
create index dancer_photo_hair_analysis_dancer on public.dancer_photo_hair_analysis(dancer_id);
create index dancer_photo_hair_analysis_queue on public.dancer_photo_hair_analysis(next_attempt_at,created_at)
  where status in ('pending','processing');
alter table public.dancer_photo_hair_analysis enable row level security;
revoke all on public.dancer_photo_hair_analysis from public,anon,authenticated;
grant select,insert,update,delete on public.dancer_photo_hair_analysis to service_role;

-- Half-open periods follow each channel's actual photo; null analysis means no main photo.
create table public.dancer_hair_color_periods (
  id uuid primary key default gen_random_uuid(),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  channel text not null check (channel in ('internal','external')),
  analysis_id uuid references public.dancer_photo_hair_analysis(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create unique index dancer_hair_color_periods_current on public.dancer_hair_color_periods(dancer_id,channel) where ended_at is null;
create index dancer_hair_color_periods_lookup on public.dancer_hair_color_periods(dancer_id,channel,started_at desc);
create index dancer_hair_color_periods_analysis on public.dancer_hair_color_periods(analysis_id);
alter table public.dancer_hair_color_periods enable row level security;
revoke all on public.dancer_hair_color_periods from public,anon,authenticated;
grant select,insert,update,delete on public.dancer_hair_color_periods to service_role;

create table public.dancer_hair_color_tracking (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default now()
);
insert into public.dancer_hair_color_tracking(singleton) values(true);
alter table public.dancer_hair_color_tracking enable row level security;
revoke all on public.dancer_hair_color_tracking from public,anon,authenticated;
grant select on public.dancer_hair_color_tracking to service_role;

create function public.refresh_dancer_hair_color_periods(p_dancer_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_channel text; v_photo uuid; v_path text; v_analysis uuid; v_current uuid; v_current_analysis uuid; v_time timestamptz;
begin
  -- Photo writers already take this profile-before-photo lock. Serialize both channels.
  perform id from public.dancer_profiles where id=p_dancer_id for update;
  if not found then return; end if;
  v_time := clock_timestamp();
  foreach v_channel in array array['external','internal'] loop
    v_photo := null; v_path := null; v_analysis := null; v_current := null;
    select p.id,p.storage_path into v_photo,v_path
    from public.dancer_photos p
    left join public.dancer_internal_main_photos c on c.dancer_id=p.dancer_id and c.photo_id=p.id
    where p.dancer_id=p_dancer_id and p.review_status='approved' and nullif(p.storage_path,'') is not null
      and (v_channel='internal' or p.is_primary)
    order by (v_channel='internal' and c.photo_id is not null) desc,p.is_primary desc,p.sort_order,p.id limit 1;
    if v_photo is not null then
      insert into public.dancer_photo_hair_analysis(dancer_id,photo_id,storage_path)
        values(p_dancer_id,v_photo,v_path) on conflict(photo_id,storage_path) do nothing;
      select id into v_analysis from public.dancer_photo_hair_analysis where photo_id=v_photo and storage_path=v_path;
    end if;
    select id,analysis_id into v_current,v_current_analysis from public.dancer_hair_color_periods
      where dancer_id=p_dancer_id and channel=v_channel and ended_at is null for update;
    if v_current is not null and v_current_analysis is not distinct from v_analysis then continue; end if;
    update public.dancer_hair_color_periods set ended_at=v_time where id=v_current;
    insert into public.dancer_hair_color_periods(dancer_id,channel,analysis_id,started_at) values(p_dancer_id,v_channel,v_analysis,v_time);
  end loop;
end $$;
revoke all on function public.refresh_dancer_hair_color_periods(uuid) from public,anon,authenticated;
grant execute on function public.refresh_dancer_hair_color_periods(uuid) to service_role;

-- Both source tables have service-only writes. Invoker triggers add no privileged write path.
create function public.capture_dancer_hair_color_photo() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform public.refresh_dancer_hair_color_periods(old.dancer_id); end if;
  if tg_op='INSERT' or (tg_op='UPDATE' and new.dancer_id is distinct from old.dancer_id) then
    perform public.refresh_dancer_hair_color_periods(new.dancer_id);
  end if;
  return null;
end $$;
revoke all on function public.capture_dancer_hair_color_photo() from public,anon,authenticated;
grant execute on function public.capture_dancer_hair_color_photo() to service_role;
create trigger capture_dancer_photo_hair_color after insert or delete or update of storage_path,is_primary,sort_order,review_status,dancer_id
  on public.dancer_photos for each row execute function public.capture_dancer_hair_color_photo();
create trigger capture_dancer_internal_hair_color after insert or update or delete
  on public.dancer_internal_main_photos for each row execute function public.capture_dancer_hair_color_photo();

create function public.claim_dancer_hair_color_jobs(p_limit integer default 4)
returns setof public.dancer_photo_hair_analysis language plpgsql security invoker set search_path = '' as $$
begin
  if p_limit is null or p_limit<1 or p_limit>4 then raise exception 'Invalid job limit' using errcode='22023'; end if;
  update public.dancer_photo_hair_analysis set status='failed',lease_token=null,locked_until=null
    where status='processing' and locked_until<now() and attempts>=3;
  update public.dancer_photo_hair_analysis set status='unavailable',lease_token=null,locked_until=null
    where photo_id is null and status in ('pending','processing');
  return query with candidates as (
    select id from public.dancer_photo_hair_analysis
    where attempts<3 and ((status='pending' and next_attempt_at<=now()) or (status='processing' and locked_until<now()))
    order by next_attempt_at,created_at limit p_limit for update skip locked
  ) update public.dancer_photo_hair_analysis a set status='processing',attempts=a.attempts+1,
      lease_token=gen_random_uuid(),locked_until=now()+interval '2 minutes'
    from candidates c where a.id=c.id returning a.*;
end $$;
revoke all on function public.claim_dancer_hair_color_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_dancer_hair_color_jobs(integer) to service_role;

create function public.get_venue_hair_color_analytics(p_venue_id uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_venue_id is null or p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until)
    or p_until<=p_since or p_until-p_since>interval '93 days' then raise exception 'Invalid report period' using errcode='22023'; end if;
  with internal_events as (
    select dancer_id,created_at occurred_at,status from public.internal_roster_requests
      where venue_id=p_venue_id and dancer_id is not null and created_at>=p_since and created_at<p_until
  ), external_events as (
    select dancer_id,occurred_at,event_type metric from public.venue_interactions
      where venue_id=p_venue_id and dancer_id is not null and occurred_at>=p_since and occurred_at<p_until
        and event_type in ('dancer_profile','club_page','directions','free_entry','transport')
    union all select s.dancer_id,g.created_at,'going' from public.going_signals g join public.shifts s on s.id=g.shift_id
      where s.venue_id=p_venue_id and s.dancer_id is not null and g.created_at>=p_since and g.created_at<p_until
    union all select dancer_id,generated_at,'claims' from public.qr_redemptions
      where venue_id=p_venue_id and admission_pass_version=1 and dancer_id is not null and generated_at>=p_since and generated_at<p_until
    -- Attribute a conversion to the photo used at claim, even if the dancer changed it before arrival.
    union all select dancer_id,generated_at,'admissions' from public.qr_redemptions
      where venue_id=p_venue_id and admission_pass_version=1 and dancer_id is not null and status='redeemed' and redeemed_at>=p_since and redeemed_at<p_until
  ), internal_colors as (
    select e.*,coalesce(a.color,'unknown') color from internal_events e
    left join public.dancer_hair_color_periods h on h.dancer_id=e.dancer_id and h.channel='internal'
      and e.occurred_at>=h.started_at and (h.ended_at is null or e.occurred_at<h.ended_at)
    left join public.dancer_photo_hair_analysis a on a.id=h.analysis_id and a.status='complete'
  ), external_colors as (
    select e.*,coalesce(a.color,'unknown') color from external_events e
    left join public.dancer_hair_color_periods h on h.dancer_id=e.dancer_id and h.channel='external'
      and e.occurred_at>=h.started_at and (h.ended_at is null or e.occurred_at<h.ended_at)
    left join public.dancer_photo_hair_analysis a on a.id=h.analysis_id and a.status='complete'
  ), internal_groups as (
    select color,count(distinct dancer_id) dancers,jsonb_build_object(
      'requests',count(*),'completed',count(*) filter(where status='completed'),'pending',count(*) filter(where status='pending'),
      'acknowledged',count(*) filter(where status='acknowledged'),'cancelled',count(*) filter(where status='cancelled')) metrics
    from internal_colors group by color
  ), external_totals as (
    select color,metric,count(*) total from external_colors group by color,metric
  ), external_groups as (
    select color,(select count(distinct dancer_id) from external_colors e where e.color=t.color) dancers,
      jsonb_object_agg(metric,total) metrics from external_totals t group by color
  ) select jsonb_build_object(
    'trackingStartedAt',(select started_at from public.dancer_hair_color_tracking where singleton),
    'internal',coalesce((select jsonb_agg(to_jsonb(g) order by (g.color='unknown'),g.color) from internal_groups g),'[]'::jsonb),
    'external',coalesce((select jsonb_agg(to_jsonb(g) order by (g.color='unknown'),g.color) from external_groups g),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.get_venue_hair_color_analytics(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_hair_color_analytics(uuid,timestamptz,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
