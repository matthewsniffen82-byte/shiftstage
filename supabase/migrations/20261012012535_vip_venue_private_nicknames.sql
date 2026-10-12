begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Retain existing labels but retire guest writes, including from older servers.
create or replace function public.vip_update_own_nickname(p_actor uuid,p_venue uuid,p_nickname text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'VENUE_RECORDS_PRIVATE' using errcode='42501';
end;
$$;
revoke all on function public.vip_update_own_nickname(uuid,uuid,text) from public,anon,authenticated,service_role;

comment on column public.venue_vip_members.nickname is 'Private venue label. Never return to the VIP or dancers; only venue owners and managers may edit.';
comment on column public.venue_vip_invitations.nickname is 'Private venue label for a new membership. Excluded from guest invitation responses and emails.';

notify pgrst,'reload schema';
commit;
