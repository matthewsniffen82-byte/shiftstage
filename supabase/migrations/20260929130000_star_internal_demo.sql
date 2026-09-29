begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- The owner explicitly confirmed Star is a demo/test profile. Only her existing
-- operator-locked Echo House assignment can use this additional demo path.
-- This does not verify her identity or exempt any future NFC check-in.
create or replace function public.is_internal_demo_shift(p_shift uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(
   select 1 from public.shifts s
   join public.dancer_profiles d on d.id=s.dancer_id
   join auth.users u on u.id=d.user_id
   where s.id=p_shift and s.shift_summary @> '{"internalDemoRoster":true}'::jsonb
     and exists(select 1 from public.dancer_age_verification_settings where singleton and enabled=false)
     and (
       (s.shift_source='demo_locked'
         and d.slug ~ '^layout-review-(0[1-9]|10)$'
         and u.email=d.slug || '@synthetic.mydancr.invalid'
         and u.raw_user_meta_data->>'dataset_marker'='mydancr-layout-review-v1'
         and u.banned_until>now())
       or
       (d.id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2' and d.slug='lvdegen11'
         and s.id='5dc264bc-c618-4ace-a689-c2791cb3e880'
         and s.venue_id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'
         and s.shift_source='nfc_presence'
         and s.shift_summary @> '{"demoLocked":true,"managedBy":"codex-star-echo-assignment","internalDemoProfile":"star-test-v1"}'::jsonb)
     )
 );
$$;
revoke all on function public.is_internal_demo_shift(uuid) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
