begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- emailEnabled remains the offers/newsletters preference; follow emails have their own receipt.
alter table public.customer_email_preferences
 add column follow_enabled boolean not null default false,
 add column follow_consent_version text,
 add column follow_consented_at timestamptz,
 add column follow_withdrawn_at timestamptz;
alter table public.customer_email_preferences drop constraint customer_email_preferences_check;
alter table public.customer_email_preferences add constraint customer_email_marketing_consent
 check (not enabled or (consent_version in ('customer-email-v1','customer-email-v2') and consented_at is not null));
alter table public.customer_email_preferences add constraint customer_email_follow_consent
 check (not follow_enabled or (follow_consent_version in ('customer-email-v1','customer-email-v2') and follow_consented_at is not null));
alter table public.customer_email_consent_events add column channel text not null default 'all'
 check(channel in ('all','follow','marketing'));
-- v1 explicitly included both categories. Preserve real receipts and every withdrawal.
update public.customer_email_preferences set follow_enabled=enabled,
 follow_consent_version=consent_version,follow_consented_at=consented_at,follow_withdrawn_at=withdrawn_at;
update public.customer_profiles c set notification_settings=c.notification_settings || jsonb_build_object('followEmailEnabled',coalesce((
 select p.follow_enabled from public.customer_email_preferences p where p.user_id=c.user_id),false));

alter table public.customer_email_signup_intents
 add column consent_version text not null default 'customer-email-v1',
 add column follow_enabled boolean not null default true,
 add column marketing_enabled boolean not null default true,
 add column venue_id uuid references public.venues(id) on delete cascade,
 add column venue_name text,
 add column share_name text,
 add column share_city text not null default '';
create table public.customer_signup_venue_shares (
 user_id uuid primary key references auth.users(id) on delete cascade,
 venue_id uuid not null references public.venues(id) on delete cascade,
 email text not null,name text not null,city text not null,consented_at timestamptz not null,
 expires_at timestamptz not null default now()+interval '30 days'
);
alter table public.customer_signup_venue_shares enable row level security;
revoke all on public.customer_signup_venue_shares from public,anon,authenticated,service_role;

