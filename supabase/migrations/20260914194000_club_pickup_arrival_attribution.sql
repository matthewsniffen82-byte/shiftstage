begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.pickup_requests drop constraint pickup_requests_referral_outcome_check;
alter table public.pickup_requests add constraint pickup_requests_referral_outcome_check check (referral_outcome in
  ('pending','arrival_reported','arrival_verified','arrival_disputed','completed_unverified','cancelled','no_show','expired'));
create index pickup_referral_match on public.pickup_requests(customer_user_id,venue_id,accepted_at desc) where accepted_at is not null;

-- This observes the existing trusted NFC/cashier redemption. It never creates or
-- edits redemptions, check-ins, commissions, invoices or referral-fee charges.
create function public.pickup_link_nfc_arrival() returns trigger language plpgsql security definer
set search_path=pg_catalog,public as $$
declare r public.pickup_requests%rowtype; candidates uuid[]; evidence_id uuid; linked_id uuid;
begin
  if tg_op='UPDATE' and old.status='redeemed' and new.status<>'redeemed' then
    select pickup_request_id into linked_id from public.pickup_arrival_evidence where redemption_id=new.id;
    if found then
      update public.pickup_requests set referral_outcome='arrival_disputed',updated_at=now() where id=linked_id;
      perform public.pickup_record_event(linked_id,'status_changed',null,
        jsonb_build_object('evidence','nfc_deal_redemption','redemptionId',new.id,'redemptionStatus',new.status,'referralOutcome','arrival_disputed'),
        'The linked deal redemption was reversed. Arrival attribution requires review.');
    end if;
    return new;
  end if;
  if new.status<>'redeemed' or new.customer_id is null or new.nfc_tag_id is null or new.redeemed_at is null
    or new.confirmed_at is null or new.suspicious or new.voided_at is not null then return new; end if;
  if tg_op='UPDATE' and old.status='redeemed' then return new; end if;
  -- Only an unambiguous accepted referral for the same signed-in customer and
  -- venue, followed by a verified arrival within that request's time window.
  select array_agg(id) into candidates from (
    select id from public.pickup_requests where customer_user_id=new.customer_id and venue_id=new.venue_id
      and accepted_at is not null and accepted_at<=new.redeemed_at and requested_at<=new.redeemed_at and expires_at>=new.redeemed_at
      and status in ('accepted','vehicle_dispatched','arriving','arrived','completed','expired')
    order by accepted_at desc limit 2
  ) matching;
  if cardinality(candidates) is distinct from 1 then return new; end if;
  select * into r from public.pickup_requests where id=candidates[1] for update;
  -- Recheck after locking against a concurrent cancellation/no-show.
  if r.status not in ('accepted','vehicle_dispatched','arriving','arrived','completed','expired') then return new; end if;
  insert into public.pickup_arrival_evidence(pickup_request_id,source,redemption_id)
    values(r.id,'nfc_deal_redemption',new.id) on conflict do nothing returning id into evidence_id;
  if evidence_id is null then return new; end if;
  update public.pickup_requests set referral_outcome='arrival_verified',arrived_at=coalesce(arrived_at,new.redeemed_at),updated_at=now(),
    status=case when status in ('accepted','vehicle_dispatched','arriving') then 'arrived' else status end where id=r.id;
  perform public.pickup_record_event(r.id,'arrival_verified',null,
    jsonb_build_object('source','nfc_deal_redemption','redemptionId',new.id,'evidenceId',evidence_id,'dealId',new.club_deal_id),
    'Arrival verified through the existing venue NFC deal redemption.');
  perform public.pickup_notify(r.id,null,'arrived');
  return new;
end $$;
revoke all on function public.pickup_link_nfc_arrival() from public,anon,authenticated,service_role;
create trigger pickup_nfc_arrival after insert or update of status on public.qr_redemptions
  for each row execute function public.pickup_link_nfc_arrival();

-- Both participants may record independent confirmation once arrival is reported.
create function public.pickup_confirm_arrival(p_id uuid) returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare who text; r public.pickup_requests%rowtype; evidence_source text;
begin
  who := public.pickup_viewer(p_id);
  if who is null or who not in ('customer','venue') or not public.pickup_has_consent(p_id) then
    raise exception using errcode='42501',message='Pickup access and chat consent are required.';
  end if;
  select * into strict r from public.pickup_requests where id=p_id for update;
  if r.status not in ('arrived','completed') then
    perform public.pickup_set_status(p_id,'arrived',r.status); return;
  end if;
  evidence_source := case who when 'customer' then 'customer_confirmation' else 'venue_confirmation' end;
  insert into public.pickup_arrival_evidence(pickup_request_id,source,actor_user_id) values(p_id,evidence_source,auth.uid()) on conflict do nothing;
  if found then perform public.pickup_record_event(p_id,'arrival_confirmed',auth.uid(),jsonb_build_object('source',evidence_source),
    case who when 'customer' then 'Customer also confirmed arrival.' else 'Venue also confirmed customer arrival.' end); end if;
end $$;
revoke all on function public.pickup_confirm_arrival(uuid) from public,anon,authenticated,service_role;
grant execute on function public.pickup_confirm_arrival(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
