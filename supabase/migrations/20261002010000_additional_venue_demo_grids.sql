begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Keep demo exemptions bound to specific fictional datasets and venues.
-- Existing Echo House, Star, and layout-review behavior remains unchanged.
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
       (s.shift_source='demo_locked'
         and u.email=d.slug || '@synthetic.mydancr.invalid'
         and u.banned_until>now()
         and exists(
           select 1 from (values
             ('260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'::uuid,'echo','mydancr-echo-grid-v1'),
             ('fa4c3d2a-5de9-4ae5-80ba-35528c555521'::uuid,'afterglow','mydancr-afterglow-grid-v1'),
             ('79162674-294a-4c38-be6e-16eec3c42d99'::uuid,'aurora','mydancr-aurora-grid-v1'),
             ('c2a9f8d6-a543-4ac0-9cc6-df8431440e2b'::uuid,'blue-ember','mydancr-blue-ember-grid-v1')
           ) as grid(venue_id,slug_prefix,marker)
           where s.venue_id=grid.venue_id
             and d.slug ~ ('^'||grid.slug_prefix||'-grid-(0[0-9][1-9]|0[1-9]0|100)$')
             and u.raw_user_meta_data->>'dataset_marker'=grid.marker
             and s.shift_summary @> jsonb_build_object('managedBy',grid.marker,'demoLocked',true)
         ))
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
