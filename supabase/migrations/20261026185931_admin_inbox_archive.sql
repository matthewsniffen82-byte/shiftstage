begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Inbox visibility is separate from approval, publication and support status.
alter table public.support_threads add column admin_archived_at timestamptz, add column admin_archive_summary jsonb;
alter table public.venue_club_deal_requests add column admin_archived_at timestamptz, add column admin_archive_summary jsonb;
alter table public.venue_signup_requests add column admin_archived_at timestamptz, add column admin_archive_summary jsonb;
alter table public.venues add column admin_archived_at timestamptz, add column admin_archive_summary jsonb;

create index support_threads_admin_archive_idx on public.support_threads(admin_archived_at desc,id) where admin_archived_at is not null;
create index venue_deal_requests_admin_archive_idx on public.venue_club_deal_requests(admin_archived_at desc,id) where admin_archived_at is not null;
create index venue_signup_requests_admin_archive_idx on public.venue_signup_requests(admin_archived_at desc,id) where admin_archived_at is not null;
create index venues_admin_archive_idx on public.venues(admin_archived_at desc,id) where admin_archived_at is not null;

-- Customers and club managers must not hide records from staff through ordinary updates.
create or replace function private.guard_admin_inbox_archive()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    if tg_op='INSERT' then
      if new.admin_archived_at is not null or new.admin_archive_summary is not null then
        raise exception using errcode='42501',message='Only staff can archive inbox items.';
      end if;
    elsif (new.admin_archived_at,new.admin_archive_summary) is distinct from (old.admin_archived_at,old.admin_archive_summary) then
      raise exception using errcode='42501',message='Only staff can archive inbox items.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_admin_inbox_archive() from public,anon,authenticated;
create trigger a_guard_admin_inbox_archive before insert or update on public.support_threads for each row execute function private.guard_admin_inbox_archive();
create trigger a_guard_admin_inbox_archive before insert or update on public.venue_club_deal_requests for each row execute function private.guard_admin_inbox_archive();
create trigger a_guard_admin_inbox_archive before insert or update on public.venue_signup_requests for each row execute function private.guard_admin_inbox_archive();
create trigger a_guard_admin_inbox_archive before insert or update on public.venues for each row execute function private.guard_admin_inbox_archive();

create or replace function private.reopen_admin_inbox_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare n jsonb := to_jsonb(new); o jsonb := to_jsonb(old); reopen boolean := false;
begin
  if old.admin_archived_at is null then return new; end if;
  if tg_table_name = 'support_threads' then
    reopen := new.status = 'open' and new.last_message_at is distinct from old.last_message_at;
  elsif tg_table_name = 'venues' then
    reopen := new.page_review_status = 'changes_requested' and
      (new.page_review_status,new.page_review_notes,new.page_reviewed_at) is distinct from
      (old.page_review_status,old.page_review_notes,old.page_reviewed_at);
  else
    reopen := n->>'status' in ('pending','under_review') and
      (n - array['updated_at','admin_archived_at','admin_archive_summary']) is distinct from
      (o - array['updated_at','admin_archived_at','admin_archive_summary']);
  end if;
  if reopen then new.admin_archived_at := null; new.admin_archive_summary := null; end if;
  return new;
end;
$$;
revoke all on function private.reopen_admin_inbox_item() from public,anon,authenticated;
create trigger support_reopen_admin_inbox before update on public.support_threads for each row execute function private.reopen_admin_inbox_item();
create trigger deal_reopen_admin_inbox before update on public.venue_club_deal_requests for each row execute function private.reopen_admin_inbox_item();
create trigger signup_reopen_admin_inbox before update on public.venue_signup_requests for each row execute function private.reopen_admin_inbox_item();
create trigger page_reopen_admin_inbox before update on public.venues for each row execute function private.reopen_admin_inbox_item();

create view public.admin_inbox_archive with (security_invoker = true) as
select 'support'::text kind,id,admin_archived_at archived_at,admin_archive_summary summary from public.support_threads where admin_archived_at is not null
union all select 'deal_request',id,admin_archived_at,admin_archive_summary from public.venue_club_deal_requests where admin_archived_at is not null
union all select 'club_application',id,admin_archived_at,admin_archive_summary from public.venue_signup_requests where admin_archived_at is not null
union all select 'page_change',id,admin_archived_at,admin_archive_summary from public.venues where admin_archived_at is not null;
revoke all on public.admin_inbox_archive from public,anon,authenticated;
grant select on public.admin_inbox_archive to service_role;

