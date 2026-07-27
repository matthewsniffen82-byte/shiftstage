-- Let signed-out visitors send one reversible Going signal per shift.
-- Anonymous identifiers are random HttpOnly cookies and only their SHA-256 hashes are stored.

begin;

alter table public.going_signals
  drop constraint if exists going_signals_pkey;

alter table public.going_signals
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists visitor_token_hash text;

update public.going_signals
set id = gen_random_uuid()
where id is null;

alter table public.going_signals
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column customer_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.going_signals'::regclass
      and contype = 'p'
  ) then
    alter table public.going_signals
      add constraint going_signals_pkey primary key (id);
  end if;
end
$$;

alter table public.going_signals
  drop constraint if exists going_signals_exactly_one_visitor;

alter table public.going_signals
  add constraint going_signals_exactly_one_visitor
  check (num_nonnulls(customer_id, visitor_token_hash) = 1);

create unique index if not exists going_signals_customer_shift_unique
  on public.going_signals(customer_id, shift_id)
  where customer_id is not null;

create unique index if not exists going_signals_visitor_shift_unique
  on public.going_signals(visitor_token_hash, shift_id)
  where visitor_token_hash is not null;

create index if not exists going_signals_shift_created_idx
  on public.going_signals(shift_id, created_at desc);

commit;