create function public.prepare_customer_signup_choices(p_email text,p_version text,p_follow boolean,p_marketing boolean,
 p_venue_id uuid,p_venue_name text,p_name text,p_city text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_token uuid;
begin
 if p_version is distinct from 'customer-email-v2' or p_follow is null or p_marketing is null
  or p_email is null or length(p_email)>254 or p_email not like '%@%' then
  raise exception 'SIGNUP_CONSENT_REQUIRED' using errcode='22023';
 end if;
 if p_venue_id is not null and (p_name is null or char_length(btrim(p_name)) not between 2 and 100
  or p_city is null or char_length(p_city)>100 or (p_name||p_city) ~ '[[:cntrl:]]'
  or not exists(select 1 from public.venues v where v.id=p_venue_id and v.is_active and v.name=p_venue_name)) then
  raise exception 'Review the named club and sharing details' using errcode='22023';
 end if;
 delete from public.customer_email_signup_intents where expires_at<clock_timestamp();
 delete from public.customer_signup_venue_shares where expires_at<clock_timestamp();
 insert into public.customer_email_signup_intents(email,consent_version,follow_enabled,marketing_enabled,venue_id,venue_name,share_name,share_city)
 values(lower(btrim(p_email)),p_version,p_follow,p_marketing,p_venue_id,p_venue_name,btrim(p_name),coalesce(btrim(p_city),'')) returning token into v_token;
 return v_token;
end $$;

-- Sharing is applied once, only after the new account's email is verified. No marketing permission is created.
create function public.complete_customer_signup_share(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.customer_signup_venue_shares%rowtype;
begin
 select pending.* into s from public.customer_signup_venue_shares pending
 join auth.users u on u.id=pending.user_id join public.app_users a on a.id=u.id
 join public.venues v on v.id=pending.venue_id
 where pending.user_id=p_user_id and pending.expires_at>clock_timestamp() and v.is_active
 and a.role='customer' and a.account_state='active' and u.email_confirmed_at is not null
 and lower(btrim(u.email))=pending.email and lower(btrim(a.email))=pending.email
 for update of pending;
 if not found then return; end if;
 insert into public.venue_follows(customer_id,venue_id) values(s.user_id,s.venue_id) on conflict do nothing;
 insert into public.venue_customer_shares(customer_id,venue_id,name,email,city,consent_version,consented_at)
 values(s.user_id,s.venue_id,s.name,s.email,s.city,'venue-customer-sharing-v1',s.consented_at) on conflict do nothing;
 delete from public.customer_signup_venue_shares where user_id=s.user_id;
end $$;
create function public.complete_customer_signup_share_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform public.complete_customer_signup_share(new.id); return new; end $$;
create trigger complete_customer_signup_share_verified after update of email_confirmed_at on auth.users
 for each row when (new.email_confirmed_at is not null) execute function public.complete_customer_signup_share_trigger();
create trigger complete_customer_signup_share_account after insert or update of account_state,email on public.app_users
 for each row execute function public.complete_customer_signup_share_trigger();

create or replace function public.attach_customer_email_signup() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.customer_email_signup_intents%rowtype;
begin
 if new.raw_user_meta_data->>'role'='customer' then
  delete from public.customer_email_signup_intents pending
  where pending.token::text=new.raw_user_meta_data->>'customer_email_intent'
   and pending.email=lower(btrim(new.email)) and pending.expires_at>clock_timestamp() returning pending.* into i;
  if found then
   insert into public.customer_email_preferences(user_id,email,enabled,consent_version,consented_at,source,follow_enabled,follow_consent_version,follow_consented_at)
   values(new.id,i.email,i.marketing_enabled,case when i.marketing_enabled then i.consent_version end,case when i.marketing_enabled then i.accepted_at end,'signup',
    i.follow_enabled,case when i.follow_enabled then i.consent_version end,case when i.follow_enabled then i.accepted_at end);
   if i.consent_version='customer-email-v1' then
    insert into public.customer_email_consent_events(user_id,email,enabled,source,consent_version,consent_text,recorded_at)
    values(new.id,i.email,true,'signup',i.consent_version,'Email me MyDancr promotions, newsletters, dancer and club alerts, and offers. Optional; unsubscribe at any time.',i.accepted_at);
   else
    insert into public.customer_email_consent_events(user_id,email,enabled,source,consent_version,consent_text,recorded_at,channel)
    values(new.id,i.email,i.follow_enabled,'signup',i.consent_version,'Email me updates from dancers and clubs I follow.',i.accepted_at,'follow'),
     (new.id,i.email,i.marketing_enabled,'signup',i.consent_version,'Email me MyDancr offers and newsletters.',i.accepted_at,'marketing');
   end if;
   update public.customer_profiles set notification_settings=notification_settings||jsonb_build_object('emailEnabled',i.marketing_enabled,'followEmailEnabled',i.follow_enabled) where user_id=new.id;
   if i.venue_id is not null then
    insert into public.customer_signup_venue_shares(user_id,venue_id,email,name,city,consented_at)
    values(new.id,i.venue_id,i.email,i.share_name,i.share_city,i.accepted_at);
    perform public.complete_customer_signup_share(new.id);
   end if;
  end if;
 end if;
 return new;
end $$;

create or replace function public.guard_customer_email_preference() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.notification_settings:=coalesce(new.notification_settings,'{}'::jsonb)||jsonb_build_object(
   'emailEnabled',exists(select 1 from public.customer_email_preferences p where p.user_id=new.user_id and p.enabled),
   'followEmailEnabled',exists(select 1 from public.customer_email_preferences p where p.user_id=new.user_id and p.follow_enabled));
 elsif current_setting('role',true) in ('anon','authenticated') and (
  new.notification_settings->'emailEnabled' is distinct from old.notification_settings->'emailEnabled' or
  new.notification_settings->'followEmailEnabled' is distinct from old.notification_settings->'followEmailEnabled') then
  raise exception 'Use the email consent endpoint' using errcode='42501';
 end if;
 return new;
end $$;

create function public.set_customer_email_channel_preference(p_user_id uuid,p_channel text,p_enabled boolean,p_source text,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_email text;p public.customer_email_preferences%rowtype;v_profile public.customer_profiles%rowtype;v_now timestamptz:=clock_timestamp();v_changed boolean;
begin
 if p_enabled is null or p_channel is null or p_channel not in ('follow','marketing')
 or p_source is null or p_source not in ('account_preferences','notification_preferences','legacy_preferences')
 or (p_enabled and (p_source='legacy_preferences' or p_version is null or p_version not in ('customer-email-v1','customer-email-v2'))) then
  raise exception 'EMAIL_CONSENT_REQUIRED' using errcode='22023';
 end if;
 select lower(btrim(u.email)) into v_email from auth.users u join public.app_users a on a.id=u.id
 where u.id=p_user_id and a.role='customer' and a.account_state='active'
 and (not p_enabled or (u.email_confirmed_at is not null and u.email is not null));
 if not found then raise exception 'Active verified customer required' using errcode='42501';end if;
 select * into strict v_profile from public.customer_profiles where user_id=p_user_id for update;
 insert into public.customer_email_preferences(user_id,email,source) values(p_user_id,coalesce(v_email,''),p_source) on conflict do nothing;
 select * into p from public.customer_email_preferences where user_id=p_user_id for update;
 v_changed:=(case when p_channel='follow' then p.follow_enabled else p.enabled end) is distinct from p_enabled or p.email is distinct from v_email;
 -- Changing address never transfers the other channel's consent to the new address.
 if p.email is distinct from v_email then
  update public.customer_email_preferences set enabled=false,follow_enabled=false,withdrawn_at=v_now,follow_withdrawn_at=v_now where user_id=p_user_id;
 end if;
 if v_changed then
  update public.customer_email_preferences set email=coalesce(v_email,''),source=p_source,
   enabled=case when p_channel='marketing' then p_enabled else enabled end,
   consent_version=case when p_channel='marketing' and p_enabled then p_version else consent_version end,
   consented_at=case when p_channel='marketing' and p_enabled then v_now else consented_at end,
   withdrawn_at=case when p_channel='marketing' then case when not p_enabled then v_now end else withdrawn_at end,
   follow_enabled=case when p_channel='follow' then p_enabled else follow_enabled end,
   follow_consent_version=case when p_channel='follow' and p_enabled then p_version else follow_consent_version end,
   follow_consented_at=case when p_channel='follow' and p_enabled then v_now else follow_consented_at end,
   follow_withdrawn_at=case when p_channel='follow' then case when not p_enabled then v_now end else follow_withdrawn_at end,
   manage_token=case when p_enabled then replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') else manage_token end
  where user_id=p_user_id;
  insert into public.customer_email_consent_events(user_id,email,enabled,source,consent_version,consent_text,channel)
  values(p_user_id,coalesce(v_email,''),p_enabled,p_source,case when p_enabled then p_version end,
   case when not p_enabled then 'Stop '||p_channel||' emails.'
   when p_version='customer-email-v1' then 'Email me MyDancr promotions, newsletters, dancer and club alerts, and offers. Optional; unsubscribe at any time.'
   when p_channel='follow' then 'Email me updates from dancers and clubs I follow.' else 'Email me MyDancr offers and newsletters.' end,p_channel);
 end if;
 update public.customer_profiles c set notification_settings=c.notification_settings||jsonb_build_object('emailEnabled',prefs.enabled,'followEmailEnabled',prefs.follow_enabled)
 from public.customer_email_preferences prefs where c.user_id=p_user_id and prefs.user_id=c.user_id returning c.* into v_profile;
 return jsonb_build_object('userId',v_profile.user_id,'city',v_profile.city,'notificationSettings',v_profile.notification_settings);
end $$;

-- Keep the deployed v1 application and already-issued links functional during rollout.
create or replace function public.set_customer_email_preference(p_user_id uuid,p_enabled boolean,p_source text,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_enabled and p_version is distinct from 'customer-email-v1' then raise exception 'EMAIL_CONSENT_REQUIRED' using errcode='22023';end if;
 perform public.set_customer_email_channel_preference(p_user_id,'follow',p_enabled,p_source,p_version);
 return public.set_customer_email_channel_preference(p_user_id,'marketing',p_enabled,p_source,p_version);
end $$;

create or replace function public.manage_customer_email_preference(p_token text,p_unsubscribe boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid;p public.customer_email_preferences%rowtype;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_unsubscribe is null then raise exception 'Invalid preference link' using errcode='22023';end if;
 select user_id into v_user from public.customer_email_preferences where manage_token=p_token;
 if not found then raise exception 'Preference link unavailable' using errcode='P0002';end if;
 perform 1 from public.customer_profiles where user_id=v_user for update;
 select * into p from public.customer_email_preferences where user_id=v_user and manage_token=p_token for update;
 if not found then raise exception 'Preference link unavailable' using errcode='P0002';end if;
 if p_unsubscribe and (p.enabled or p.follow_enabled) then
  update public.customer_email_preferences set enabled=false,follow_enabled=false,withdrawn_at=clock_timestamp(),follow_withdrawn_at=clock_timestamp(),source='email_link' where user_id=v_user;
  update public.customer_profiles set notification_settings=notification_settings||'{"emailEnabled":false,"followEmailEnabled":false}'::jsonb where user_id=v_user;
  insert into public.customer_email_consent_events(user_id,email,enabled,source,consent_text) values(v_user,p.email,false,'email_link','Stop optional MyDancr emails.');
 end if;
 return jsonb_build_object('active',(p.enabled or p.follow_enabled) and not p_unsubscribe);
end $$;

create function public.customer_email_channel_delivery_target(p_user_id uuid,p_channel text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',p.email,'token',p.manage_token)
 from public.customer_email_preferences p join public.customer_profiles c on c.user_id=p.user_id
 join public.app_users a on a.id=p.user_id join auth.users u on u.id=p.user_id
 where p.user_id=p_user_id and a.role='customer' and a.account_state='active' and u.email_confirmed_at is not null
 and lower(btrim(u.email))=p.email and lower(btrim(a.email))=p.email and (
  (p_channel='marketing' and p.enabled and p.consent_version in ('customer-email-v1','customer-email-v2') and p.consented_at is not null and c.notification_settings->'emailEnabled'='true'::jsonb) or
  (p_channel='follow' and p.follow_enabled and p.follow_consent_version in ('customer-email-v1','customer-email-v2') and p.follow_consented_at is not null and c.notification_settings->'followEmailEnabled'='true'::jsonb)
 )
$$;
revoke all on function public.prepare_customer_signup_choices(text,text,boolean,boolean,uuid,text,text,text),
 public.complete_customer_signup_share(uuid),public.complete_customer_signup_share_trigger(),
 public.set_customer_email_channel_preference(uuid,text,boolean,text,text),public.customer_email_channel_delivery_target(uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.prepare_customer_signup_choices(text,text,boolean,boolean,uuid,text,text,text),
 public.set_customer_email_channel_preference(uuid,text,boolean,text,text),public.customer_email_channel_delivery_target(uuid,text) to service_role;
commit;
