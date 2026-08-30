begin;

-- A venue can have more than one cashier sticker. Lock the deal and stable
-- customer/session identity before issuance so simultaneous taps through two
-- different tags cannot both pass the 24-hour duplicate check.
create or replace function public.issue_and_confirm_deal_redemption_from_nfc(
  p_redemption_token text,
  p_tag_id uuid,
  p_session_id uuid,
  p_venue_id uuid,
  p_club_deal_id uuid,
  p_source_type text,
  p_dancer_id uuid,
  p_shift_id uuid,
  p_customer_id uuid,
  p_expires_at timestamptz,
  p_audit jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_confirmation jsonb;
begin
  if p_redemption_token !~ '^[A-Za-z0-9_-]{40,120}$' then
    raise exception using errcode = '22023', message = 'A valid Club Deal redemption token is required.';
  end if;
  if p_source_type not in ('club_page', 'dancer_profile') then
    raise exception using errcode = '22023', message = 'A valid Club Deal source is required.';
  end if;
  if p_expires_at <= clock_timestamp() then
    raise exception using errcode = '22023', message = 'The Club Deal redemption expiration must be in the future.';
  end if;
  if p_source_type = 'dancer_profile' and (p_dancer_id is null or p_shift_id is null) then
    raise exception using errcode = '22023', message = 'Dancer attribution is incomplete for this Club Deal.';
  end if;
  if p_source_type = 'club_page' and (p_dancer_id is not null or p_shift_id is not null) then
    raise exception using errcode = '22023', message = 'Club-page redemptions cannot include dancer attribution.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_club_deal_id::text),
    hashtext(coalesce(p_customer_id::text, p_session_id::text))
  );

  insert into public.qr_redemptions (
    redemption_token,
    venue_id,
    club_deal_id,
    source_type,
    dancer_id,
    shift_id,
    attribution_locked_at,
    customer_id,
    session_id,
    nfc_tag_id,
    expires_at,
    ip_address,
    user_agent,
    device_fingerprint,
    audit
  ) values (
    p_redemption_token,
    p_venue_id,
    p_club_deal_id,
    p_source_type,
    p_dancer_id,
    p_shift_id,
    case when p_source_type = 'dancer_profile' then clock_timestamp() else null end,
    p_customer_id,
    p_session_id::text,
    p_tag_id,
    p_expires_at,
    p_audit->>'ip_address',
    p_audit->>'user_agent',
    p_audit->>'device_fingerprint',
    coalesce(p_audit, '{}'::jsonb)
  );

  v_confirmation := public.confirm_deal_redemption_from_nfc(
    p_redemption_token,
    p_tag_id,
    p_session_id,
    coalesce(p_audit, '{}'::jsonb)
  );

  return v_confirmation;
end;
$$;

revoke all on function public.issue_and_confirm_deal_redemption_from_nfc(
  text, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.issue_and_confirm_deal_redemption_from_nfc(
  text, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, timestamptz, jsonb
) to service_role;

comment on function public.issue_and_confirm_deal_redemption_from_nfc(
  text, uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, timestamptz, jsonb
) is 'Atomically issues and confirms one cashier NFC redemption while serializing identical deal and customer/session attempts across venue tags.';

-- New passes are issued and confirmed only by the cashier NFC transaction.
-- Keep the historical function for ledger compatibility but remove the old
-- authenticated execution path so it cannot bypass physical-tag validation.
revoke all on function public.confirm_deal_redemption(text, jsonb)
  from public, anon, authenticated;

comment on function public.confirm_deal_redemption(text, jsonb) is
  'Retired legacy QR confirmer. Current Club Deal revenue requires the service-only cashier NFC transaction.';

commit;
