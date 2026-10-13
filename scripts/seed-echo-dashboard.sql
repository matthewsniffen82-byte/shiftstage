-- Echo House only. Run prepare-echo-dashboard-guests.mjs first.
-- Fictional records in the normal operational tables: all real dashboard controls remain available.
-- IDs are deterministic, tokens random, and existing records/manager decisions are never overwritten.
-- Rehearse this transaction with ROLLBACK before committing. No notifications or billing RPCs are invoked.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtext('mydancr-echo-dashboard-v1'));

create temp table echo_context on commit drop as
select v.id venue_id, v.owner_user_id, c.id deal_id, now() stamp
from public.venues v join public.club_deals c on c.venue_id=v.id
where v.id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af' and v.name='Echo House' and v.is_active
  and c.is_active and c.removed_at is null and c.offer_type='admission'
order by c.created_at limit 1;

create temp table echo_guests on commit drop as
select u.id, u.email, 'Sample guest '||substring(u.email from 'guest-([0-9]+)') name,
  substring(u.email from 'guest-([0-9]+)')::integer n
from auth.users u join public.app_users a on a.id=u.id
where u.email ~ '^echo-experience-guest-(0[1-9]|1[0-2])@synthetic[.]mydancr[.]invalid$'
  and u.raw_user_meta_data->>'dataset_marker'='mydancr-echo-dashboard-v1'
  and u.banned_until>now() and a.role='customer' and a.account_state='active';

create temp table echo_dancers on commit drop as
select d.id, d.stage_name, s.id shift_id, row_number() over(order by d.slug,d.id)::integer n
from public.dancer_profiles d join auth.users u on u.id=d.user_id
join public.app_users a on a.id=u.id
join lateral (select s.id from public.shifts s join echo_context e on e.venue_id=s.venue_id
  where s.dancer_id=d.id and s.shift_source='demo_locked' and s.status='posted'
    and s.checked_in_at is not null and s.checked_out_at is null
    and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
  order by s.checked_in_at desc,s.id limit 1) s on true
where u.raw_user_meta_data->>'dataset_marker' in ('mydancr-echo-grid-v1','mydancr-layout-review-v1')
  and u.email ~ '^(echo-grid-[0-9]{3}|layout-review-[0-9]{2})@synthetic[.]mydancr[.]invalid$'
  and u.banned_until>now() and a.role='dancer' and a.account_state='active'
  and d.status='approved' and d.verification_status='approved' and d.disabled_at is null
  and exists(select 1 from public.venue_dancer_affiliations f join echo_context e on e.venue_id=f.venue_id
    where f.dancer_id=d.id and f.status='active' and f.revoked_at is null and not f.reentry_blocked);

do $$ begin
  if (select count(*) from echo_context)<>1 then raise exception 'Expected Echo House with active admission deal'; end if;
  if not exists(select 1 from public.app_users a join echo_context e on e.owner_user_id=a.id
    where a.role='venue' and a.account_state='active') then raise exception 'Expected active venue owner'; end if;
  if not exists(select 1 from public.dancer_age_verification_settings where singleton and enabled=false)
    then raise exception 'Fixture setup requires the existing demo age-policy setting'; end if;
  if (select count(*) from echo_guests)<>12 then raise exception 'Prepare the 12 login-disabled fixture guests first'; end if;
  if (select count(*) from echo_dancers) not between 3 and 100 then raise exception 'Unexpected Echo sample roster'; end if;
end $$;

-- Function lives only in this connection. The marker scopes every synthetic primary key.
create or replace function pg_temp.echo_id(key text) returns uuid language sql immutable as $$
  select md5('mydancr-echo-dashboard-v1:'||key)::uuid
$$;

insert into public.venue_vip_members(id,venue_id,user_id,display_name,nickname,created_at)
select pg_temp.echo_id('member:'||g.id),e.venue_id,g.id,g.name,'Sample regular '||g.n,e.stamp-interval '20 days'
from echo_guests g cross join echo_context e on conflict do nothing;
insert into public.venue_follows(customer_id,venue_id,notifications_enabled,created_at)
select g.id,e.venue_id,false,e.stamp-make_interval(days=>g.n) from echo_guests g cross join echo_context e on conflict do nothing;

insert into public.internal_roster_links(id,venue_id,kind,label)
select pg_temp.echo_id('table:'||n),e.venue_id,'table','Sample table '||n
from generate_series(1,6) n cross join echo_context e on conflict do nothing;

