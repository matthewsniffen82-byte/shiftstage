-- Exact public function definitions from the read-only 2026-09-09 catalog.
-- Only used in an isolated PostgreSQL fixture with synthetic accounts and rows.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.app_users
    where id = auth.uid()
      and role = 'admin'
      and account_state = 'active'
  );
$function$
;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.app_users where id = auth.uid();
$function$
;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.void_generated_deal_redemption(p_redemption_id uuid, p_reason text DEFAULT 'admin_marked_suspicious'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_redemption public.qr_redemptions%rowtype;
begin
  if v_user_id is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3
    or length(trim(p_reason)) > 180 then
    raise exception using errcode = '22023', message = 'A valid void reason is required.';
  end if;

  select redemption.*
    into v_redemption
  from public.qr_redemptions redemption
  where redemption.id = p_redemption_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Redemption not found.';
  end if;

  if v_redemption.status <> 'generated' then
    raise exception using
      errcode = '22023',
      message = 'Only an unused generated QR can be voided. Financial reversals require a separate refund record.';
  end if;

  update public.qr_redemptions
  set
    status = 'voided',
    suspicious = true,
    voided_at = v_now,
    voided_by_admin = v_user_id,
    audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
      'voided_by_admin', v_user_id,
      'void_reason', trim(p_reason)
    )
  where id = v_redemption.id;

  insert into public.qr_redemption_events (
    qr_redemption_id,
    event_type,
    actor_user_id,
    audit
  )
  values (
    v_redemption.id,
    'voided',
    v_user_id,
    jsonb_build_object('reason', trim(p_reason))
  );

  return jsonb_build_object(
    'id', v_redemption.id,
    'status', 'voided',
    'suspicious', true
  );
end;
$function$
;
REVOKE ALL ON FUNCTION public.void_generated_deal_redemption(p_redemption_id uuid, p_reason text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_generated_deal_redemption(p_redemption_id uuid, p_reason text) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_deal_revenue_event(p_revenue_event_id uuid, p_action text, p_external_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_event public.deal_revenue_events%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using errcode = '42501', message = 'Admin access required.';
  end if;
  if p_action <> 'venue_payment_received' then
    raise exception using errcode = '22023', message = 'Payee settlements are recorded from their independent commission ledgers.';
  end if;
  if length(trim(coalesce(p_external_reference, ''))) < 3
    or length(trim(p_external_reference)) > 180 then
    raise exception using errcode = '22023', message = 'A valid venue payment reference is required.';
  end if;
  select revenue.* into v_event
  from public.deal_revenue_events revenue
  where revenue.id = p_revenue_event_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Venue receivable not found.';
  end if;
  if v_event.status <> 'pending_venue_payment' then
    raise exception using errcode = '22023', message = 'Venue payment cannot be recorded from the current status.';
  end if;

  update public.deal_revenue_events
  set status = 'settled', venue_payment_reference = trim(p_external_reference),
      venue_payment_received_at = v_now,
      audit = coalesce(audit, '{}'::jsonb) || jsonb_build_object(
        'venue_receivable_settled_by', auth.uid(), 'dancer_payout_dependency', false,
        'agent_payout_dependency_released', true
      )
  where id = v_event.id;
  update public.agent_commission_events
  set status = 'payable', venue_payment_received_at = v_now, payable_at = v_now,
      audit = audit || jsonb_build_object('venue_payment_reference', trim(p_external_reference))
  where deal_revenue_event_id = v_event.id and status = 'pending_venue_payment';

  return jsonb_build_object('id', v_event.id, 'status', 'settled',
    'venue_payment_reference', trim(p_external_reference),
    'venue_payment_received_at', v_now);
end;
$function$
;
REVOKE ALL ON FUNCTION public.settle_deal_revenue_event(p_revenue_event_id uuid, p_action text, p_external_reference text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_deal_revenue_event(p_revenue_event_id uuid, p_action text, p_external_reference text) TO authenticated;
