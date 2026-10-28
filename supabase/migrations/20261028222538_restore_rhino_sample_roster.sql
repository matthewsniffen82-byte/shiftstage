begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Explicitly restored, login-disabled samples are never treated as Ondato verifications.
create function private.is_restored_rhino_sample(p_user uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from auth.users u join public.app_users a on a.id=u.id
  join public.dancer_profiles d on d.user_id=u.id
  join public.venues v on v.id::text=u.raw_app_meta_data->>'demo_venue_id'
  where u.id=p_user and u.deleted_at is null and u.banned_until>now()
   and a.role='dancer' and a.account_state='active'
   and u.raw_app_meta_data->>'dataset_marker'='mydancr-rhino-restored-20261028'
   and u.raw_app_meta_data->>'demo_profile_id'=d.id::text
   and d.slug ~ '^echo-grid-(00[1-9]|01[0-9]|02[0-5])$'
   and u.email=d.slug||'@synthetic.mydancr.invalid'
   and v.slug='spearmint-rhino' and v.is_active);
$$;
revoke all on function private.is_restored_rhino_sample(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enforce_dancer_age_verification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user_id uuid; v_required boolean;
begin
  select enabled into v_required from public.dancer_age_verification_settings where singleton;
  if v_required is false then return new; end if;
  if tg_table_name='dancer_profiles' then
    if not new.is_public and (tg_op='UPDATE' and new.status is not distinct from old.status
      or new.status::text <> 'approved') then return new; end if;
    v_user_id:=new.user_id;
  else
    if new.status::text not in ('draft','posted') then return new; end if;
    select user_id into v_user_id from public.dancer_profiles where id=new.dancer_id;
  end if;
  if private.is_restored_rhino_sample(v_user_id) then return new; end if;
  perform 1 from public.dancer_age_verifications where user_id=v_user_id and provider='ondato' and status='verified' for share;
  if not found then raise exception using errcode='42501',message='Verify you are 18 or older before using dancer features.'; end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_internal_demo_shift(p_shift uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 select exists(select 1 from public.shifts s join public.dancer_profiles d on d.id=s.dancer_id
  join auth.users u on u.id=d.user_id
  where s.id=p_shift and private.is_restored_rhino_sample(d.user_id)
   and s.venue_id::text=u.raw_app_meta_data->>'demo_venue_id'
   and s.shift_source='demo_locked'
   and s.shift_summary @> '{"managedBy":"mydancr-rhino-restored-20261028","demoLocked":true,"internalDemoRoster":true}'::jsonb)
 or exists(
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
             ('c2a9f8d6-a543-4ac0-9cc6-df8431440e2b'::uuid,'blue-ember','mydancr-blue-ember-grid-v1'),
             ('c836884a-a52b-4b10-aadd-e7f349378ffb'::uuid,'starlight','mydancr-starlight-grid-v1'),
             ('dff48bff-4c66-426f-ab1f-6015bebe8777'::uuid,'silver-circuit','mydancr-silver-circuit-grid-v1'),
             ('9045cf7f-3883-44b3-a470-f0ae1d7eb2f0'::uuid,'neon-ember','mydancr-neon-ember-grid-v1')
           ) as grid(venue_id,slug_prefix,marker)
           where s.venue_id=grid.venue_id
             and d.slug ~ ('^'||grid.slug_prefix||'-grid-(0[0-9][1-9]|0[1-9]0|100)$')
             and u.raw_user_meta_data->>'dataset_marker'=grid.marker
             and s.shift_summary @> jsonb_build_object('managedBy',grid.marker,'demoLocked',true)
         ))
       or
       (exists(select 1 from public.venues v join auth.users manager on manager.id=v.owner_user_id
           where v.id=s.venue_id and v.slug='spearmint-rhino-las-vegas-demo'
             and manager.email='spearmint-rhino-las-vegas-demo@synthetic.mydancr.invalid'
             and manager.raw_app_meta_data->>'dataset_marker'='mydancr-spearmint-rhino-las-vegas-demo-v1'
             and manager.banned_until>now())
         and s.shift_summary->>'demoAssignment'='mydancr-spearmint-rhino-las-vegas-demo-v1'
         and s.shift_summary @> '{"demoLocked":true}'::jsonb
         and (
           (s.shift_source='demo_locked' and d.slug ~ '^echo-grid-(0[0-9][1-9]|0[1-9]0|100)$'
             and u.email=d.slug || '@synthetic.mydancr.invalid' and u.banned_until>now()
             and u.raw_user_meta_data->>'dataset_marker'='mydancr-echo-grid-v1'
             and s.shift_summary->>'managedBy'='mydancr-echo-grid-v1')
           or (d.id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2' and d.slug='lvdegen11'
             and s.id='5dc264bc-c618-4ace-a689-c2791cb3e880' and s.shift_source='nfc_presence'
             and s.shift_summary @> '{"managedBy":"codex-star-echo-assignment","internalDemoProfile":"star-test-v1"}'::jsonb)
         ))
       or
       (d.id='70e50bad-b7be-45ad-bc7a-64f1cba6b5e2' and d.slug='lvdegen11'
         and s.id='5dc264bc-c618-4ace-a689-c2791cb3e880'
         and s.venue_id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af'
         and s.shift_source='nfc_presence'
         and s.shift_summary @> '{"demoLocked":true,"managedBy":"codex-star-echo-assignment","internalDemoProfile":"star-test-v1"}'::jsonb)
     )
 );