-- Four completed sample shifts plus one recent session per dancer. Never modify live shifts or NFC verification.
insert into public.venue_dancer_work_sessions(id,shift_id,venue_id,dancer_id,started_at,expires_at,closed_at,
  dancer_check_in_at,check_in_day,dancer_check_out_at,closure_reason,both_roster_periods)
select pg_temp.echo_id('session:'||d.id||':'||day),d.shift_id,e.venue_id,d.id,start_at,finish_at,finish_at,
  start_at,(start_at at time zone 'America/Los_Angeles')::date,
  case when (d.n+day)%(3+d.n%4)<>0 then finish_at end,case when (d.n+day)%(3+d.n%4)<>0 then 'dancer' else 'expired' end,
  tstzmultirange(tstzrange(start_at,start_at+(finish_at-start_at)*(0.4+0.1*(d.n%7)),'[)'))
from echo_dancers d cross join echo_context e cross join generate_series(0,4) day
cross join lateral (select e.stamp-make_interval(days=>day*5)-interval '1 minute' finish_at) f
cross join lateral (select finish_at-make_interval(hours=>4+d.n%5) start_at) b
on conflict do nothing;

insert into public.venue_dancer_attendance_events(id,shift_id,venue_id,dancer_id,kind,occurred_at)
select pg_temp.echo_id('attendance:'||w.id||':'||kind),w.shift_id,w.venue_id,w.dancer_id,kind,
  case when kind='check_in' then w.dancer_check_in_at else w.dancer_check_out_at end
from echo_dancers d cross join generate_series(0,4) day
join public.venue_dancer_work_sessions w on w.id=pg_temp.echo_id('session:'||d.id||':'||day)
cross join (values ('check_in'),('check_out')) kinds(kind)
where kind='check_in' or w.dancer_check_out_at is not null on conflict do nothing;

-- Histories use recent request times because status timestamps are captured by the normal database triggers.
-- Suppress only push deliveries created by this insertion, inside the same transaction before they are visible.
create temp table echo_new_table_requests(id uuid primary key) on commit drop;
with inserted as (
  insert into public.internal_roster_requests(id,venue_id,link_id,dancer_id,request_key,status,created_at,updated_at,attendance,attendance_recorded_at)
  select pg_temp.echo_id('table-request:'||d.id||':'||r),e.venue_id,pg_temp.echo_id('table:'||(1+(r%6))),d.id,
    pg_temp.echo_id('table-request:'||d.id||':'||r),
    case when r=0 and d.n<=8 then 'pending' when r=1 and d.n<=4 then 'acknowledged'
      when r%9=0 then 'cancelled' else 'completed' end,
    e.stamp-make_interval(mins=>2+r),e.stamp,
    case when r>1 then case when r%9=0 then 'no_show' else 'arrived' end end,
    case when r>1 then e.stamp end
  from echo_dancers d cross join echo_context e cross join lateral generate_series(0,20+d.n%12) r
  on conflict do nothing returning id
) insert into echo_new_table_requests select id from inserted;
delete from public.internal_request_push_deliveries where request_id in(select id from echo_new_table_requests);

insert into public.venue_vip_requests(id,venue_id,user_id,guest_name,starts_at,timezone,dancers,notes,status,created_at,updated_at)
select pg_temp.echo_id('vip:'||d.id||':'||r),e.venue_id,g.id,g.name,
  e.stamp+make_interval(mins=>30+r*10),'America/Los_Angeles',
  jsonb_build_array(jsonb_build_object('id',d.id,'stageName',d.stage_name)),
  'Fictional sample visit · party of '||(2+r%5),
  case when r=0 and d.n<=5 then 'pending' when r%11=0 then 'declined' else 'confirmed' end,
  e.stamp-make_interval(mins=>2+r),e.stamp
from echo_dancers d cross join echo_context e cross join lateral generate_series(0,20+d.n%9) r
join echo_guests g on g.n=1+((r+d.n)%12) on conflict do nothing;

-- Standalone admissions have no financial ledger side effect. Tokens are unguessable and kept private.
insert into public.qr_redemptions(id,redemption_token,venue_id,club_deal_id,source_type,dancer_id,shift_id,customer_id,
  session_id,generated_at,created_at,expires_at,status,redeemed_at,admission_pass_version,arrival_method,audit)
