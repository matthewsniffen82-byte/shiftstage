-- Serialize hierarchy validation and capture referral ancestors consistently.
-- Existing agents, attribution history, financial rates and permissions are preserved.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public.lock_sales_agent_hierarchy_writes()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '3s'
as $function$
begin
  if tg_relid <> 'public.sales_agents'::regclass
    or tg_level <> 'STATEMENT' or tg_when <> 'BEFORE'
    or tg_op not in ('INSERT', 'UPDATE') then
    raise exception using errcode = '22023', message = 'Invalid sales-agent hierarchy trigger context.';
  end if;
  if current_setting('transaction_isolation') = 'repeatable read' then
    raise exception using errcode = '25000',
      message = 'Sales-agent hierarchy changes require Read Committed or Serializable isolation.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mydancr:sales-agent-hierarchy', 0));
  return null;
end;
$function$;

revoke all on function public.lock_sales_agent_hierarchy_writes()
  from public, anon, authenticated, service_role;

create trigger lock_sales_agent_hierarchy_writes
  before insert or update of sponsor_agent_id, status, commission_depth_limit
  on public.sales_agents for each statement
  execute function public.lock_sales_agent_hierarchy_writes();

CREATE OR REPLACE FUNCTION public.assign_admin_venue_sales_agent(p_admin_id uuid, p_venue_id uuid, p_signing_agent_id uuid, p_agreement_reference text, p_effective_from timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare
  v_attribution_id uuid; v_signer public.sales_agents%rowtype;
  v_level_1 uuid; v_level_2 uuid; v_level_3 uuid; v_level_4 uuid; v_level_5 uuid;
  v_existing_effective_from timestamptz;
begin
  if not exists (
    select 1 from public.app_users account
    where account.id = p_admin_id and account.role = 'admin' and account.account_state = 'active'
  ) then raise exception using errcode = '42501', message = 'Admin access required.'; end if;
  if not exists (select 1 from public.venues where id = p_venue_id and is_active = true) then
    raise exception using errcode = '22023', message = 'Select an active venue.';
  end if;
  select * into v_signer from public.sales_agents where id = p_signing_agent_id for update;
  if not found or v_signer.status <> 'active' then
    raise exception using errcode = '22023', message = 'Select an active signing agent.';
  end if;
  if char_length(trim(coalesce(p_agreement_reference, ''))) not between 3 and 180 then
    raise exception using errcode = '22023', message = 'A signed venue agreement reference is required.';
  end if;
  if p_effective_from is null then
    raise exception using errcode = '22023', message = 'An attribution effective time is required.';
  end if;
  select attribution.effective_from into v_existing_effective_from
  from public.venue_sales_attributions attribution
  where attribution.venue_id = p_venue_id and attribution.superseded_at is null
  for update;
  if v_existing_effective_from is not null and p_effective_from <= v_existing_effective_from then
    raise exception using errcode = '22023',
      message = 'The replacement attribution must begin after the current attribution.';
  end if;
  -- Capture every ancestor from one statement snapshot; the signer stays locked.
  with recursive sponsors as (
    select agent.id, agent.sponsor_agent_id, 1 as depth
    from public.sales_agents agent where agent.id = v_signer.sponsor_agent_id
    union all
    select parent.id, parent.sponsor_agent_id, sponsors.depth + 1
    from public.sales_agents parent join sponsors on parent.id = sponsors.sponsor_agent_id
    where sponsors.depth < 5
  )
  select
    (select id from sponsors where depth = 1),
    (select id from sponsors where depth = 2),
    (select id from sponsors where depth = 3),
    (select id from sponsors where depth = 4),
    (select id from sponsors where depth = 5)
  into v_level_1, v_level_2, v_level_3, v_level_4, v_level_5;
  update public.venue_sales_attributions set superseded_at = p_effective_from
  where venue_id = p_venue_id and superseded_at is null;
  insert into public.venue_sales_attributions (
    venue_id, signing_agent_id, sponsor_level_1_agent_id, sponsor_level_2_agent_id,
    sponsor_level_3_agent_id, sponsor_level_4_agent_id, sponsor_level_5_agent_id,
    agreement_reference, effective_from, created_by_admin_user_id
  ) values (
    p_venue_id, p_signing_agent_id, v_level_1, v_level_2, v_level_3, v_level_4, v_level_5,
    trim(p_agreement_reference), p_effective_from, p_admin_id
  ) returning id into v_attribution_id;
  insert into public.admin_actions (admin_id, target_type, target_id, action, notes)
  values (p_admin_id, 'venue_sales_attribution', v_attribution_id,
    'assign_venue_signing_agent', trim(p_agreement_reference));
  return v_attribution_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.attribute_approved_venue_agent_referral()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
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

  -- Capture every ancestor from one statement snapshot; the signer stays locked.
  with recursive sponsors as (
    select agent.id, agent.sponsor_agent_id, 1 as depth
    from public.sales_agents agent where agent.id = v_signer.sponsor_agent_id
    union all
    select parent.id, parent.sponsor_agent_id, sponsors.depth + 1
    from public.sales_agents parent join sponsors on parent.id = sponsors.sponsor_agent_id
    where sponsors.depth < 5
  )
  select
    (select id from sponsors where depth = 1),
    (select id from sponsors where depth = 2),
    (select id from sponsors where depth = 3),
    (select id from sponsors where depth = 4),
    (select id from sponsors where depth = 5)
  into v_level_1, v_level_2, v_level_3, v_level_4, v_level_5;
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
$function$
;

commit;
