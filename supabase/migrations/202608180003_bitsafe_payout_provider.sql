-- Bitsafe/Yoursafe hosted account connection state. OAuth authorization codes,
-- access tokens, bank details, and identity documents are never persisted.

create table if not exists public.payout_provider_oauth_states (
  id uuid primary key default gen_random_uuid(),
  payment_provider text not null check (payment_provider in ('bitsafe')),
  dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique check (state_hash ~ '^[a-f0-9]{64}$'),
  nonce text not null check (char_length(nonce) between 32 and 128),
  return_url text not null check (char_length(return_url) between 1 and 2048),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payout_provider_oauth_states_expiry_idx
  on public.payout_provider_oauth_states(payment_provider, expires_at)
  where consumed_at is null;

create or replace function public.consume_payout_provider_oauth_state(
  p_payment_provider text,
  p_state_hash text
)
returns table (
  id uuid,
  dancer_id uuid,
  user_id uuid,
  nonce text,
  return_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.payout_provider_oauth_states%rowtype;
begin
  if p_payment_provider <> 'bitsafe' or p_state_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  select * into v_state
  from public.payout_provider_oauth_states oauth_state
  where oauth_state.payment_provider = p_payment_provider
    and oauth_state.state_hash = p_state_hash
    and oauth_state.consumed_at is null
    and oauth_state.expires_at > now()
  for update;

  if not found then return; end if;

  update public.payout_provider_oauth_states oauth_state
  set consumed_at = now()
  where oauth_state.id = v_state.id;

  return query select v_state.id, v_state.dancer_id, v_state.user_id, v_state.nonce, v_state.return_url;
end;
$$;

alter table public.payout_provider_oauth_states enable row level security;

-- There are deliberately no browser-facing policies. Only the service-role
-- onboarding endpoints may create or consume these short-lived records.
revoke all on table public.payout_provider_oauth_states from public, anon, authenticated;
revoke all on function public.consume_payout_provider_oauth_state(text, text) from public, anon, authenticated;
grant execute on function public.consume_payout_provider_oauth_state(text, text) to service_role;

comment on table public.payout_provider_oauth_states is
  'Single-use hashed OAuth state for Bitsafe/Yoursafe hosted payout onboarding; contains no financial credentials.';
