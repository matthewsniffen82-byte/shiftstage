-- Operator-only setup for the explicitly confirmed Star demo/test profile.
-- Preserves her public profile, existing venue, shift deadline and verification.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $$
begin
  perform 1 from public.dancer_profiles d join public.app_users u on u.id=d.user_id
    where d.id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2' and d.slug='lvdegen11' and d.stage_name='Star'
      and d.status='approved' and d.verification_status='approved' and d.is_public
      and d.disabled_at is null and nullif(d.avatar_storage_path,'') is not null
      and u.role='dancer' and u.account_state='active' for update of d;
  if not found then raise exception 'The intended active Star test profile is unavailable'; end if;
  perform 1 from public.shifts s
    where s.id='5dc264bc-c618-4ace-a689-c2791cb3e880'
      and s.dancer_id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2'
      and s.venue_id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af' and s.shift_source='nfc_presence'
      and s.shift_summary @> '{"demoLocked":true,"managedBy":"codex-star-echo-assignment"}'::jsonb
      and s.status='posted' and s.checked_in_at is not null and s.checked_out_at is null
      and s.location_status='club_confirmed' and s.location_verification_expires_at>now() for update;
  if not found then raise exception 'Star no longer has the intended live Echo House demo assignment'; end if;
  if not exists(select 1 from public.dancer_age_verification_settings where singleton and enabled=false) then
    raise exception 'Demo roster setup is disabled when real age enforcement is active';
  end if;
  if not exists(select 1 from public.venues v join public.app_users u on u.id=v.owner_user_id
    where v.id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af' and v.name='Echo House'
      and v.is_active and u.role='venue' and u.account_state='active') then
    raise exception 'The intended active demo venue is unavailable';
  end if;
  if exists(select 1 from public.venue_dancer_affiliations
    where venue_id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af' and dancer_id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2'
      and (status<>'active' or revoked_at is not null or reentry_blocked)) then
    raise exception 'Refusing to reverse a staff removal';
  end if;
  if exists(select 1 from public.dancer_channel_preferences
    where dancer_id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2' and visibility<>'both') then
    raise exception 'Refusing to overwrite a new visibility choice';
  end if;
end;
$$;

insert into public.venue_dancer_affiliations(venue_id,dancer_id)
values('260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af','70e50bad-b7be-45ad-bc7a-64f1cba6b5e2')
on conflict(venue_id,dancer_id) do nothing;

update public.shifts s set venue_affiliation_id=a.id,updated_at=now(),
  shift_summary=s.shift_summary || '{"internalDemoRoster":true,"internalDemoProfile":"star-test-v1"}'::jsonb
from public.venue_dancer_affiliations a
where s.id='5dc264bc-c618-4ace-a689-c2791cb3e880' and a.dancer_id=s.dancer_id and a.venue_id=s.venue_id;

insert into public.dancer_channel_preferences(dancer_id,visibility)
values('70e50bad-b7be-45ad-bc7a-64f1cba6b5e2','both') on conflict(dancer_id) do nothing;
insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility)
values('5dc264bc-c618-4ace-a689-c2791cb3e880','70e50bad-b7be-45ad-bc7a-64f1cba6b5e2','260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af','both')
on conflict(shift_id) do update set visibility=excluded.visibility,selected_at=now();

do $$
begin
  if not exists(select 1 from public.internal_roster_members('260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af')
    where id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2' and working_until>now())
    or not exists(select 1 from public.venue_roster_members('260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af')
    where id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2' and internal_visible and external_visible and working_until>now()) then
    raise exception 'Star did not become live in both rosters; rolling back';
  end if;
end;
$$;
commit;
