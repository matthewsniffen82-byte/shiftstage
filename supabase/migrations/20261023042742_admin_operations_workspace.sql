-- Staff scopes are enforced both at API and database boundaries.
alter table public.app_users add column admin_workspace_role text not null default 'owner'
  check (admin_workspace_role in ('owner','reviewer','support','billing'));
grant update(admin_workspace_role) on public.app_users to service_role;
create schema if not exists private;
create or replace function private.restricted_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.app_users where id = auth.uid() and role = 'admin'
    and admin_workspace_role <> 'owner');
$$;
revoke all on function private.restricted_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.restricted_admin() to authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.app_users where id = auth.uid() and role = 'admin'
    and account_state = 'active' and admin_workspace_role = 'owner');
$$;
create or replace function public.pickup_actor_role() returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select role::text from public.app_users where id=auth.uid() and account_state='active'
    and role::text in ('customer','venue','admin') and (role <> 'admin' or admin_workspace_role='owner');
$$;

-- Scoped staff use server-authorized endpoints, not legacy all-admin RLS grants.
do $$ declare t record; begin
  for t in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and c.relrowsecurity and (n.nspname='public' or (n.nspname='storage' and c.relname='objects'))
  loop
    if t.relname='app_users' then
      execute 'create policy admin_scope_read on public.app_users as restrictive for select to authenticated using (not (select private.restricted_admin()) or id=(select auth.uid()))';
      execute 'create policy admin_scope_insert on public.app_users as restrictive for insert to authenticated with check (not (select private.restricted_admin()))';
      execute 'create policy admin_scope_update on public.app_users as restrictive for update to authenticated using (not (select private.restricted_admin())) with check (not (select private.restricted_admin()))';
      execute 'create policy admin_scope_delete on public.app_users as restrictive for delete to authenticated using (not (select private.restricted_admin()))';
    else
      execute format('create policy admin_workspace_scope on %I.%I as restrictive for all to authenticated using (not (select private.restricted_admin())) with check (not (select private.restricted_admin()))', t.nspname,t.relname);
    end if;
  end loop;
end $$;

create or replace function public.guard_admin_workspace_role() returns trigger language plpgsql
set search_path=pg_catalog,public as $$ begin
  if current_user not in ('postgres','service_role','supabase_admin') and
    ((TG_OP='INSERT' and new.admin_workspace_role <> 'owner') or
     (TG_OP='UPDATE' and new.admin_workspace_role is distinct from old.admin_workspace_role)) then
    raise exception 'Staff permissions require an owner-authorized server action.' using errcode='42501';
  end if;
  return new;
end $$;
create trigger guard_admin_workspace_role before insert or update on public.app_users
for each row execute function public.guard_admin_workspace_role();

