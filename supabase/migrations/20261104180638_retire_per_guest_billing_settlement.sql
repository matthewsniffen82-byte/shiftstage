begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- The application retired per-guest collection in favor of subscriptions.
-- Keep historical ledgers intact and make the old entry point inert, including
-- for old deployments or a future accidental re-grant. No financial rows change.
create or replace function public.settle_deal_revenue_event(
  p_revenue_event_id uuid,
  p_action text,
  p_external_reference text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '22023',
    message = 'Per-guest billing has been retired. Club billing is subscription only.';
end;
$function$;

revoke all on function public.settle_deal_revenue_event(uuid,text,text)
  from public, anon, authenticated, service_role;

-- void_generated_deal_redemption remains the active owner-only fraud control.
notify pgrst, 'reload schema';
commit;
