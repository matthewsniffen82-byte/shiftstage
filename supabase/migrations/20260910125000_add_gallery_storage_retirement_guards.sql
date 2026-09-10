-- Additive retirement coordination only. No storage or business rows are deleted.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.gallery_storage_retirements (
  storage_path text primary key check (storage_path <> ''),
  retirement_id uuid not null unique default gen_random_uuid(),
  profile_id uuid not null,
  retired_at timestamptz not null default clock_timestamp()
);
alter table public.gallery_storage_retirements enable row level security;
revoke all on public.gallery_storage_retirements from public,anon,authenticated,service_role;
grant select on public.gallery_storage_retirements to service_role;

create function public.gallery_storage_family(p_storage_path text)
returns text language sql immutable strict set search_path = ''
as $function$
  select pg_catalog.regexp_replace(p_storage_path, '[.]w[1-9][0-9]*[.]webp$', '');
$function$;
revoke all on function public.gallery_storage_family(text) from public,anon,authenticated,service_role;

create function public.guard_gallery_storage_reference()
returns trigger language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_path text;
  v_old_path text;
  v_family text;
begin
  if tg_level <> 'ROW' or tg_when <> 'AFTER' or tg_op not in ('INSERT','UPDATE') then
    raise exception 'GALLERY_RETIREMENT_INVALID_TRIGGER' using errcode='42501';
  end if;
  if tg_relid = 'public.dancer_photos'::regclass then
    v_path := new.storage_path;
    if tg_op = 'UPDATE' then v_old_path := old.storage_path; end if;
  elsif tg_relid = 'public.dancer_profiles'::regclass then
    v_path := new.avatar_storage_path;
    if tg_op = 'UPDATE' then v_old_path := old.avatar_storage_path; end if;
  elsif tg_relid = 'public.image_moderation_records'::regclass then
    v_path := new.final_storage_path;
    if tg_op = 'UPDATE' then v_old_path := old.final_storage_path; end if;
  else
    raise exception 'GALLERY_RETIREMENT_INVALID_SOURCE' using errcode='42501';
  end if;
  if v_path is null or v_path = '' or (tg_op = 'UPDATE' and v_path is not distinct from v_old_path) then
    return null;
  end if;
  -- A repeatable snapshot cannot establish the absence of a committed marker.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'GALLERY_REFERENCE_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  v_family := public.gallery_storage_family(v_path);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mydancr:gallery-retirement:' || v_family,0));
  -- Keep this a separate VOLATILE query after the lock to refresh visibility.
  if exists(select 1 from public.gallery_storage_retirements where storage_path=v_family) then
    raise exception 'GALLERY_STORAGE_RETIRED' using errcode='23514';
  end if;
  return null;
end;
$function$;
revoke all on function public.guard_gallery_storage_reference() from public,anon,authenticated,service_role;

create function public.claim_gallery_storage_retirement(p_profile_id uuid,p_storage_path text)
returns jsonb language plpgsql volatile security definer set search_path = '' set timezone = 'UTC'
as $function$
declare
  v_retirement public.gallery_storage_retirements%rowtype;
begin
  if p_profile_id is null or p_storage_path is null then
    raise exception 'GALLERY_RETIREMENT_INPUT_REQUIRED' using errcode='22023';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'GALLERY_RETIREMENT_REQUIRES_READ_COMMITTED' using errcode='0A000';
  end if;
  -- Only a canonical master in the previously published profile directory can
  -- retire. Unrecognized/variant/external paths remain available for recovery.
  if p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]*[.](jpg|jpeg|png|webp)$'
    or position('..' in p_storage_path)>0
    or split_part(p_storage_path,'/',2)<>p_profile_id::text
    or public.gallery_storage_family(p_storage_path)<>p_storage_path then
    return jsonb_build_object('status','retained','reason','unrecognized_path','storage_path',p_storage_path,'profile_id',p_profile_id);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mydancr:gallery-retirement:' || p_storage_path,0));
  if not exists(select 1 from public.gallery_media_reference_history
    where profile_id=p_profile_id and public.gallery_storage_family(storage_path)=p_storage_path) then
    return jsonb_build_object('status','retained','reason','no_reference_history','storage_path',p_storage_path,'profile_id',p_profile_id);
  end if;
  if exists(select 1 from public.dancer_photos where public.gallery_storage_family(storage_path)=p_storage_path)
    or exists(select 1 from public.dancer_profiles where public.gallery_storage_family(avatar_storage_path)=p_storage_path)
    or exists(select 1 from public.image_moderation_records where public.gallery_storage_family(final_storage_path)=p_storage_path) then
    return jsonb_build_object('status','retained','reason','referenced','storage_path',p_storage_path,'profile_id',p_profile_id);
  end if;
  select * into v_retirement from public.gallery_storage_retirements where storage_path=p_storage_path;
  if not found then
    insert into public.gallery_storage_retirements(storage_path,profile_id)
      values(p_storage_path,p_profile_id) returning * into v_retirement;
  end if;
  return jsonb_build_object('status','retired','storage_path',v_retirement.storage_path,
    'profile_id',v_retirement.profile_id,'retirement_id',v_retirement.retirement_id,'retired_at',v_retirement.retired_at);
end;
$function$;
revoke all on function public.claim_gallery_storage_retirement(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_gallery_storage_retirement(uuid,text) to service_role;

lock table public.dancer_profiles,public.dancer_photos,public.image_moderation_records in share row exclusive mode;
create trigger dancer_photos_guard_storage_reference
  after insert or update on public.dancer_photos
  for each row execute function public.guard_gallery_storage_reference();
create trigger dancer_profiles_guard_storage_reference
  after insert or update on public.dancer_profiles
  for each row execute function public.guard_gallery_storage_reference();
create trigger image_moderation_guard_storage_reference
  after insert or update on public.image_moderation_records
  for each row execute function public.guard_gallery_storage_reference();

comment on table public.gallery_storage_retirements is
  'Private permanent gallery-master retirement receipts. Never remove a marker after storage cleanup: new gallery/avatar/moderation references must remain blocked. Source history and rows are preserved; no physical files are deleted by this table or its RPC.';
comment on function public.claim_gallery_storage_retirement(uuid,text) is
  'Service-only Read-Committed retirement claim. Requires canonical profile path and durable reference history; serializes with reference guards and retains any master/variant still referenced by gallery, avatar or moderation metadata. Callers must acknowledge a matching committed receipt before storage deletion.';
comment on function public.guard_gallery_storage_reference() is
  'Restricted AFTER ROW gallery/avatar/moderation guard. New nonempty references require Read Committed and serialize with retirement of the master or stored responsive variant. Unchanged/cleared references return without locking.';
commit;
