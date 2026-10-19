begin;

-- Only the authenticated Admin API may provision table capabilities. Keep
-- revocation and request cancellation in the same transaction as the link lock.
create function public.admin_manage_table_qr(p_actor uuid, p_venue uuid, p_action text, p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  link public.internal_roster_links;
  v_link_id uuid := (p_data->>'id')::uuid;
  label_value text := trim(p_data->>'label');
begin
  if not exists(select 1 from public.app_users where id=p_actor and role='admin' and account_state='active') then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('create','rename','disable') or v_link_id is null then
    raise exception 'INVALID_TABLE_QR' using errcode='22023';
  end if;
  if p_action in ('create','rename') and (label_value is null or length(label_value) not between 1 and 60 or label_value ~ '[[:cntrl:]]') then
    raise exception 'INVALID_TABLE_LABEL' using errcode='22023';
  end if;
  -- Serialize provisioning per venue, including same-label submissions.
  perform 1 from public.venues where id=p_venue for update;
  if not found then raise exception 'VENUE_NOT_FOUND' using errcode='P0002'; end if;
  select * into link from public.internal_roster_links where id=v_link_id for update;
  if found and (link.venue_id<>p_venue or link.kind<>'table') then
    raise exception 'TABLE_QR_NOT_FOUND' using errcode='P0002';
  end if;
  if p_action='create' and link.id is not null then
    if link.label<>label_value or not link.active then
      raise exception 'TABLE_QR_CHANGED' using errcode='40001';
    end if;
    return to_jsonb(link);
  end if;
  if p_action<>'create' and link.id is null then
    raise exception 'TABLE_QR_NOT_FOUND' using errcode='P0002';
  end if;
  if p_action='rename' and not link.active then
    raise exception 'TABLE_QR_CHANGED' using errcode='40001';
  end if;
  if p_action in ('create','rename') and exists(
    select 1 from public.internal_roster_links where venue_id=p_venue and kind='table' and active
      and lower(trim(label))=lower(label_value) and id<>v_link_id
  ) then raise exception 'TABLE_LABEL_EXISTS' using errcode='23505'; end if;

  if p_action='create' then
    insert into public.internal_roster_links(id,venue_id,kind,label)
      values(v_link_id,p_venue,'table',label_value) returning * into link;
  elsif p_action='rename' then
    if link.label is distinct from label_value then
      if link.updated_at is distinct from (p_data->>'expectedUpdatedAt')::timestamptz then
        raise exception 'TABLE_QR_CHANGED' using errcode='40001';
      end if;
      update public.internal_roster_links set label=label_value,updated_at=clock_timestamp()
        where id=v_link_id and venue_id=p_venue returning * into link;
    end if;
  elsif link.active then
    update public.internal_roster_links set active=false,token=gen_random_uuid(),updated_at=clock_timestamp()
      where id=v_link_id and venue_id=p_venue returning * into link;
    update public.internal_roster_requests set status='cancelled',updated_at=clock_timestamp()
      where link_id=link.id and venue_id=p_venue and status in ('pending','acknowledged');
  end if;
  return to_jsonb(link);
end;
$$;

revoke all on function public.admin_manage_table_qr(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_manage_table_qr(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
