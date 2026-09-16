begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- One row per browser action; retrying the same event cannot inflate totals.
create table public.venue_interactions (
  id uuid primary key,
  venue_id uuid not null references public.venues(id) on delete cascade,
  dancer_id uuid references public.dancer_profiles(id) on delete set null,
  video_id uuid references public.mydancr_tv_videos(id) on delete set null,
  event_type text not null check (event_type in ('card_impression','club_page','directions','free_entry','transport','follow','unfollow','share','share_completed','dancer_profile','tv_open','phone','website')),
  source text not null check (source in ('venue_scroll_card','venue_detail','dancer_profile','tv')),
  session_id text not null check (length(session_id) between 8 and 120),
  occurred_at timestamptz not null default now()
);
create index venue_interactions_period on public.venue_interactions(venue_id,occurred_at);
alter table public.venue_interactions enable row level security;
revoke all on public.venue_interactions from public,anon,authenticated;
grant select,insert on public.venue_interactions to service_role;

create table public.venue_analytics_tracking (
  singleton boolean primary key default true check (singleton),
  started_at timestamptz not null default now()
);
insert into public.venue_analytics_tracking default values;
alter table public.venue_analytics_tracking enable row level security;
revoke all on public.venue_analytics_tracking from public,anon,authenticated;
grant select on public.venue_analytics_tracking to service_role;

create table public.venue_video_passes (
  pass_id uuid primary key references public.qr_redemptions(id) on delete cascade,
  video_id uuid not null references public.mydancr_tv_videos(id) on delete cascade
);
alter table public.venue_video_passes enable row level security;
revoke all on public.venue_video_passes from public,anon,authenticated;
grant select,insert on public.venue_video_passes to service_role;

