begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Only explicitly managed, login-disabled fictional accounts qualify.
-- No Ondato record is created, and enabling real age enforcement disables this path.
create function public.is_internal_demo_shift(p_shift uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(
   select 1 from public.shifts s
   join public.dancer_profiles d on d.id=s.dancer_id
   join auth.users u on u.id=d.user_id
   where s.id=p_shift and s.shift_source='demo_locked'
     and s.shift_summary @> '{"internalDemoRoster":true}'::jsonb
     and d.slug ~ '^layout-review-(0[1-9]|10)$'
     and u.email=d.slug || '@synthetic.mydancr.invalid'
     and u.raw_user_meta_data->>'dataset_marker'='mydancr-layout-review-v1'
     and u.banned_until>now()
     and exists(select 1 from public.dancer_age_verification_settings where singleton and enabled=false)
 );
$$;
revoke all on function public.is_internal_demo_shift(uuid) from public,anon,authenticated,service_role;

create or replace function public.internal_roster_members(p_venue_id uuid)
returns table(id uuid,stage_name text,avatar_storage_path text,working_until timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
 select d.id,d.stage_name,d.avatar_storage_path,max(s.location_verification_expires_at)
 from public.dancer_shift_channels c
 join public.shifts s on s.id=c.shift_id and s.dancer_id=c.dancer_id and s.venue_id=c.venue_id
 join public.dancer_profiles d on d.id=c.dancer_id
 join public.dancer_channel_preferences pref on pref.dancer_id=d.id and pref.visibility in ('internal','both')
 join public.app_users u on u.id=d.user_id and u.account_state='active' and u.role='dancer'
 join public.venues v on v.id=c.venue_id and v.is_active
 join public.app_users owner on owner.id=v.owner_user_id and owner.account_state='active' and owner.role='venue'
 join public.venue_dancer_affiliations a on a.venue_id=c.venue_id and a.dancer_id=d.id and a.status='active' and a.revoked_at is null
 where c.venue_id=p_venue_id and c.visibility in ('internal','both') and d.status='approved'
 and d.verification_status='approved' and d.disabled_at is null and nullif(d.avatar_storage_path,'') is not null
 and (exists(select 1 from public.dancer_age_verifications where user_id=d.user_id and provider='ondato' and status='verified') or public.is_internal_demo_shift(s.id))
 and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
 and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
 group by d.id,d.stage_name,d.avatar_storage_path;
$$;

create or replace function public.venue_roster_members(p_venue_id uuid)
returns table(id uuid,stage_name text,avatar_storage_path text,working_until timestamptz,internal_visible boolean,external_visible boolean)
language sql stable security definer set search_path=public,pg_temp as $$
 select d.id,d.stage_name,d.avatar_storage_path,presence.working_until,
   coalesce(presence.internal_visible,false),coalesce(presence.external_visible,false)
 from public.venue_dancer_affiliations a
 join public.dancer_profiles d on d.id=a.dancer_id
 join public.app_users u on u.id=d.user_id and u.role='dancer' and u.account_state='active'
 join public.venues v on v.id=a.venue_id and v.is_active
 join public.app_users owner on owner.id=v.owner_user_id and owner.role='venue' and owner.account_state='active'
 left join public.dancer_channel_preferences pref on pref.dancer_id=d.id
 left join lateral (
   select max(s.location_verification_expires_at) working_until,
     bool_or(c.visibility in ('internal','both') and pref.visibility in ('internal','both')
       and (exists(select 1 from public.dancer_age_verifications age where age.user_id=d.user_id and age.provider='ondato' and age.status='verified') or public.is_internal_demo_shift(s.id))) internal_visible,
     bool_or(d.is_public and coalesce(c.visibility,'external') in ('external','both')
       and coalesce(pref.visibility,'external') in ('external','both')) external_visible
   from public.shifts s
   left join public.dancer_shift_channels c on c.shift_id=s.id and c.dancer_id=d.id and c.venue_id=a.venue_id
   where s.dancer_id=d.id and s.venue_id=a.venue_id and s.status='posted'
     and s.checked_in_at is not null and s.checked_out_at is null
     and s.location_status='club_confirmed' and s.location_verification_expires_at>now()
 ) presence on true
 where a.venue_id=p_venue_id and a.status='active' and a.revoked_at is null
   and d.status='approved' and d.verification_status='approved' and d.disabled_at is null
   and nullif(d.avatar_storage_path,'') is not null;
$$;

notify pgrst,'reload schema';
commit;
