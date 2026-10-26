begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.venue_update_campaigns (
 id uuid primary key, venue_id uuid not null references public.venues(id) on delete cascade,
 created_by uuid not null references public.app_users(id),
 channel text not null default 'in_app' check(channel='in_app'),
 subject text not null check(char_length(btrim(subject)) between 1 and 120 and subject !~ '[[:cntrl:]]'),
 body text not null check(char_length(btrim(body)) between 1 and 5000),
 sender_name text not null, sender_address text not null,
 status text not null default 'draft' check(status in ('draft','published','cancelled')),
 created_at timestamptz not null default now(), queued_at timestamptz
);
create index venue_update_campaigns_history on public.venue_update_campaigns(venue_id,created_at desc);
create index venue_update_campaigns_actor on public.venue_update_campaigns(created_by);

create table public.club_offer_digests (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.app_users(id) on delete cascade,
 digest_day date not null, due_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','sending','accepted','skipped','failed')),
 content jsonb, destination text, manage_token text, send_day date, attempts integer not null default 0, first_attempt_at timestamptz,
 next_attempt_at timestamptz not null default now(), lease_id uuid, lease_until timestamptz,
 provider_id text, outcome text, unique(recipient_id,digest_day)
);
create index club_offer_digests_pending on public.club_offer_digests(due_at,next_attempt_at) where status in ('pending','sending');
create unique index club_offer_digests_daily_send on public.club_offer_digests(recipient_id,send_day) where send_day is not null;
create table public.venue_update_campaign_deliveries (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.venue_update_campaigns(id) on delete cascade,
 recipient_id uuid not null references public.app_users(id) on delete cascade,
 notification_id uuid not null default gen_random_uuid(), published_at timestamptz,
 digest_id uuid references public.club_offer_digests(id) on delete set null,
 push_status text not null default 'pending' check(push_status in ('pending','sending','accepted','skipped','failed')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz, outcome text, unique(campaign_id,recipient_id)
);
create index venue_update_campaign_deliveries_recipient on public.venue_update_campaign_deliveries(recipient_id);
create index venue_update_campaign_deliveries_digest on public.venue_update_campaign_deliveries(digest_id);
create index venue_update_campaign_deliveries_pending on public.venue_update_campaign_deliveries(next_attempt_at) where push_status in ('pending','sending');
create index app_users_customer_email_idx on public.app_users(lower(btrim(email))) where role='customer';
alter table public.venue_update_campaigns enable row level security;
alter table public.venue_update_campaign_deliveries enable row level security;
alter table public.club_offer_digests enable row level security;
revoke all on public.venue_update_campaigns,public.venue_update_campaign_deliveries,public.club_offer_digests from public,anon,authenticated;
grant select,insert,update,delete on public.venue_update_campaigns,public.venue_update_campaign_deliveries,public.club_offer_digests to service_role;

-- Auth is outside the application Data API. Keep this narrow verification in
-- the unexposed schema instead of granting the worker access to auth.users.
create schema if not exists private;
grant usage on schema private to service_role;
create function private.club_offer_verified_email(p_user uuid,p_email text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null
  and lower(btrim(u.email))=lower(btrim(p_email)));
$$;
revoke all on function private.club_offer_verified_email(uuid,text) from public,anon,authenticated;
grant execute on function private.club_offer_verified_email(uuid,text) to service_role;

create function public.venue_campaign_authorized(p_venue uuid,p_actor uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.venues v
 join public.app_users owner on owner.id=v.owner_user_id and owner.account_state='active'
 join public.app_users actor on actor.id=p_actor and actor.role='venue' and actor.account_state='active'
 where v.id=p_venue and v.is_active and (v.owner_user_id=p_actor or exists(
 select 1 from public.venue_team_members m where m.venue_id=v.id and m.user_id=p_actor and m.status='active' and m.role='manager')));
$$;

-- Membership and optional alert choices are read from current server records.
-- An unverified guest email or phone is never sufficient to identify an account.
create function public.venue_offer_recipient_allowed(p_venue uuid,p_user uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.app_users a join public.customer_profiles cp on cp.user_id=a.id
 where a.id=p_user and a.role='customer' and a.account_state='active'
 and private.club_offer_verified_email(a.id,a.email)
 and coalesce(cp.notification_settings->'followAlertsEnabled','true'::jsonb)='true'::jsonb
 and coalesce(cp.notification_settings->'clubDeals','true'::jsonb)='true'::jsonb
 and not exists(select 1 from public.venue_follows f where f.venue_id=p_venue and f.customer_id=a.id and not f.notifications_enabled)
 and (exists(select 1 from public.venue_follows f where f.venue_id=p_venue and f.customer_id=a.id and f.notifications_enabled)
 or exists(select 1 from public.venue_update_subscriptions s where s.venue_id=p_venue and s.channel='email'
 and s.destination=lower(btrim(a.email)) and s.withdrawn_at is null)));
$$;
create function public.venue_offer_audience(p_venue uuid)
returns table(recipient_id uuid) language sql stable security invoker set search_path='' as $$
 with candidates as (
 select f.customer_id as id from public.venue_follows f where f.venue_id=p_venue and f.notifications_enabled
 union
 select a.id from public.venue_update_subscriptions s join public.app_users a on lower(btrim(a.email))=s.destination
 where s.venue_id=p_venue and s.channel='email' and s.withdrawn_at is null and a.role='customer'
 ) select id from candidates where public.venue_offer_recipient_allowed(p_venue,id);
$$;
create function public.venue_offer_email_allowed(p_venue uuid,p_user uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select public.venue_offer_recipient_allowed(p_venue,p_user)
 and public.customer_email_channel_delivery_target(p_user,'marketing') is not null
 and not exists(select 1 from public.venue_update_subscriptions s join public.app_users a on a.id=p_user
 where s.venue_id=p_venue and s.channel='email' and s.destination=lower(btrim(a.email)) and s.withdrawn_at is not null);
$$;

create function public.prepare_venue_update_campaign(p_id uuid,p_venue uuid,p_actor uuid,p_channel text,p_subject text,p_body text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare existing public.venue_update_campaigns; club public.venues; total integer;
begin
 if not public.venue_campaign_authorized(p_venue,p_actor) then raise exception 'Campaign access denied' using errcode='42501'; end if;
 if p_id is null or p_channel is distinct from 'in_app' or p_subject is null or p_body is null
 or char_length(btrim(p_body)) not between 1 and 5000 or p_subject ~ '[[:cntrl:]]' or char_length(p_subject)>120
 or char_length(btrim(p_subject))=0 then raise exception 'Invalid campaign' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into existing from public.venue_update_campaigns where id=p_id;
 if found then
  if existing.venue_id<>p_venue or existing.created_by<>p_actor or existing.channel<>p_channel or existing.subject<>p_subject or existing.body<>p_body
  then raise exception 'Campaign changed; preview again' using errcode='22023'; end if;
  return existing.id;
 end if;
 if (select count(*) from public.venue_update_campaigns where venue_id=p_venue and created_at>now()-interval '1 hour')>=30
 then raise exception 'Too many previews' using errcode='22023'; end if;
 select * into club from public.venues where id=p_venue;
 if nullif(btrim(club.address),'') is null then raise exception 'Club address required' using errcode='22023'; end if;
 insert into public.venue_update_campaigns(id,venue_id,created_by,channel,subject,body,sender_name,sender_address)
 values(p_id,p_venue,p_actor,p_channel,p_subject,p_body,club.name,concat_ws(', ',nullif(club.address,''),nullif(club.city,''),nullif(club.state,'')));
 insert into public.venue_update_campaign_deliveries(campaign_id,recipient_id) select p_id,recipient_id from public.venue_offer_audience(p_venue);
 get diagnostics total=row_count;
 if total=0 then raise exception 'No subscribers for this channel' using errcode='22023'; end if;
 return p_id;
end $$;

create function public.set_venue_update_campaign_state(p_id uuid,p_venue uuid,p_actor uuid,p_action text)
returns text language plpgsql security invoker set search_path='' as $$
declare campaign public.venue_update_campaigns; day date := (now() at time zone 'UTC')::date;
begin
 if not public.venue_campaign_authorized(p_venue,p_actor) then raise exception 'Campaign access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('club-offers:'||p_venue::text,0));
 select * into campaign from public.venue_update_campaigns where id=p_id and venue_id=p_venue for update;
 if not found then raise exception 'Campaign not found' using errcode='22023'; end if;
 if p_action='send' then
  if campaign.status<>'draft' then return campaign.status; end if;
  if campaign.created_at<now()-interval '24 hours' then raise exception 'Preview expired' using errcode='22023'; end if;
  if (select count(*) from public.venue_update_campaigns where venue_id=p_venue and queued_at>=(day::timestamp at time zone 'UTC'))>=3
  then raise exception 'Daily offer limit reached' using errcode='22023'; end if;
  update public.venue_update_campaigns set status='published',queued_at=now() where id=p_id;
  -- Publish the full offer inside Alerts atomically, independent of email/push.
  insert into public.notifications(id,recipient_id,notification_type,channel,title,body,payload)
  select d.notification_id,d.recipient_id,'engagement','in_app',campaign.sender_name||': '||campaign.subject,campaign.body,
   jsonb_build_object('kind','club_offer','campaignId',p_id,'venueId',p_venue,'venueName',campaign.sender_name)
  from public.venue_update_campaign_deliveries d where d.campaign_id=p_id and public.venue_offer_recipient_allowed(p_venue,d.recipient_id);
  update public.venue_update_campaign_deliveries d set published_at=now()
  where d.campaign_id=p_id and exists(select 1 from public.notifications n where n.id=d.notification_id);
  update public.venue_update_campaign_deliveries set push_status='skipped',outcome='preferences_changed'
  where campaign_id=p_id and published_at is null;
  -- All clubs share a single digest per customer and UTC day. No email on publish.
  insert into public.club_offer_digests(recipient_id,digest_day,due_at)
  select d.recipient_id,day,((day+1)::timestamp at time zone 'UTC')
  from public.venue_update_campaign_deliveries d where d.campaign_id=p_id and d.published_at is not null
   and public.venue_offer_email_allowed(p_venue,d.recipient_id)
  on conflict(recipient_id,digest_day) do nothing;
  update public.venue_update_campaign_deliveries d set digest_id=g.id from public.club_offer_digests g
  where d.campaign_id=p_id and d.published_at is not null and d.recipient_id=g.recipient_id and g.digest_day=day and g.status='pending'
   and public.venue_offer_email_allowed(p_venue,d.recipient_id);
  return 'published';
 elsif p_action='cancel' then
  update public.venue_update_campaigns set status='cancelled' where id=p_id;
  delete from public.notifications n using public.venue_update_campaign_deliveries d where d.campaign_id=p_id and n.id=d.notification_id;
  update public.venue_update_campaign_deliveries set push_status='skipped',outcome='withdrawn' where campaign_id=p_id and push_status='pending';
  return 'cancelled';
 end if;
 raise exception 'Invalid campaign action' using errcode='22023';
end $$;

create function public.claim_venue_offer_push(p_limit integer default 10)
returns setof public.venue_update_campaign_deliveries language plpgsql security invoker set search_path='' as $$
begin
 update public.venue_update_campaign_deliveries set push_status='failed',outcome='retry_expired',lease_id=null,lease_until=null
 where published_at is not null and push_status in ('pending','sending') and (lease_until is null or lease_until<now())
 and (attempts>=3 or published_at<now()-interval '24 hours');
 return query with candidates as (
 select d.id from public.venue_update_campaign_deliveries d join public.venue_update_campaigns c on c.id=d.campaign_id
 where c.status='published' and d.published_at is not null and d.push_status in ('pending','sending')
 and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now())
 order by d.next_attempt_at,d.id limit least(greatest(p_limit,1),20) for update of d skip locked
 ) update public.venue_update_campaign_deliveries d set push_status='sending',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 from candidates where d.id=candidates.id returning d.*;
end $$;
create function public.venue_offer_push_target(p_id uuid,p_lease uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('userId',d.recipient_id,'notificationId',d.notification_id,'venueName',c.sender_name)
 from public.venue_update_campaign_deliveries d join public.venue_update_campaigns c on c.id=d.campaign_id
 join public.customer_profiles cp on cp.user_id=d.recipient_id
 where d.id=p_id and d.lease_id=p_lease and d.lease_until>now() and d.push_status='sending' and c.status='published'
 and public.venue_campaign_authorized(c.venue_id,c.created_by) and public.venue_offer_recipient_allowed(c.venue_id,d.recipient_id)
 and coalesce(cp.notification_settings->'pushEnabled','true'::jsonb)='true'::jsonb
 and exists(select 1 from public.notifications n where n.id=d.notification_id)
 and exists(select 1 from public.web_push_subscriptions s where s.user_id=d.recipient_id);
$$;
create function public.finish_venue_offer_push(p_id uuid,p_lease uuid,p_status text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('accepted','skipped','retry') or p_status is null then raise exception 'Invalid result'; end if;
 update public.venue_update_campaign_deliveries set push_status=case when p_status='retry' then 'pending' else p_status end,
 next_attempt_at=now()+interval '2 minutes',lease_id=null,lease_until=null
 where id=p_id and lease_id=p_lease and push_status='sending';
 return found;
end $$;

create function public.claim_club_offer_digests(p_limit integer default 2)
returns setof public.club_offer_digests language plpgsql security invoker set search_path='' as $$
declare job public.club_offer_digests; snapshot jsonb; target jsonb; today date := (now() at time zone 'UTC')::date;
begin
 update public.club_offer_digests set status='failed',outcome='retry_expired',lease_id=null,lease_until=null
 where status in ('pending','sending') and (lease_until is null or lease_until<now())
 and (attempts>=5 or first_attempt_at<now()-interval '20 hours' or due_at<now()-interval '24 hours'
  or send_day<today);
 for job in select * from public.club_offer_digests
 where status in ('pending','sending') and due_at<=now() and next_attempt_at<=now() and (lease_until is null or lease_until<now())
 order by due_at,id limit least(greatest(p_limit,1),10) for update skip locked loop
  if not pg_try_advisory_xact_lock(hashtextextended('offer-digest:'||job.recipient_id::text,0)) then continue; end if;
  if exists(select 1 from public.club_offer_digests g where g.recipient_id=job.recipient_id and g.send_day=today and g.id<>job.id) then continue; end if;
  target := public.customer_email_channel_delivery_target(job.recipient_id,'marketing');
  if job.content is null then
   select jsonb_agg(jsonb_build_object('campaignId',c.id,'venueId',c.venue_id,'venueName',c.sender_name,'subject',c.subject,'address',c.sender_address) order by c.queued_at,c.id)
   into snapshot from public.venue_update_campaign_deliveries d join public.venue_update_campaigns c on c.id=d.campaign_id
   where d.digest_id=job.id and c.status='published' and public.venue_campaign_authorized(c.venue_id,c.created_by)
   and public.venue_offer_email_allowed(c.venue_id,job.recipient_id)
   and exists(select 1 from public.notifications n where n.id=d.notification_id);
  else snapshot:=job.content; end if;
  if target is null or snapshot is null then
   update public.club_offer_digests set status='skipped',outcome='no_eligible_offers',lease_id=null,lease_until=null where id=job.id;
  else
   update public.club_offer_digests set status='sending',content=snapshot,destination=coalesce(destination,target->>'email'),manage_token=coalesce(manage_token,target->>'token'),send_day=today,
    attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes'
   where id=job.id returning * into job;
   return next job;
  end if;
 end loop;
end $$;

-- Recheck permission immediately before contacting the provider. Freeze content
-- across retries so a provider's idempotency key never represents another email.
create function public.club_offer_digest_target(p_id uuid,p_lease uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('email',g.destination,'token',g.manage_token,'items',g.content)
 from public.club_offer_digests g
 cross join lateral (select public.customer_email_channel_delivery_target(g.recipient_id,'marketing') as value) t
 where g.id=p_id and g.lease_id=p_lease and g.lease_until>now() and g.status='sending' and t.value->>'email'=g.destination and t.value->>'token'=g.manage_token
 and not exists(select 1 from jsonb_array_elements(g.content) item
  left join public.venue_update_campaigns c on c.id=(item->>'campaignId')::uuid
  where c.id is null or c.status<>'published' or not public.venue_campaign_authorized(c.venue_id,c.created_by)
   or not public.venue_offer_email_allowed(c.venue_id,g.recipient_id)
   or not exists(select 1 from public.venue_update_campaign_deliveries d join public.notifications n on n.id=d.notification_id
    where d.digest_id=g.id and d.campaign_id=c.id));
$$;
create function public.finish_club_offer_digest(p_id uuid,p_lease uuid,p_status text,p_outcome text,p_provider_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('accepted','skipped','failed','retry') or p_status is null then raise exception 'Invalid result'; end if;
 update public.club_offer_digests set status=case when p_status='retry' then 'pending' else p_status end,
 next_attempt_at=now()+interval '2 minutes',lease_id=null,lease_until=null,outcome=left(p_outcome,80),provider_id=left(p_provider_id,200)
 where id=p_id and lease_id=p_lease and status='sending';
 return found;
end $$;

create view public.venue_update_campaign_summary with(security_invoker=true) as
 select c.*,count(d.id)::integer recipient_count,
 count(d.id) filter(where d.published_at is not null)::integer published_count,
 count(d.id) filter(where d.published_at is null and c.status<>'draft')::integer skipped_count
 from public.venue_update_campaigns c left join public.venue_update_campaign_deliveries d on d.campaign_id=c.id group by c.id;
revoke all on public.venue_update_campaign_summary from public,anon,authenticated;
grant select on public.venue_update_campaign_summary to service_role;
do $$
declare fn regprocedure;
begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('venue_campaign_authorized','venue_offer_recipient_allowed','venue_offer_audience','venue_offer_email_allowed',
 'prepare_venue_update_campaign','set_venue_update_campaign_state','claim_venue_offer_push','venue_offer_push_target','finish_venue_offer_push',
 'claim_club_offer_digests','club_offer_digest_target','finish_club_offer_digest')
 loop execute format('revoke all on function %s from public,anon,authenticated',fn);
 execute format('grant execute on function %s to service_role',fn); end loop;
end $$;
commit;
