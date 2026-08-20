-- Retire the Bitsafe payout integration without rewriting immutable financial
-- history. Existing ledger and payout rows retain their original provider for
-- audit purposes, but no new Bitsafe-backed records can be created.

begin;

update public.payout_settings
set payouts_enabled = false,
    payment_provider = 'stripe',
    updated_at = now()
where lower(trim(payment_provider)) = 'bitsafe';

-- Payout-account aliases are operational connection data rather than ledger
-- history. Remove retired-provider links so they cannot be used again.
delete from public.dancer_payout_accounts
where lower(trim(payment_provider)) = 'bitsafe';

drop function if exists public.consume_payout_provider_oauth_state(text, text);
drop table if exists public.payout_provider_oauth_states;

create or replace function public.reject_retired_payout_provider()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if lower(trim(new.payment_provider)) = 'bitsafe' then
    if tg_op = 'INSERT' then
      raise exception 'The selected payout provider is no longer supported.' using errcode = '22023';
    elsif old.payment_provider is distinct from new.payment_provider then
      raise exception 'The selected payout provider is no longer supported.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reject_retired_provider_settings on public.payout_settings;
create trigger reject_retired_provider_settings
before insert or update of payment_provider on public.payout_settings
for each row execute function public.reject_retired_payout_provider();

drop trigger if exists reject_retired_provider_accounts on public.dancer_payout_accounts;
create trigger reject_retired_provider_accounts
before insert or update of payment_provider on public.dancer_payout_accounts
for each row execute function public.reject_retired_payout_provider();

drop trigger if exists reject_retired_provider_earnings on public.commission_events;
create trigger reject_retired_provider_earnings
before insert or update of payment_provider on public.commission_events
for each row execute function public.reject_retired_payout_provider();

drop trigger if exists reject_retired_provider_batches on public.dancer_payout_batches;
create trigger reject_retired_provider_batches
before insert or update of payment_provider on public.dancer_payout_batches
for each row execute function public.reject_retired_payout_provider();

drop trigger if exists reject_retired_provider_webhooks on public.payment_provider_webhook_events;
create trigger reject_retired_provider_webhooks
before insert or update of payment_provider on public.payment_provider_webhook_events
for each row execute function public.reject_retired_payout_provider();

revoke all on function public.reject_retired_payout_provider() from public, anon, authenticated;

comment on function public.reject_retired_payout_provider() is
  'Prevents new records from selecting the retired Bitsafe payout provider while preserving historical financial rows.';

commit;