$function$
;

CREATE OR REPLACE FUNCTION private.venue_operational_email_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n jsonb:=to_jsonb(new); o jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 venue uuid:=(n->>'venue_id')::uuid; club text; dancer text; kind text; title text; message text; path text;
 key text; managers boolean:=true;
begin
 if venue is null then return new; end if;
 -- Restoring sample roster rows must not email the real club team.
 if n ? 'dancer_id' and exists(select 1 from public.dancer_profiles d where d.id=(n->>'dancer_id')::uuid
   and private.is_restored_rhino_sample(d.user_id)) then return new; end if;
 select name into club from public.venues where id=venue;
 if n ? 'dancer_id' then select stage_name into dancer from public.dancer_profiles where id=(n->>'dancer_id')::uuid; end if;
 key:=tg_table_name||':'||coalesce(n->>'id',n->>'pass_id',n->>'dancer_id')||':'||coalesce(n->>'updated_at',n->>'revision',n->>'created_at','');
 if tg_table_name='venue_guest_list_entries' then
  kind:='venue_guest_list_added'; title:='New guest-list entry'; path:='/dashboard/venue#venue-guest-list';
  message:='A guest joined the guest list for '||club||'. Open your club dashboard for their details.';
 elsif tg_table_name='club_dancer_approvals' then
  if n->>'status'<>'pending' or (o->>'status'='pending' and n->>'requested_at'=o->>'requested_at') then return new; end if;
  key:='dancer-review:'||venue||':'||(n->>'dancer_id')||':'||(n->>'requested_at');
  kind:='venue_dancer_approval_pending'; title:='Dancer awaiting club approval'; path:='/dashboard/venue#venue-dancer-approvals';
  message:=coalesce(dancer,'A dancer')||' is waiting for your club’s profile review at '||club||'.';
 elsif tg_table_name='shifts' then
  if n->>'shift_source'='demo_locked' then return new; end if;
  managers:=false; path:='/dashboard/venue#venue-working-now';
  if n->>'checked_in_at' is not null and o->>'checked_in_at' is null then
   kind:='venue_checkin_started'; title:='Dancer checked in'; message:=coalesce(dancer,'A dancer')||' checked in at '||club||'.';
   key:='checkin:'||(n->>'id')||':'||(n->>'checked_in_at');
  elsif n->>'checked_out_at' is not null and o->>'checked_out_at' is null then
   kind:='venue_checkout_ended'; title:='Dancer checked out'; message:=coalesce(dancer,'A dancer')||' checked out at '||club||'.';
   key:='checkout:'||(n->>'id')||':'||(n->>'checked_out_at');
  elsif n->>'checked_in_at' is null and n->>'shift_source'='scheduled'
   and (tg_op='INSERT' or (n->>'starts_at',n->>'ends_at',n->>'status') is distinct from (o->>'starts_at',o->>'ends_at',o->>'status')) then
   kind:='venue_checkin_schedule'; title:='Scheduled appearance updated'; message:=coalesce(dancer,'A dancer')||' updated a scheduled appearance at '||club||'. Check the roster for the current time and status.';
  else return new; end if;
 elsif tg_table_name='venue_dancer_affiliations' then
  if (n->>'status',n->>'revoked_at') is not distinct from (o->>'status',o->>'revoked_at') then return new; end if;
  kind:='venue_roster_changed'; title:='Dancer roster updated'; path:='/dashboard/venue#venue-working-now';
  message:=coalesce(dancer,'A dancer')||case when n->>'status'='active' and n->>'revoked_at' is null then ' joined the roster at ' else ' is no longer active on the roster at ' end||club||'.';
 elsif tg_table_name='venue_team_members' then
  if (n->>'status',n->>'role') is not distinct from (o->>'status',o->>'role') then return new; end if;
  kind:='venue_team_changed'; title:='Club team access updated'; path:='/dashboard/venue#venue-team';
  message:='Team access changed at '||club||'. Review the current members and access levels in your club dashboard.';
 elsif tg_table_name='venue_club_deal_requests' then
  if n->>'status' is not distinct from o->>'status' then return new; end if;
  kind:='club_deal_request_updated'; title:='Club Deal request updated'; path:='/dashboard/venue#venue-club-deals';
  message:='The Club Deal request for '||club||' is now '||replace(n->>'status','_',' ')||'. Open your dashboard for the decision and any notes.';
 elsif tg_table_name='club_deals' then
  if tg_op='UPDATE' and (n->>'deal_title',n->>'deal_description',n->>'deal_terms',n->>'is_active',n->>'removed_at')
   is not distinct from (o->>'deal_title',o->>'deal_description',o->>'deal_terms',o->>'is_active',o->>'removed_at') then return new; end if;
  kind:='club_deal_updated'; title:='Club Deal updated'; path:='/dashboard/venue#venue-club-deals';
  message:='A Club Deal for '||club||' changed. Review the current offer and terms in your club dashboard.';
 else return new; end if;
 perform private.emit_venue_email_event(venue,key,kind,title,message,path,managers);
 return new;
end $function$
;
notify pgrst,'reload schema';
commit;