create or replace function public.set_admin_inbox_archive(p_admin_id uuid,p_action text,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor_role text; item jsonb; kind text; target uuid; table_name text; row_data jsonb;
  revision timestamptz; expected timestamptz; archived timestamptz; summary jsonb;
  club_name text; message_text text; changed integer := 0;
begin
  select a.admin_workspace_role into actor_role from public.app_users a
    where a.id=p_admin_id and a.role='admin' and a.account_state='active';
  if actor_role is null or actor_role not in ('owner','support') then
    raise exception using errcode='42501',message='Admin access required.';
  end if;
  if p_action is null or p_action not in ('archive','restore') or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception using errcode='22023',message='Choose between 1 and 100 inbox items.';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <> (select count(distinct (e->>'kind',e->>'id')) from jsonb_array_elements(p_items) e) then
    raise exception using errcode='22023',message='Choose each inbox item only once.';
  end if;
  -- Stable lock ordering makes a selected batch atomic without archiving unseen new work.
  for item in select e from jsonb_array_elements(p_items) e order by e->>'kind',e->>'id' loop
    kind := item->>'kind'; target := (item->>'id')::uuid; expected := (item->>'version')::timestamptz;
    if target is null or expected is null or kind is null or kind not in ('support','deal_request','club_application','page_change') then
      raise exception using errcode='22023',message='Invalid inbox item.';
    end if;
    if actor_role <> 'owner' and kind <> 'support' then
      raise exception using errcode='42501',message='Your staff role does not allow this action.';
    end if;
    table_name := case kind when 'support' then 'support_threads' when 'deal_request' then 'venue_club_deal_requests'
      when 'club_application' then 'venue_signup_requests' else 'venues' end;
    execute format('select to_jsonb(t) from public.%I t where id=$1 for update',table_name) into row_data using target;
    if row_data is null then raise exception using errcode='P0002',message='Inbox item no longer exists.'; end if;
    archived := (row_data->>'admin_archived_at')::timestamptz;
    if p_action='restore' then
      if archived is null then continue; end if;
      if archived is distinct from expected then raise exception using errcode='40001',message='The archive changed. Refresh and try again.'; end if;
      execute format('update public.%I set admin_archived_at=null,admin_archive_summary=null where id=$1',table_name) using target;
    else
      if archived is not null then continue; end if;
      revision := case kind when 'support' then (row_data->>'last_message_at')::timestamptz
        when 'page_change' then coalesce((row_data->>'page_reviewed_at')::timestamptz,(row_data->>'updated_at')::timestamptz)
        else (row_data->>'updated_at')::timestamptz end;
      if revision is distinct from expected then raise exception using errcode='40001',message='This item has new activity. Refresh before archiving it.'; end if;
      if (kind='deal_request' and row_data->>'status' not in ('pending','under_review'))
        or (kind='club_application' and row_data->>'status'<>'pending')
        or (kind='page_change' and row_data->>'page_review_status'<>'changes_requested') then
        raise exception using errcode='40001',message='This request has already been handled. Refresh the inbox.';
      end if;
      club_name := null; message_text := null;
      if kind='deal_request' then select v.name into club_name from public.venues v where v.id=(row_data->>'venue_id')::uuid; end if;
      if kind='support' then select m.body into message_text from public.support_messages m where m.thread_id=target order by m.created_at desc,m.id desc limit 1; end if;
      summary := jsonb_build_object(
        'title',case kind when 'support' then row_data->>'subject' when 'deal_request' then concat(club_name,' · ',row_data->>'offer_title')
          when 'club_application' then row_data->>'venue_name' else row_data->>'name' end,
        'detail',case kind when 'support' then message_text when 'deal_request' then row_data->>'request_notes'
          when 'club_application' then row_data->>'message' else row_data->>'page_review_notes' end,
        'status',coalesce(row_data->>'status',row_data->>'page_review_status'),
        'sourceDate',coalesce(row_data->>'created_at',row_data->>'submitted_at',row_data->>'page_reviewed_at'));
      execute format('update public.%I set admin_archived_at=clock_timestamp(),admin_archive_summary=$2 where id=$1',table_name) using target,summary;
    end if;
    insert into public.admin_actions(admin_id,target_type,target_id,action,notes)
      values(p_admin_id,kind,target,'inbox.'||p_action,'Inbox visibility changed; the original record and its decision status are retained.');
    changed := changed+1;
  end loop;
  return jsonb_build_object('changed',changed);
end;
$$;
revoke all on function public.set_admin_inbox_archive(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.set_admin_inbox_archive(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
