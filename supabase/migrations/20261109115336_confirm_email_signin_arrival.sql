begin;

-- Only completed links enter retention. An abandoned sign-in attempt does not retire a link.
alter table public.notification_email_signins drop column expires_at,
  add column attempt_id uuid, add column attempt_until timestamptz,
  add column review_kind text check (review_kind in ('dancer', 'media'));
create index notification_email_signins_completed on public.notification_email_signins(used_at) where used_at is not null;
update public.lifecycle_retention_rules set due_expression = 't.used_at + interval ''30 days'''
  where source = 'notification_email_signins';

-- Preserve the recipient and club for previously emailed review links independently of delivery-log cleanup.
create function private.save_review_signin(job public.venue_email_deliveries) returns void
language sql security invoker set search_path = '' as $$
  insert into public.notification_email_signins(id, delivery_tag, recipient_id, recipient_role, email_tag, venue_id, review_kind, used_at)
  select job.id, 'review-login:' || job.id, job.recipient_id, 'venue',
    encode(sha256(convert_to(lower(btrim(job.destination)), 'UTF8')), 'hex'), job.venue_id,
    case job.payload->>'kind' when 'venue_media_pending' then 'media' else 'dancer' end, event.created_at
  from (select 1) seed left join public.venue_email_events event on event.event_key = 'review-login:' || job.id
  where job.status = 'accepted' and job.destination is not null and job.venue_id is not null
    and (job.payload->>'kind',job.payload->>'emailPath') in
      (('venue_media_pending','/dashboard/venue#venue-media-reviews'),('venue_dancer_approval_pending','/dashboard/venue#venue-dancer-approvals'))
  on conflict (id) do nothing;
$$;
create function private.record_review_signin() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform private.save_review_signin(new);
  return new;
end $$;
revoke all on function private.save_review_signin(public.venue_email_deliveries), private.record_review_signin() from public,anon,authenticated;
grant execute on function private.save_review_signin(public.venue_email_deliveries), private.record_review_signin() to service_role;
create trigger record_review_signin after insert or update of status on public.venue_email_deliveries
  for each row when (new.status='accepted' and new.payload->>'kind' in ('venue_media_pending','venue_dancer_approval_pending'))
  execute function private.record_review_signin();
select private.save_review_signin(job) from public.venue_email_deliveries job where job.status='accepted'
  and job.payload->>'kind' in ('venue_media_pending','venue_dancer_approval_pending');

-- Honor an exchange completed by an older application instance during rollout.
create function private.retire_legacy_review_signin() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update public.notification_email_signins set used_at=new.created_at where delivery_tag=new.event_key and used_at is null;
  return new;
end $$;
revoke all on function private.retire_legacy_review_signin() from public,anon,authenticated;
grant execute on function private.retire_legacy_review_signin() to service_role;
create trigger retire_legacy_review_signin after insert on public.venue_email_events
  for each row when (new.event_key like 'review-login:%') execute function private.retire_legacy_review_signin();

commit;
