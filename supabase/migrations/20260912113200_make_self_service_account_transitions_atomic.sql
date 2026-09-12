-- Self-service account changes share one transaction and a private pause record.
-- Later explicit account, venue or profile decisions invalidate restoration,
-- including same-value writes. No Auth provider metadata is written.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.account_self_pauses (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  paused_at timestamptz not null default now() check(isfinite(paused_at)),
  venue_id uuid references public.venues(id) on delete set null,
  venue_was_active boolean,
  dancer_id uuid references public.dancer_profiles(id) on delete set null,
  dancer_previous_state jsonb,
  legacy_imported boolean not null default false,
  check(dancer_previous_state is null or (
    jsonb_typeof(dancer_previous_state) = 'object'
    and dancer_previous_state ?& array['status','disabled_at','is_public']
    and dancer_previous_state - array['status','disabled_at','is_public'] = '{}'::jsonb
    and dancer_previous_state->>'status' in ('draft','pending_review','approved','rejected','disabled')
    and jsonb_typeof(dancer_previous_state->'is_public') = 'boolean'
    and jsonb_typeof(dancer_previous_state->'disabled_at') in ('string','null')
  ))
);
create index account_self_pauses_venue_idx on public.account_self_pauses(venue_id) where venue_id is not null;
create index account_self_pauses_dancer_idx on public.account_self_pauses(dancer_id) where dancer_id is not null;
alter table public.account_self_pauses enable row level security;
revoke all on public.account_self_pauses from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.account_self_pauses to service_role;

create function public.invalidate_account_self_pause()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if tg_level <> 'ROW' or tg_when <> 'AFTER' or tg_op not in ('UPDATE','DELETE') then
    raise exception 'ACCOUNT_PAUSE_INVALID_TRIGGER' using errcode='42501';
  end if;
  if tg_relid = 'public.app_users'::regclass then
    delete from public.account_self_pauses where user_id = old.id;
  elsif tg_relid = 'public.venues'::regclass then
    update public.account_self_pauses set venue_was_active = null where venue_id = old.id;
  elsif tg_relid = 'public.dancer_profiles'::regclass then
    update public.account_self_pauses set dancer_previous_state = null where dancer_id = old.id;
  else
    raise exception 'ACCOUNT_PAUSE_INVALID_SOURCE' using errcode='42501';
  end if;
  return null;
end;
$function$;
revoke all on function public.invalidate_account_self_pause() from public, anon, authenticated, service_role;

create trigger invalidate_account_pause_after_decision
after update of role, account_state, dmca_suspended_at or delete on public.app_users
for each row execute function public.invalidate_account_self_pause();
create trigger invalidate_account_pause_after_venue_decision
after update of owner_user_id, is_active, page_review_status, published_at or delete on public.venues
for each row execute function public.invalidate_account_self_pause();
create trigger invalidate_account_pause_after_profile_decision
after update of user_id, status, is_public, disabled_at, admin_disabled_at, dmca_suspended_at,
  verification_status, photo_review_status, approved_at, venue_approved_at,
  venue_approved_by_user_id, venue_approved_venue_id
or delete on public.dancer_profiles
for each row execute function public.invalidate_account_self_pause();

-- Preserve trusted existing self-paused login access. Previous public visibility
-- was not durably recorded, so an imported pause never republishes old content.
-- An eligible dancer may explicitly publish again after this private restoration.
insert into public.account_self_pauses(user_id, paused_at, dancer_id, dancer_previous_state, legacy_imported)
select a.id, now(), d.id,
  case when d.status = 'disabled' and d.admin_disabled_at is null and d.dmca_suspended_at is null then
    jsonb_build_object('status', case
      when d.verification_status = 'rejected' then 'rejected'
      when d.verification_status = 'approved' and d.approved_at is not null and d.venue_approved_at is not null then 'approved'
      else 'pending_review' end, 'disabled_at', null, 'is_public', false)
    else null end,
  true
from public.app_users a join auth.users u on u.id = a.id
left join public.dancer_profiles d on d.user_id = a.id and a.role = 'dancer'
where a.account_state = 'disabled' and a.dmca_suspended_at is null
  and jsonb_typeof(u.raw_app_meta_data->'mydancr_self_disabled_at') = 'string'
  and u.raw_app_meta_data->>'mydancr_self_disabled_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$';

