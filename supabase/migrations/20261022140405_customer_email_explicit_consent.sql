-- Account-wide email consent is separate from each club's email/text permissions.
create table public.customer_email_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 enabled boolean not null default false,
 consent_version text,
 consented_at timestamptz,
 source text not null,
 withdrawn_at timestamptz,
 manage_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
 check (not enabled or (consent_version = 'customer-email-v1' and consented_at is not null)),
 check (manage_token ~ '^[a-f0-9]{64}$')
);
create table public.customer_email_consent_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null, enabled boolean not null, source text not null,
 consent_version text, consent_text text not null,
 recorded_at timestamptz not null default clock_timestamp()
);
create index customer_email_consent_events_user on public.customer_email_consent_events(user_id,recorded_at);
create table public.customer_email_signup_intents (
 token uuid primary key default gen_random_uuid(), email text not null,
 accepted_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp() + interval '1 hour'
);
create index customer_email_signup_expiry on public.customer_email_signup_intents(expires_at);
alter table public.customer_email_preferences enable row level security;
alter table public.customer_email_consent_events enable row level security;
alter table public.customer_email_signup_intents enable row level security;
revoke all on public.customer_email_preferences,public.customer_email_consent_events,public.customer_email_signup_intents from public,anon,authenticated,service_role;

-- Historical booleans have no consent wording/receipt. Do not invent opt-in evidence.
insert into public.customer_email_consent_events(user_id,email,enabled,source,consent_text)
 select p.user_id,coalesce(u.email,''),false,'legacy_default_reset',
 'Optional email disabled because no affirmative consent receipt was recorded.'
 from public.customer_profiles p join auth.users u on u.id=p.user_id;
update public.customer_profiles set notification_settings=notification_settings || '{"emailEnabled":false}'::jsonb;
alter table public.customer_profiles alter column notification_settings set default
 '{"followedDancersOnly":true,"followedVenuesOnly":true,"anyDancerInCity":false,"workingTonight":true,"newShifts":true,"venueSchedules":true,"clubChanges":true,"cancelledShifts":true,"emailEnabled":false}'::jsonb;

