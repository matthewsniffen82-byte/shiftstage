-- Echo House sample Contacts, after prepare-echo-dashboard-guests.mjs and seed-echo-dashboard.sql.
-- Fictional sharing/subscription examples only: login-disabled .invalid accounts and 555-01xx phones.
-- No invitations, messages, notification jobs, or real customers' permissions are created or changed.
-- Rehearse with ROLLBACK first. Repeating this script preserves existing edits and unsubscribes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtext('mydancr-echo-contacts-v1'));

create temp table echo_contacts_context on commit drop as
select v.id venue_id, v.name, now() stamp
from public.venues v join public.app_users a on a.id=v.owner_user_id
where v.id='260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af' and v.name='Echo House' and v.is_active
  and a.role='venue' and a.account_state='active';

create temp table echo_contacts_guests on commit drop as
select u.id, u.email, 'Sample guest '||substring(u.email from 'guest-([0-9]+)') name,
  substring(u.email from 'guest-([0-9]+)')::integer n, receipt.pass_id, receipt.phone
from auth.users u join public.app_users a on a.id=u.id
cross join echo_contacts_context e
join public.venue_follows f on f.customer_id=u.id and f.venue_id=e.venue_id
join lateral (
  select g.pass_id,g.phone from public.venue_guest_list_entries g
  join public.qr_redemptions q on q.id=g.pass_id and q.venue_id=g.venue_id
  where g.venue_id=e.venue_id and q.customer_id=u.id
    and q.audit->>'dataset_marker'='mydancr-echo-dashboard-v1'
    and g.email=u.email and g.phone='+170255501'||substring(u.email from 'guest-([0-9]+)')
  order by g.created_at desc,g.pass_id limit 1
) receipt on true
where u.email ~ '^echo-experience-guest-(0[1-9]|1[0-2])@synthetic[.]mydancr[.]invalid$'
  and u.raw_user_meta_data->>'dataset_marker'='mydancr-echo-dashboard-v1'
  and u.banned_until>now() and a.role='customer' and a.account_state='active';

do $$ begin
  if (select count(*) from echo_contacts_context)<>1 then
    raise exception 'Expected the active Echo House fixture venue and owner';
  end if;
  if (select count(*) from echo_contacts_guests)<>12 then
    raise exception 'Expected 12 login-disabled sample guests with fictional follow and guest-list records';
  end if;
end $$;

insert into public.venue_customer_shares(customer_id,venue_id,name,email,city,consent_version,consented_at)
select g.id,e.venue_id,g.name,g.email,'Las Vegas','venue-customer-sharing-v1',e.stamp-make_interval(days=>g.n)
from echo_contacts_guests g cross join echo_contacts_context e
on conflict do nothing;

-- Varied examples: email only (1-4), both (5-8), text only (9-10), visit details only (11-12).
-- Consent history points only to the existing fictional guest-list receipts.
with inserted as (
  insert into public.venue_update_subscriptions(id,venue_id,channel,destination,name,consented_at,manage_token)
  select md5('mydancr-echo-contacts-v1:'||g.id||':'||c.channel)::uuid,e.venue_id,c.channel,
    case when c.channel='email' then g.email else g.phone end,g.name,e.stamp-make_interval(days=>g.n),
    translate(rtrim(encode(uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid()),'base64'),'='),'+/','-_')
  from echo_contacts_guests g cross join echo_contacts_context e cross join (values ('email'),('text')) c(channel)
  where (c.channel='email' and g.n<=8) or (c.channel='text' and g.n between 5 and 10)
  on conflict do nothing returning id,channel,destination,consented_at
)
insert into public.venue_update_consent_events(subscription_id,source,source_id,channel,consent_version,sender_name,consented_at)
select s.id,'guest_list',g.pass_id,s.channel,'venue-updates-v1',e.name,s.consented_at
from inserted s join echo_contacts_guests g on s.destination=case when s.channel='email' then g.email else g.phone end
cross join echo_contacts_context e
on conflict do nothing;

set constraints all immediate;
select jsonb_build_object('venue','Echo House',
  'sampleSharedContacts',(select count(*) from public.venue_customer_shares s
    join echo_contacts_guests g on g.id=s.customer_id join echo_contacts_context e on e.venue_id=s.venue_id),
  'sampleActiveSubscriptions',(select count(*) from public.venue_update_subscriptions s
    join echo_contacts_guests g on s.destination=case when s.channel='email' then g.email else g.phone end
    join echo_contacts_context e on e.venue_id=s.venue_id where s.withdrawn_at is null)) receipt;
commit;