create function public.transition_own_account_safely(p_user_id uuid, p_account_state text)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '3s'
as $function$
declare
  v_account public.app_users%rowtype;
  v_venue public.venues%rowtype;
  v_dancer public.dancer_profiles%rowtype;
  v_pause public.account_self_pauses%rowtype;
  v_previous_dancer jsonb;
  v_affected bigint;
  v_role public.user_role;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'ACCOUNT_TRANSITION_SERVICE_REQUIRED' using errcode='42501';
  end if;
  if p_user_id is null or p_account_state is null or p_account_state not in ('active','disabled','deleted') then
    raise exception 'ACCOUNT_TRANSITION_INVALID_INPUT' using errcode='22023';
  end if;
  select * into v_account from public.app_users where id = p_user_id for update;
  if not found then raise exception 'ACCOUNT_TRANSITION_NOT_FOUND' using errcode='42501'; end if;
  v_role := v_account.role;
  if p_account_state <> 'deleted' and (v_account.account_state = 'deleted' or v_account.dmca_suspended_at is not null) then
    raise exception 'ACCOUNT_TRANSITION_RESTRICTED' using errcode='42501';
  end if;

  -- Lock resources before the pause record: independent venue/profile writers
  -- already hold their resource row when their invalidation trigger runs.
  if v_account.role = 'venue' then
    select * into v_venue from public.venues where owner_user_id = p_user_id for update;
  elsif v_account.role = 'dancer' then
    select * into v_dancer from public.dancer_profiles where user_id = p_user_id for update;
  end if;
  select * into v_pause from public.account_self_pauses where user_id = p_user_id for update;
  if v_account.account_state = 'disabled' and p_account_state <> 'deleted' and v_pause.user_id is null then
    raise exception 'ACCOUNT_TRANSITION_NOT_SELF_PAUSED' using errcode='42501';
  end if;
  if p_account_state = v_account.account_state::text and p_account_state <> 'deleted' then
    return jsonb_build_object('id',v_account.id,'role',v_account.role,'display_name',v_account.display_name,
      'email',v_account.email,'account_state',v_account.account_state);
  end if;

  if p_account_state = 'disabled' and v_dancer.id is not null then
    v_previous_dancer := jsonb_build_object('status',v_dancer.status,'disabled_at',v_dancer.disabled_at,'is_public',v_dancer.is_public);
  end if;
  update public.app_users set account_state = p_account_state::public.account_state,
    display_name = case when p_account_state = 'deleted' then null else display_name end,
    email = case when p_account_state = 'deleted' then null else email end
    where id = p_user_id and (p_account_state <> 'active' or dmca_suspended_at is null)
    returning * into v_account;
  if not found then raise exception 'ACCOUNT_TRANSITION_WRITE_MISMATCH' using errcode='40001'; end if;
  if v_account.id is distinct from p_user_id or v_account.role is distinct from v_role
    or v_account.account_state::text is distinct from p_account_state
    or (p_account_state = 'active' and v_account.dmca_suspended_at is not null)
    or (p_account_state = 'deleted' and (v_account.email is not null or v_account.display_name is not null)) then
    raise exception 'ACCOUNT_TRANSITION_WRITE_MISMATCH' using errcode='40001';
  end if;

  if p_account_state <> 'active' then
    if v_venue.id is not null then
      update public.venues set is_active = false where id = v_venue.id and owner_user_id = p_user_id;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.venues where id = v_venue.id and owner_user_id = p_user_id and not is_active) then
        raise exception 'ACCOUNT_TRANSITION_VENUE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
    if v_dancer.id is not null then
      update public.dancer_profiles set status = 'disabled', is_public = false,
        disabled_at = coalesce(disabled_at, clock_timestamp()), updated_at = clock_timestamp()
        where id = v_dancer.id and user_id = p_user_id;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.dancer_profiles where id = v_dancer.id and user_id = p_user_id
        and status = 'disabled' and not is_public and disabled_at is not null) then
        raise exception 'ACCOUNT_TRANSITION_PROFILE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
    if p_account_state = 'disabled' then
      insert into public.account_self_pauses(user_id, venue_id, venue_was_active, dancer_id, dancer_previous_state)
        values(p_user_id, v_venue.id, v_venue.is_active, v_dancer.id, v_previous_dancer);
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.account_self_pauses where user_id = p_user_id
        and venue_id is not distinct from v_venue.id and venue_was_active is not distinct from v_venue.is_active
        and dancer_id is not distinct from v_dancer.id and dancer_previous_state is not distinct from v_previous_dancer and not legacy_imported) then
        raise exception 'ACCOUNT_TRANSITION_PAUSE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
  else
    if v_venue.id is not null and v_pause.venue_id = v_venue.id and v_pause.venue_was_active is not null then
      update public.venues set is_active = v_pause.venue_was_active where id = v_venue.id and owner_user_id = p_user_id;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.venues where id = v_venue.id and owner_user_id = p_user_id
        and is_active is not distinct from v_pause.venue_was_active) then
        raise exception 'ACCOUNT_TRANSITION_VENUE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
    if v_dancer.id is not null and v_pause.dancer_id = v_dancer.id and v_pause.dancer_previous_state is not null
      and v_dancer.admin_disabled_at is null and v_dancer.dmca_suspended_at is null then
      update public.dancer_profiles set
        status = (v_pause.dancer_previous_state->>'status')::public.dancer_status,
        disabled_at = (v_pause.dancer_previous_state->>'disabled_at')::timestamptz,
        is_public = (v_pause.dancer_previous_state->>'is_public')::boolean
          and v_pause.dancer_previous_state->>'status' = 'approved'
          and verification_status = 'approved' and approved_at is not null and venue_approved_at is not null
          and v_pause.dancer_previous_state->>'disabled_at' is null,
        updated_at = clock_timestamp()
        where id = v_dancer.id and user_id = p_user_id and admin_disabled_at is null and dmca_suspended_at is null;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 or not exists(select 1 from public.dancer_profiles where id = v_dancer.id and user_id = p_user_id
        and status::text = v_pause.dancer_previous_state->>'status'
        and disabled_at is not distinct from (v_pause.dancer_previous_state->>'disabled_at')::timestamptz
        and is_public is not distinct from ((v_pause.dancer_previous_state->>'is_public')::boolean
          and v_pause.dancer_previous_state->>'status' = 'approved'
          and verification_status = 'approved' and approved_at is not null and venue_approved_at is not null
          and v_pause.dancer_previous_state->>'disabled_at' is null)) then
        raise exception 'ACCOUNT_TRANSITION_PROFILE_WRITE_MISMATCH' using errcode='40001';
      end if;
    end if;
  end if;
  if not exists(select 1 from public.app_users where id = p_user_id and role = v_role
    and account_state::text = p_account_state and (p_account_state <> 'active' or dmca_suspended_at is null))
    or (p_account_state <> 'disabled' and exists(select 1 from public.account_self_pauses where user_id = p_user_id)) then
    raise exception 'ACCOUNT_TRANSITION_FINAL_STATE_MISMATCH' using errcode='40001';
  end if;
  return jsonb_build_object('id',v_account.id,'role',v_account.role,'display_name',v_account.display_name,
    'email',v_account.email,'account_state',v_account.account_state);