create function public.prepare_customer_email_signup(p_email text,p_version text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_token uuid;
begin
 if p_version is distinct from 'customer-email-v1' or p_email is null or length(p_email)>254 or p_email not like '%@%' then
  raise exception 'EMAIL_CONSENT_REQUIRED' using errcode='22023';
 end if;
 delete from public.customer_email_signup_intents where expires_at<clock_timestamp();
 insert into public.customer_email_signup_intents(email) values(lower(btrim(p_email))) returning token into v_token;
 return v_token;
end $$;

create function public.attach_customer_email_signup() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_intent public.customer_email_signup_intents%rowtype;
begin
 if new.raw_user_meta_data->>'role'='customer' then
  delete from public.customer_email_signup_intents i
   where i.token::text=new.raw_user_meta_data->>'customer_email_intent'
    and i.email=lower(btrim(new.email)) and i.expires_at>clock_timestamp()
   returning i.* into v_intent;
  if found then
   insert into public.customer_email_preferences(user_id,email,enabled,consent_version,consented_at,source)
    values(new.id,v_intent.email,true,'customer-email-v1',v_intent.accepted_at,'signup');
   insert into public.customer_email_consent_events(user_id,email,enabled,source,consent_version,consent_text,recorded_at)
    values(new.id,v_intent.email,true,'signup','customer-email-v1',
     'Email me MyDancr promotions, newsletters, dancer and club alerts, and offers. Optional; unsubscribe at any time.',v_intent.accepted_at);
   update public.customer_profiles set notification_settings=notification_settings || '{"emailEnabled":true}'::jsonb where user_id=new.id;
  end if;
 end if;
 return new;
end $$;
-- Only new identities consume signup intent. Repeat signup/metadata edits cannot resubscribe.
create trigger attach_customer_email_signup after insert on auth.users
 for each row execute function public.attach_customer_email_signup();

create function public.guard_customer_email_preference() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.notification_settings := coalesce(new.notification_settings,'{}'::jsonb) || jsonb_build_object('emailEnabled',exists(
   select 1 from public.customer_email_preferences p where p.user_id=new.user_id and p.enabled
  ));
 elsif current_setting('role',true) in ('anon','authenticated')
   and new.notification_settings->'emailEnabled' is distinct from old.notification_settings->'emailEnabled' then
  raise exception 'Use the email consent endpoint' using errcode='42501';
 end if;
 return new;
end $$;
create trigger guard_customer_email_preference before insert or update on public.customer_profiles
 for each row execute function public.guard_customer_email_preference();

create function public.set_customer_email_preference(p_user_id uuid,p_enabled boolean,p_source text,p_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_email text; v_previous public.customer_email_preferences%rowtype; v_now timestamptz:=clock_timestamp(); v_profile public.customer_profiles%rowtype;
begin
 if p_enabled is null or p_source not in ('account_preferences','notification_preferences','legacy_preferences') or p_source is null
  or (p_enabled and p_source='legacy_preferences')
  or (p_enabled and p_version is distinct from 'customer-email-v1') then
  raise exception 'EMAIL_CONSENT_REQUIRED' using errcode='22023';
 end if;
 select lower(btrim(u.email)) into v_email from auth.users u join public.app_users a on a.id=u.id
  where u.id=p_user_id and a.role='customer' and a.account_state='active'
   and (not p_enabled or (u.email_confirmed_at is not null and u.email is not null));
 if not found then raise exception 'Active verified customer required' using errcode='42501'; end if;
 select * into strict v_profile from public.customer_profiles where user_id=p_user_id for update;
 select * into v_previous from public.customer_email_preferences where user_id=p_user_id;
 if v_previous.user_id is null or v_previous.enabled is distinct from p_enabled or v_previous.email is distinct from v_email then
  insert into public.customer_email_preferences(user_id,email,enabled,consent_version,consented_at,source,withdrawn_at)
   values(p_user_id,coalesce(v_email,''),p_enabled,case when p_enabled then 'customer-email-v1' end,case when p_enabled then v_now end,p_source,case when not p_enabled then v_now end)
   on conflict(user_id) do update set email=excluded.email,enabled=excluded.enabled,
    consent_version=case when excluded.enabled then excluded.consent_version else customer_email_preferences.consent_version end,
    consented_at=case when excluded.enabled then excluded.consented_at else customer_email_preferences.consented_at end,
    source=excluded.source,withdrawn_at=excluded.withdrawn_at,
    manage_token=case when excluded.enabled then excluded.manage_token else customer_email_preferences.manage_token end;
  insert into public.customer_email_consent_events(user_id,email,enabled,source,consent_version,consent_text)
   values(p_user_id,coalesce(v_email,''),p_enabled,p_source,case when p_enabled then 'customer-email-v1' end,
    case when p_enabled then 'Email me MyDancr promotions, newsletters, dancer and club alerts, and offers. Optional; unsubscribe at any time.' else 'Stop optional MyDancr emails.' end);
 end if;
 update public.customer_profiles set notification_settings=notification_settings || jsonb_build_object('emailEnabled',p_enabled)
  where user_id=p_user_id returning * into v_profile;
 return jsonb_build_object('userId',v_profile.user_id,'city',v_profile.city,'notificationSettings',v_profile.notification_settings);
end $$;

create function public.manage_customer_email_preference(p_token text,p_unsubscribe boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_preference public.customer_email_preferences%rowtype;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_unsubscribe is null then raise exception 'Invalid preference link' using errcode='22023'; end if;
 select user_id into v_user from public.customer_email_preferences where manage_token=p_token;
 if not found then raise exception 'Preference link unavailable' using errcode='P0002'; end if;
 -- Match the account update lock order; recheck token after concurrent resubscription.
 perform 1 from public.customer_profiles where user_id=v_user for update;
 select * into v_preference from public.customer_email_preferences where user_id=v_user and manage_token=p_token for update;
 if not found then raise exception 'Preference link unavailable' using errcode='P0002'; end if;
 if p_unsubscribe and v_preference.enabled then
  update public.customer_email_preferences set enabled=false,withdrawn_at=clock_timestamp(),source='email_link' where user_id=v_user;
  update public.customer_profiles set notification_settings=notification_settings || '{"emailEnabled":false}'::jsonb where user_id=v_user;
  insert into public.customer_email_consent_events(user_id,email,enabled,source,consent_text)
   values(v_user,v_preference.email,false,'email_link','Stop optional MyDancr emails.');
 end if;
 return jsonb_build_object('active',v_preference.enabled and not p_unsubscribe);
end $$;

-- Read immediately before delivery; an address change requires a fresh explicit opt-in.
create function public.customer_email_delivery_target(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('email',p.email,'token',p.manage_token)
 from public.customer_email_preferences p join public.customer_profiles c on c.user_id=p.user_id
 join public.app_users a on a.id=p.user_id join auth.users u on u.id=p.user_id
 where p.user_id=p_user_id and p.enabled and p.consent_version='customer-email-v1' and p.consented_at is not null
  and c.notification_settings->'emailEnabled'='true'::jsonb and a.role='customer' and a.account_state='active'
  and u.email_confirmed_at is not null and lower(btrim(u.email))=p.email and lower(btrim(a.email))=p.email
$$;

revoke all on function public.prepare_customer_email_signup(text,text),public.attach_customer_email_signup(),public.guard_customer_email_preference(),
 public.set_customer_email_preference(uuid,boolean,text,text),public.manage_customer_email_preference(text,boolean),public.customer_email_delivery_target(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.prepare_customer_email_signup(text,text),public.set_customer_email_preference(uuid,boolean,text,text),
 public.manage_customer_email_preference(text,boolean),public.customer_email_delivery_target(uuid) to service_role;
