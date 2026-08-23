-- Connect agent referral links to the verified venue-onboarding workflow.
-- Referral links never approve a venue or create earnings by themselves.

begin;

alter table public.sales_agents
  add column if not exists referral_code text;

update public.sales_agents
set referral_code = encode(gen_random_bytes(18), 'hex')
where referral_code is null;

alter table public.sales_agents
  alter column referral_code set default encode(gen_random_bytes(18), 'hex'),
  alter column referral_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales_agents'::regclass
      and conname = 'sales_agents_referral_code_check'
  ) then
    alter table public.sales_agents
      add constraint sales_agents_referral_code_check
      check (referral_code ~ '^[0-9a-f]{36}$');
  end if;
end;
$$;

create unique index if not exists sales_agents_referral_code_idx
  on public.sales_agents(referral_code);

alter table public.venue_signup_requests
  add column if not exists referring_agent_id uuid
    references public.sales_agents(id) on delete restrict;

create index if not exists venue_signup_requests_referring_agent_idx
  on public.venue_signup_requests(referring_agent_id, status, submitted_at desc)
  where referring_agent_id is not null;

create or replace function public.attribute_approved_venue_agent_referral()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_signer public.sales_agents%rowtype;
  v_level_1 uuid;
  v_level_2 uuid;
  v_level_3 uuid;
  v_level_4 uuid;
  v_level_5 uuid;
  v_attribution_id uuid;
  v_effective_from timestamptz;
begin
  if new.status <> 'approved'
    or old.status = 'approved'
    or new.referring_agent_id is null
  then
    return new;
  end if;

  if new.matched_venue_id is null or new.reviewed_by is null then
    raise exception using errcode = '22023',
      message = 'An approved referred venue requires a verified workspace and administrator.';
  end if;

  select * into v_signer
  from public.sales_agents
  where id = new.referring_agent_id
  for update;

  if not found or v_signer.status <> 'active' then
    raise exception using errcode = '22023',
      message = 'The referring sales agent is no longer active. Resolve the referral before approval.';
  end if;

  if exists (
    select 1
    from public.venue_sales_attributions attribution
    where attribution.venue_id = new.matched_venue_id
      and attribution.superseded_at is null
  ) then
    raise exception using errcode = '23505',
      message = 'This venue already has an active sales-agent attribution.';
  end if;

  v_level_1 := v_signer.sponsor_agent_id;
  select sponsor_agent_id into v_level_2 from public.sales_agents where id = v_level_1;
  select sponsor_agent_id into v_level_3 from public.sales_agents where id = v_level_2;
  select sponsor_agent_id into v_level_4 from public.sales_agents where id = v_level_3;
  select sponsor_agent_id into v_level_5 from public.sales_agents where id = v_level_4;
  v_effective_from := coalesce(new.reviewed_at, clock_timestamp());

  insert into public.venue_sales_attributions (
    venue_id,
    signing_agent_id,
    sponsor_level_1_agent_id,
    sponsor_level_2_agent_id,
    sponsor_level_3_agent_id,
    sponsor_level_4_agent_id,
    sponsor_level_5_agent_id,
    agreement_reference,
    effective_from,
    created_by_admin_user_id
  ) values (
    new.matched_venue_id,
    new.referring_agent_id,
    v_level_1,
    v_level_2,
    v_level_3,
    v_level_4,
    v_level_5,
    'verified-venue-request:' || new.id::text,
    v_effective_from,
    new.reviewed_by
  )
  returning id into v_attribution_id;

  insert into public.admin_actions (
    admin_id,
    target_type,
    target_id,
    action,
    notes
  ) values (
    new.reviewed_by,
    'venue_sales_attribution',
    v_attribution_id,
    'confirm_agent_referred_venue',
    'Verified venue request ' || new.id::text || ' attributed to agent ' || new.referring_agent_id::text
  );

  return new;
end;
$$;

drop trigger if exists venue_signup_requests_attribute_agent on public.venue_signup_requests;
create trigger venue_signup_requests_attribute_agent
  after update of status on public.venue_signup_requests
  for each row
  when (new.status = 'approved' and old.status is distinct from new.status)
  execute function public.attribute_approved_venue_agent_referral();

revoke all on function public.attribute_approved_venue_agent_referral() from public, anon, authenticated;

comment on column public.sales_agents.referral_code is
  'High-entropy public attribution token used only for verified venue signup referrals; it grants no account or venue access.';
comment on column public.venue_signup_requests.referring_agent_id is
  'Agent whose referral link initiated this request. Attribution is confirmed only when an administrator approves the venue.';

commit;