end;
$function$;
revoke all on function public.transition_own_account_safely(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.transition_own_account_safely(uuid,text) to service_role;

-- Old immutable application deployments still have the service key. Retire
-- their direct account writes and venue compensation at the database boundary.
-- Other service column updates and all unrelated role privileges remain intact.
revoke update on public.app_users, public.venues from service_role;
revoke update(account_state) on public.app_users from service_role;
revoke update(is_active) on public.venues from service_role;
do $column_grants$
declare v_table text; v_private text; v_columns text;
begin
  for v_table,v_private in select * from(values('app_users','account_state'),('venues','is_active'))t(table_name,private_column) loop
    select string_agg(format('%I',a.attname),','order by a.attnum)into v_columns
      from pg_attribute a where a.attrelid=format('public.%I',v_table)::regclass
      and a.attnum>0 and not a.attisdropped and a.attname<>v_private;
    execute format('grant update(%s)on public.%I to service_role',v_columns,v_table);
    if has_column_privilege('service_role',format('public.%I',v_table),v_private,'UPDATE') then
      raise exception 'ACCOUNT_TRANSITION_LEGACY_WRITE_ACCESS_REMAINS';
    end if;
  end loop;
end;
$column_grants$;

-- Preserve legitimate administrator edits/publication and active venue-owner
-- or manager review after retiring direct service updates of is_active.
create function public.change_venue_publication_safely(
  p_actor_user_id uuid, p_venue_id uuid, p_action text, p_changes jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '3s'
as $function$
declare
  v_actor public.app_users%rowtype;
  v_venue public.venues%rowtype;
  v_owner uuid;
  v_changes jsonb;
  v_expected jsonb;
  v_result jsonb;
  v_columns text;
  v_notes text;
  v_affected bigint;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'VENUE_PUBLICATION_SERVICE_REQUIRED' using errcode='42501';end if;
  if p_actor_user_id is null or p_venue_id is null or p_action is null
    or p_action not in('admin_edit','admin_publish','owner_approve','owner_request_changes')
    or p_changes is null or jsonb_typeof(p_changes)<>'object' or octet_length(p_changes::text)>65536 then
    raise exception 'VENUE_PUBLICATION_INVALID_INPUT' using errcode='22023';
  end if;
  select owner_user_id into v_owner from public.venues where id=p_venue_id;
  if not found then raise exception 'VENUE_PUBLICATION_NOT_FOUND' using errcode='42501';end if;
  -- The same account-before-venue order as self-pause, with stable ordering for
  -- a manager and owner. Recheck ownership after acquiring the venue lock.
  perform id from public.app_users where id=p_actor_user_id or id=v_owner order by id for share;
  select * into v_actor from public.app_users where id=p_actor_user_id;
  if not found or v_actor.account_state<>'active' or v_actor.dmca_suspended_at is not null then
    raise exception 'VENUE_PUBLICATION_ACTIVE_ACTOR_REQUIRED' using errcode='42501';
  end if;
  select * into v_venue from public.venues where id=p_venue_id for update;
  if not found or v_venue.owner_user_id is distinct from v_owner then raise exception 'VENUE_PUBLICATION_OWNER_CHANGED' using errcode='40001';end if;
  if p_action in('admin_edit','admin_publish') then
    if v_actor.role<>'admin' then raise exception 'VENUE_PUBLICATION_ADMIN_REQUIRED' using errcode='42501';end if;
    if p_action='admin_edit' then
      if p_changes->'is_active'is distinct from 'false'::jsonb
        or exists(select 1 from jsonb_object_keys(p_changes)k where k<>all(array[
          'name','slug','city','state','address','latitude','longitude','phone','website','timezone','opens_at','closes_at',
          'is_active','page_review_status','page_review_sent_at','page_reviewed_at','page_reviewed_by_user_id','page_review_notes'])) then
        raise exception 'VENUE_PUBLICATION_INVALID_ADMIN_EDIT' using errcode='22023';
      end if;
      v_changes:=p_changes;
    else
      if p_changes<>'{}'::jsonb or v_venue.page_review_status<>'venue_approved' or v_owner is null then
        raise exception 'VENUE_PUBLICATION_REVIEW_CHANGED' using errcode='40001';
      end if;
      v_changes:=jsonb_build_object('is_active',true,'published_at',v_now,'page_review_status','published','page_review_notes',null);
    end if;
  else
    if v_actor.role<>'venue' or v_owner is null or not exists(select 1 from public.app_users where id=v_owner and account_state='active'and dmca_suspended_at is null) then
      raise exception 'VENUE_PUBLICATION_OWNER_REQUIRED' using errcode='42501';
    end if;
    if p_actor_user_id<>v_owner then
      perform id from public.venue_team_members where venue_id=p_venue_id and user_id=p_actor_user_id and role='manager'and status='active'for share;
      if not found then raise exception 'VENUE_PUBLICATION_MANAGER_REQUIRED' using errcode='42501';end if;
    end if;
    if v_venue.page_review_status<>'venue_review' then raise exception 'VENUE_PUBLICATION_REVIEW_CHANGED' using errcode='40001';end if;
    if exists(select 1 from jsonb_object_keys(p_changes)k where k<>'notes')or(p_changes?'notes'and jsonb_typeof(p_changes->'notes')<>'string')then
      raise exception 'VENUE_PUBLICATION_INVALID_REVIEW' using errcode='22023';
    end if;
    v_notes:=btrim(coalesce(p_changes->>'notes',''));
    if p_action='owner_request_changes'and length(v_notes)<10 then raise exception 'VENUE_PUBLICATION_NOTES_REQUIRED' using errcode='22023';end if;
    v_changes:=jsonb_build_object('is_active',p_action='owner_approve',
      'published_at',case when p_action='owner_approve'then v_now else null end,
      'page_review_status',case when p_action='owner_approve'then 'published'else 'changes_requested'end,
      'page_reviewed_at',v_now,'page_reviewed_by_user_id',p_actor_user_id,
      'page_review_notes',case when p_action='owner_approve'then null else v_notes end);
  end if;
  v_expected:=to_jsonb(jsonb_populate_record(v_venue,v_changes));
  select string_agg(format('%I',k),','order by k)into v_columns from jsonb_object_keys(v_changes)k;
  execute format('update public.venues as v set (%s)=(select %s from jsonb_populate_record(null::public.venues,$1))where id=$2 returning to_jsonb(v)',v_columns,v_columns)
    into v_result using v_changes,p_venue_id;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception 'VENUE_PUBLICATION_WRITE_MISMATCH' using errcode='40001';end if;
  select to_jsonb(v)into v_result from public.venues v where id=p_venue_id;
  if not found or exists(select 1 from jsonb_object_keys(v_changes)k where v_result->k is distinct from v_expected->k)then
    raise exception 'VENUE_PUBLICATION_WRITE_MISMATCH' using errcode='40001';
  end if;
  return v_result;
end;
$function$;
revoke all on function public.change_venue_publication_safely(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.change_venue_publication_safely(uuid,uuid,text,jsonb) to service_role;
commit;