create or replace function public.assert_admin_workspace_access(p_actor uuid,p_scope text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
  if not exists(select 1 from public.app_users where id=p_actor and role='admin' and account_state='active'
    and (admin_workspace_role='owner' or admin_workspace_role=p_scope)) then
    raise exception 'Staff permission required.' using errcode='42501';
  end if;
end $$;
revoke all on function public.assert_admin_workspace_access(uuid,text) from public,anon,authenticated;
grant execute on function public.assert_admin_workspace_access(uuid,text) to service_role;

create table public.admin_review_claims (
  kind text not null check(kind in ('photo','video')), item_id uuid not null,
  reviewer_id uuid not null references public.app_users(id) on delete cascade, version timestamptz not null,
  expires_at timestamptz not null, primary key(kind,item_id)
);
create index admin_review_claims_reviewer on public.admin_review_claims(reviewer_id);
alter table public.admin_review_claims enable row level security;
revoke all on public.admin_review_claims from anon,authenticated;
grant all on public.admin_review_claims to service_role;

create table public.admin_media_review_events (
  id bigint generated always as identity primary key,
  kind text not null, item_id uuid not null, stage text not null,
  decision text not null, actor_id uuid references public.app_users(id) on delete set null, actor_label text,
  notes text, created_at timestamptz not null default now(), version timestamptz
);
create index admin_media_review_events_item on public.admin_media_review_events(kind,item_id,created_at);
create index admin_media_review_events_actor on public.admin_media_review_events(actor_id);
alter table public.admin_media_review_events enable row level security;
revoke all on public.admin_media_review_events from anon,authenticated;
grant select,insert on public.admin_media_review_events to service_role;
grant usage,select on sequence public.admin_media_review_events_id_seq to service_role;

create or replace view public.admin_media_workspace with (security_invoker=true) as
with media as (
  select 'photo'::text kind, i.id, i.user_id, d.id dancer_id, d.stage_name,
    i.created_at, i.updated_at, i.club_reviewed_at, i.club_reviewed_by, i.club_review_notes,
    i.club_review_venue_id, case when i.venue_media_context->>'venueId' ~* '^[0-9a-f-]{36}$' then (i.venue_media_context->>'venueId')::uuid end source_venue_id, ''::text caption,
    i.reviewed_by, i.reviewed_at, i.review_notes,
    case when i.decision in ('approved','rejected') then 'history'
      when i.decision='review' and (i.upload_context not like 'profile_%' or i.club_reviewed_at is not null) then 'staff'
      when i.decision='review' and i.category_flags->>'file_checks_passed'='true' then 'club'
      else 'processing' end stage,
    i.decision decision, i.upload_context, i.temporary_storage_path, i.final_storage_path, null::text storage_path, i.status
  from public.image_moderation_records i left join public.dancer_profiles d on d.user_id=i.user_id
  union all
  select 'video',v.id,v.submitted_by,v.dancer_id,d.stage_name,v.created_at,v.updated_at,
    v.club_reviewed_at,v.club_reviewed_by,v.club_review_notes,v.club_review_venue_id,v.venue_id,v.caption,
    v.reviewed_by,v.reviewed_at,v.review_notes,
    case when v.status in ('approved','rejected','expired') then 'history'
      when v.status='submitted' and not v.upload_validation_pending and v.moderation_details->>'fileChecksPassed'='true'
        then case when v.club_reviewed_at is null then 'club' else 'staff' end else 'processing' end,
    v.status,null,null,null,v.storage_path,v.status
  from public.mydancr_tv_videos v left join public.dancer_profiles d on d.id=v.dancer_id
)
select m.*, m.kind||':'||m.id::text queue_key, coalesce(m.stage_name,u.display_name,'Media upload') dancer_name,
  v.id venue_id,v.name venue_name,
  coalesce(cr.display_name,cr.email) club_reviewer_name,
  coalesce(sr.display_name,sr.email) staff_reviewer_name,
  c.reviewer_id claimed_by,c.expires_at claim_expires_at,coalesce(cu.display_name,cu.email) claimed_by_name
from media m
left join public.app_users u on u.id=m.user_id
left join lateral (
  select a.venue_id from public.venue_dancer_affiliations a where a.dancer_id=m.dancer_id and a.status='active'
  order by a.updated_at desc,a.id limit 1
) a on true
left join lateral (
  select e.venue_id from public.dancer_nfc_enrollments e where e.dancer_user_id=m.user_id and e.status='pending'
  order by e.created_at desc,e.id limit 1
) e on true
left join public.venues v on v.id=coalesce(m.club_review_venue_id,m.source_venue_id,a.venue_id,e.venue_id)
left join public.app_users cr on cr.id=m.club_reviewed_by
left join public.app_users sr on sr.id=m.reviewed_by
left join public.admin_review_claims c on c.kind=m.kind and c.item_id=m.id and c.expires_at>now()
left join public.app_users cu on cu.id=c.reviewer_id;
revoke all on public.admin_media_workspace from anon,authenticated;
grant select on public.admin_media_workspace to service_role;

create or replace function public.claim_admin_media(p_actor uuid,p_kind text,p_id uuid,p_version timestamptz,p_release boolean default false)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare result public.admin_review_claims; begin
  perform public.assert_admin_workspace_access(p_actor,'reviewer');
  if p_release then
    delete from public.admin_review_claims where kind=p_kind and item_id=p_id and reviewer_id=p_actor;
    return jsonb_build_object('released',true);
  end if;
  if not exists(select 1 from public.admin_media_workspace where kind=p_kind and id=p_id and updated_at=p_version and stage='staff') then
    raise exception 'This upload changed or is not ready for MyDancr review.' using errcode='40001';
  end if;
  insert into public.admin_review_claims(kind,item_id,reviewer_id,version,expires_at)
    values(p_kind,p_id,p_actor,p_version,now()+interval '10 minutes')
  on conflict(kind,item_id) do update set reviewer_id=excluded.reviewer_id,version=excluded.version,expires_at=excluded.expires_at
    where admin_review_claims.expires_at<=now() or admin_review_claims.reviewer_id=p_actor
  returning * into result;
  if result.item_id is null then raise exception 'Another reviewer is working on this upload.' using errcode='40001'; end if;
  return to_jsonb(result);
end $$;
revoke all on function public.claim_admin_media(uuid,text,uuid,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.claim_admin_media(uuid,text,uuid,timestamptz,boolean) to service_role;

create or replace function public.audit_admin_media_review() returns trigger language plpgsql
set search_path=pg_catalog,public as $$
declare n jsonb:=to_jsonb(new); o jsonb:=to_jsonb(old); k text; changed boolean; actor uuid; claim public.admin_review_claims;
begin
  k:=case when TG_TABLE_NAME='image_moderation_records' then 'photo' else 'video' end;
  changed:=n->>'reviewed_by' is not null and (
    n->>'reviewed_at' is distinct from o->>'reviewed_at' or
    (n->>'decision' in ('approved','rejected') and n->>'decision' is distinct from o->>'decision') or
    (k='video' and n->>'status' in ('approved','rejected') and n->>'status' is distinct from o->>'status'));
  actor:=(n->>'reviewed_by')::uuid;
  if changed and exists(select 1 from public.app_users where id=actor and role='admin') then
    perform public.assert_admin_workspace_access(actor,'reviewer');
    select * into claim from public.admin_review_claims where kind=k and item_id=new.id for update;
    if claim.reviewer_id is distinct from actor or claim.expires_at<=now() or claim.version is distinct from old.updated_at then
      raise exception 'Claim the current upload before saving a decision.' using errcode='40001';
    end if;
  end if;
  if n->>'club_reviewed_at' is distinct from o->>'club_reviewed_at' and n->>'club_reviewed_at' is not null then
    insert into public.admin_media_review_events(kind,item_id,stage,decision,actor_id,actor_label,notes,version)
    values(k,new.id,'club','approved',(n->>'club_reviewed_by')::uuid,
      (select coalesce(display_name,email) from public.app_users where id=(n->>'club_reviewed_by')::uuid),n->>'club_review_notes',new.updated_at);
  end if;
  if changed then
    insert into public.admin_media_review_events(kind,item_id,stage,decision,actor_id,actor_label,notes,version)
    values(k,new.id,case when exists(select 1 from public.app_users where id=actor and role='admin') then 'mydancr' else 'club' end,
      coalesce(n->>'review_decision',n->>'status'),actor,
      (select coalesce(display_name,email) from public.app_users where id=actor),n->>'review_notes',new.updated_at);
    delete from public.admin_review_claims where kind=k and item_id=new.id;
  end if;
  return new;
end $$;
create trigger audit_admin_media_review after update on public.image_moderation_records
for each row execute function public.audit_admin_media_review();
create trigger audit_admin_media_review after update on public.mydancr_tv_videos
for each row execute function public.audit_admin_media_review();

-- Preserve the decisions already recorded before this release.
insert into public.admin_media_review_events(kind,item_id,stage,decision,actor_id,actor_label,notes,created_at,version)
select kind,id,'club','approved',club_reviewed_by,club_reviewer_name,club_review_notes,club_reviewed_at,updated_at
from public.admin_media_workspace where club_reviewed_at is not null;
insert into public.admin_media_review_events(kind,item_id,stage,decision,actor_id,actor_label,notes,created_at,version)
select kind,m.id,case when a.role='admin' then 'mydancr' else 'club' end,case when m.decision='expired' then 'approved' else m.decision end,reviewed_by,coalesce(a.display_name,a.email),review_notes,reviewed_at,m.updated_at
from public.admin_media_workspace m left join public.app_users a on a.id=m.reviewed_by where reviewed_at is not null;

create or replace function public.set_admin_workspace_role(p_actor uuid,p_target uuid,p_role text)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
  -- Serialize permission changes, including concurrent changes to the last owner.
  perform pg_advisory_xact_lock(208234,1);
  perform public.assert_admin_workspace_access(p_actor,'owner');
  if p_role not in ('owner','reviewer','support','billing') or p_actor=p_target then
    raise exception 'Choose another staff account and a valid role.' using errcode='22023';
  end if;
  update public.app_users set admin_workspace_role=p_role where id=p_target and role='admin' and account_state='active';
  if not found then raise exception 'Active staff account not found.'; end if;
  insert into public.admin_actions(admin_id,action,target_type,target_id,notes)
  values(p_actor,'staff_permissions_changed','user',p_target,'Workspace role: '||p_role);
end $$;
revoke all on function public.set_admin_workspace_role(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_admin_workspace_role(uuid,uuid,text) to service_role;