create function public.issue_video_admission_pass(p_token text,p_deal_id uuid,p_session_id uuid,p_customer_id uuid,p_source text,p_dancer_id uuid,p_shift_id uuid,p_arrival_method text,p_video_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare receipt jsonb;
begin
  receipt := public.issue_admission_pass(p_token,p_deal_id,p_session_id,p_customer_id,p_source,p_dancer_id,p_shift_id,p_arrival_method);
  -- Only a newly issued pass can receive attribution. Reopening an older pass
  -- cannot transfer its credit to another video.
  if receipt->>'token'=p_token and p_video_id is not null then
    insert into public.venue_video_passes(pass_id,video_id)
    select r.id,v.id from public.qr_redemptions r join public.mydancr_tv_videos v on v.venue_id=r.venue_id
    where r.redemption_token=p_token and v.id=p_video_id and v.venue_tag_status='confirmed'
      and v.status='approved' and v.published_at is not null and (v.expires_at is null or v.expires_at>now());
  end if;
  return receipt;
end $$;
revoke all on function public.issue_video_admission_pass(text,uuid,uuid,uuid,text,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.issue_video_admission_pass(text,uuid,uuid,uuid,text,uuid,uuid,text,uuid) to service_role;

-- Raw browser identifiers never leave this service-only aggregate boundary.
create function public.get_venue_subscription_analytics(p_venue_id uuid,p_since timestamptz,p_until timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_venue_id is null or p_since is null or p_until is null or not isfinite(p_since) or not isfinite(p_until)
    or p_since >= p_until or p_until-p_since > interval '31 days' then
    raise exception using errcode='22023',message='A venue and a reporting period of up to 31 days are required.';
  end if;
  with periods as (
    select 'current' label,p_since start_at,p_until end_at
    union all select 'previous',p_since-(p_until-p_since),p_since
  ), totals as (
    select label,jsonb_build_object(
      'admissions',(select count(*) from public.qr_redemptions r where r.venue_id=p_venue_id and r.admission_pass_version=1 and r.status='redeemed' and r.redeemed_at>=p.start_at and r.redeemed_at<p.end_at),
      'claims',(select count(*) from public.qr_redemptions r where r.venue_id=p_venue_id and r.admission_pass_version=1 and r.generated_at>=p.start_at and r.generated_at<p.end_at),
      'cohortRedemptions',(select count(*) from public.qr_redemptions r where r.venue_id=p_venue_id and r.admission_pass_version=1 and r.generated_at>=p.start_at and r.generated_at<p.end_at and r.status='redeemed'),
      'directions',(select count(*) from public.venue_interactions e where e.venue_id=p_venue_id and e.event_type='directions' and e.occurred_at>=p.start_at and e.occurred_at<p.end_at),
      'going',(select count(*) from public.going_signals g join public.shifts s on s.id=g.shift_id where s.venue_id=p_venue_id and g.created_at>=p.start_at and g.created_at<p.end_at),
      'visitors',(select count(distinct session_id) from public.venue_page_events e where e.venue_id=p_venue_id and e.event_type='page_view' and e.occurred_at>=p.start_at and e.occurred_at<p.end_at),
      'followers',(select count(*) from public.venue_follows f where f.venue_id=p_venue_id and f.created_at>=p.start_at and f.created_at<p.end_at),
      'pickups',(select count(*) from public.pickup_requests r where r.venue_id=p_venue_id and r.requested_at>=p.start_at and r.requested_at<p.end_at),
      'passengers',(select coalesce(sum(party_size),0) from public.pickup_requests r where r.venue_id=p_venue_id and r.requested_at>=p.start_at and r.requested_at<p.end_at),
      'impressions',(select count(*) from public.venue_interactions e where e.venue_id=p_venue_id and e.event_type='card_impression' and e.occurred_at>=p.start_at and e.occurred_at<p.end_at)
    ) metrics from periods p
  ), interactions as (
    select event_type,source,count(*) total,count(distinct session_id) visitors
    from public.venue_interactions where venue_id=p_venue_id and occurred_at>=p_since and occurred_at<p_until
    group by event_type,source
  ), dancer_activity as (
    select dancer_id,event_type metric,count(*) total from public.venue_interactions
    where venue_id=p_venue_id and dancer_id is not null and occurred_at>=p_since and occurred_at<p_until
    group by dancer_id,event_type
    union all select s.dancer_id,'going',count(*) from public.going_signals g join public.shifts s on s.id=g.shift_id
    where s.venue_id=p_venue_id and g.created_at>=p_since and g.created_at<p_until group by s.dancer_id
    union all select dancer_id,'claims',count(*) from public.qr_redemptions
    where venue_id=p_venue_id and admission_pass_version=1 and dancer_id is not null and generated_at>=p_since and generated_at<p_until group by dancer_id
    union all select dancer_id,'admissions',count(*) from public.qr_redemptions
    where venue_id=p_venue_id and admission_pass_version=1 and dancer_id is not null and status='redeemed' and redeemed_at>=p_since and redeemed_at<p_until group by dancer_id
  ), dancer_totals as (
    select dancer_id,metric,sum(total) total from dancer_activity group by dancer_id,metric
  ), dancers as (
    select d.id,d.stage_name name,jsonb_object_agg(a.metric,a.total) metrics
    from dancer_totals a join public.dancer_profiles d on d.id=a.dancer_id group by d.id,d.stage_name
  ), video_activity as (
    select video_id,event_type from public.mydancr_tv_events where occurred_at>=p_since and occurred_at<p_until
    union all select video_id,event_type from public.venue_interactions where venue_id=p_venue_id and video_id is not null and occurred_at>=p_since and occurred_at<p_until and event_type in ('directions','free_entry','transport')
    union all select a.video_id,'claims' from public.venue_video_passes a join public.qr_redemptions r on r.id=a.pass_id where r.venue_id=p_venue_id and r.generated_at>=p_since and r.generated_at<p_until
    union all select a.video_id,'admissions' from public.venue_video_passes a join public.qr_redemptions r on r.id=a.pass_id where r.venue_id=p_venue_id and r.status='redeemed' and r.redeemed_at>=p_since and r.redeemed_at<p_until
  ), video_counts as (
    select v.id,v.caption,v.dancer_id,e.event_type,count(e.video_id) total
    from public.mydancr_tv_videos v left join video_activity e on e.video_id=v.id
    where v.venue_id=p_venue_id and v.venue_tag_status='confirmed' and v.published_at is not null
    group by v.id,v.caption,v.dancer_id,e.event_type
  ), videos as (
    select v.id,v.caption,d.stage_name dancer,
      coalesce(jsonb_object_agg(v.event_type,v.total) filter(where v.event_type is not null),'{}'::jsonb) metrics
    from video_counts v left join public.dancer_profiles d on d.id=v.dancer_id group by v.id,v.caption,d.stage_name
  )
  select jsonb_build_object(
    'trackingStartedAt',(select started_at from public.venue_analytics_tracking),
    'current',(select metrics from totals where label='current'),
    'previous',(select metrics from totals where label='previous'),
    'interactions',coalesce((select jsonb_agg(to_jsonb(i) order by i.total desc,i.event_type,i.source) from interactions i),'[]'::jsonb),
    'dancers',coalesce((select jsonb_agg(to_jsonb(d) order by d.name,d.id) from dancers d),'[]'::jsonb),
    'videos',coalesce((select jsonb_agg(to_jsonb(v) order by v.caption,v.id) from videos v),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.get_venue_subscription_analytics(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.get_venue_subscription_analytics(uuid,timestamptz,timestamptz) to service_role;
commit;
