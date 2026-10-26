-- Allow administrators to prepare physical stickers before a club is published.
-- Public NFC resolution and dancer/cashier tap permissions still require a live club.
-- Keep existing capacity enforcement, token digests, audit history and admin permissions.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.provision_admin_venue_nfc_tag(
  p_tag_id uuid,
  p_venue_id uuid,
  p_admin_user_id uuid,
  p_tag_type text,
  p_label text,
  p_token_digest text
)
returns public.nfc_tags
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tag public.nfc_tags;
  v_venue public.venues;
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_user_id and account.role = 'admin' and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;
  if p_tag_type not in ('dressing_room', 'cashier') then
    raise exception using errcode = '22023', message = 'Choose a dressing-room or cashier NFC sticker.';
  end if;
  if char_length(trim(p_label)) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'NFC sticker label must be 2 to 80 characters.';
  end if;
  if p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid NFC sticker secret.';
  end if;

  select venue.* into v_venue
  from public.venues venue
  where venue.id = p_venue_id
  for key share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Venue not found.';
  end if;
  if (select count(*) from public.nfc_tags tag where tag.venue_id = p_venue_id and tag.status = 'active') >= 25 then
    raise exception using errcode = '54000', message = 'This venue already has the maximum of 25 active NFC stickers.';
  end if;

  insert into public.nfc_tags (
    id, venue_id, tag_type, label, token_digest, status, created_by_user_id
  ) values (
    p_tag_id, p_venue_id, p_tag_type, trim(p_label), p_token_digest, 'active', p_admin_user_id
  ) returning * into v_tag;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (p_admin_user_id, 'nfc_tag', v_tag.id, 'provision_nfc_sticker', v_venue.name || ' · ' || p_tag_type || ' · ' || trim(p_label));

  return v_tag;
end;
$$;

create or replace function public.rotate_admin_venue_nfc_tag(
  p_tag_id uuid,
  p_admin_user_id uuid,
  p_replacement_id uuid,
  p_token_digest text
)
returns public.nfc_tags
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.nfc_tags;
  v_replacement public.nfc_tags;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1
    from public.app_users account
    where account.id = p_admin_user_id
      and account.role = 'admin'
      and account.account_state = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;
  if p_token_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid NFC sticker secret.';
  end if;

  select tag.* into v_current
  from public.nfc_tags tag
  join public.venues venue on venue.id = tag.venue_id
  where tag.id = p_tag_id
    and tag.status <> 'revoked'
  for update of tag;
  if not found then
    raise exception using errcode = 'P0002', message = 'NFC sticker not found.';
  end if;

  update public.nfc_tags
  set status = 'revoked', revoked_at = v_now, updated_at = v_now
  where id = v_current.id;

  insert into public.nfc_tags (
    id, venue_id, tag_type, label, token_digest, status,
    created_by_user_id, rotated_from_tag_id
  ) values (
    p_replacement_id, v_current.venue_id, v_current.tag_type, v_current.label,
    p_token_digest, 'active', p_admin_user_id, v_current.id
  ) returning * into v_replacement;

  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (p_admin_user_id, 'nfc_tag', v_replacement.id, 'rotate_nfc_sticker', 'Replaced ' || v_current.id::text);

  return v_replacement;
end;
$$;


revoke all on function public.provision_admin_venue_nfc_tag(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.provision_admin_venue_nfc_tag(uuid, uuid, uuid, text, text, text) to service_role;
revoke all on function public.rotate_admin_venue_nfc_tag(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rotate_admin_venue_nfc_tag(uuid, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