select pg_temp.echo_id('pass:'||d.id||':'||r),gen_random_uuid()::text||gen_random_uuid()::text,e.venue_id,e.deal_id,
  'dancer_profile',d.id,d.shift_id,g.id,'echo-experience-'||d.id||'-'||r,
  e.stamp-make_interval(hours=>case when r=0 then 1 else r*12 end),
  e.stamp-make_interval(hours=>case when r=0 then 1 else r*12 end),
  case when r=0 then e.stamp+interval '23 hours' else e.stamp-make_interval(hours=>r*12)+interval '24 hours' end,
  case when r>0 and r%10<3+d.n%7 then 'redeemed' when r<=1 then 'generated' else 'expired' end,
  case when r>0 and r%10<3+d.n%7 then e.stamp-make_interval(hours=>r*12)+interval '30 minutes' end,
  1,'guest_list',jsonb_build_object('dataset_marker','mydancr-echo-dashboard-v1','fictional',true,
    'admission_policy','staff-verified-v1','deal_snapshot',jsonb_build_object('dealTitle','Free admission','offerType','admission'))
from echo_dancers d cross join echo_context e cross join lateral generate_series(0,20+d.n%8) r
join echo_guests g on g.n=1+((r+d.n)%12) on conflict do nothing;
insert into public.venue_guest_list_entries(pass_id,venue_id,guest_name,phone,email,consented_at,created_at)
select q.id,q.venue_id,g.name,'+170255501'||lpad(g.n::text,2,'0'),g.email,q.generated_at,q.generated_at
from public.qr_redemptions q join echo_context e on e.venue_id=q.venue_id join echo_guests g on g.id=q.customer_id
where q.audit->>'dataset_marker'='mydancr-echo-dashboard-v1' on conflict do nothing;

insert into public.venue_interactions(id,venue_id,dancer_id,event_type,source,session_id,occurred_at)
select pg_temp.echo_id('action:'||d.id||':'||r),e.venue_id,d.id,
  (array['dancer_profile','club_page','directions','free_entry','transport','share_completed','card_impression'])[1+r%7],
  'dancer_profile','echo-experience-'||d.id||'-'||r,e.stamp-make_interval(mins=>2+r*29)
from echo_dancers d cross join echo_context e cross join lateral generate_series(1,70+d.n%60) r on conflict do nothing;
insert into public.venue_page_events(id,venue_id,dancer_id,viewer_id,event_type,source,session_id,occurred_on,occurred_at)
select pg_temp.echo_id('page:'||d.id||':'||r),e.venue_id,d.id,g.id,'page_view','dancer_profile',
  'echo-experience-'||d.id||'-'||r,(e.stamp-make_interval(hours=>r))::date,e.stamp-make_interval(hours=>r)
from echo_dancers d cross join echo_context e cross join generate_series(1,12) r
join echo_guests g on g.n=r on conflict do nothing;

-- Receipt payloads populate the ride cards; handed_off_at prevents the handoff worker from sending alerts.
insert into public.club_shuttle_requests(id,venue_id,deal_id,details_hash,notification_rows,created_at,handed_off_at,staff_status)
select pg_temp.echo_id('ride:'||g.n),e.venue_id,e.deal_id,md5('echo-ride-'||g.n)||md5('echo-ride-'||g.n),
  jsonb_build_array(jsonb_build_object('id',pg_temp.echo_id('ride-notice:'||g.n),'recipient_id',g.id,
    'notification_type','support_message','channel','in_app','title','Sample shuttle request','body','Fictional sample ride',
    'payload',jsonb_build_object('kind','club_shuttle_request','requestId',pg_temp.echo_id('ride:'||g.n),'venueId',e.venue_id,
      'name',g.name,'email',g.email,'phone','+170255501'||lpad(g.n::text,2,'0'),'location','Sample hotel lobby '||g.n,
      'partySize',2+g.n%5,'dataset_marker','mydancr-echo-dashboard-v1'))),
  e.stamp-make_interval(mins=>g.n*4),e.stamp,
  (array['received','contacted','arranged','completed','cancelled'])[1+(g.n-1)%5]
from echo_guests g cross join echo_context e where g.n<=6 on conflict do nothing;

set constraints all immediate;
select jsonb_build_object('venue','Echo House','fixtureDancers',(select count(*) from echo_dancers),
  'fixtureGuests',(select count(*) from echo_guests),'newTableRequests',(select count(*) from echo_new_table_requests),
  'operations',public.get_venue_operations((select venue_id from echo_context),now()-interval '24 hours',now()+interval '24 hours')) receipt;
commit;
