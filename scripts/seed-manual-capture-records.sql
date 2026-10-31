-- Actual application records for user-requested manual screenshots.
-- Fictional guests; all IDs and cleanup are scoped to this dataset.
-- No outgoing messages, no admission, no public-page or verification changes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtext('mydancr-manual-captures-20261030'));
create function pg_temp.capture_id(key text) returns uuid language sql immutable as $f$
 select overlay(overlay(md5('mydancr-manual-captures-20261030:'||key) placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid
$f$;
do $guard$ begin
 if not exists(select 1 from venues v join app_users a on a.id=v.owner_user_id
 where v.id='103e9b1b-77b5-43d2-9eb8-88aa11ed906d' and v.slug='spearmint-rhino' and v.is_active and v.page_review_status='published'
 and a.email='democlub@mydancr.com') then raise exception 'Club identity changed'; end if;
 if (select count(*) from auth.users where id in ('0c6b08ec-4229-4fa0-a929-39a2d0fcef4c','daa5f349-604e-493e-a863-90d2b11070cd')
 and raw_app_meta_data->>'dataset_marker'='mydancr-manual-captures-20261030')<>2 then raise exception 'Training account identities changed'; end if;
 if not exists(select 1 from dancer_profiles d join app_users a on a.id=d.user_id join dancer_age_verifications av on av.user_id=a.id
 where d.id='23cb64ea-f849-4fde-a526-260692b46e95' and a.email='demodancer@mydancr.com' and av.status='verified') then raise exception 'Verified training dancer required'; end if;
end $guard$;
insert into venues(id,owner_user_id,name,slug,city,state,address,phone,website,timezone,is_active,page_review_status,page_review_sent_at,page_review_notes,opens_at,closes_at)
values(pg_temp.capture_id('private-club'),'daa5f349-604e-493e-a863-90d2b11070cd','Manual Training Club','manual-training-20261030','Las Vegas','NV',
 'Training location - not open to the public','702-555-0180','https://www.mydancr.com','America/Los_Angeles',false,'venue_review',now(),
 'Private training record for the operating manual; do not publish.', '18:00','04:00')
on conflict(id) do nothing;
insert into club_deals(id,venue_id,deal_title,deal_description,deal_terms,is_active,offer_type)
values(pg_temp.capture_id('private-deal'),pg_temp.capture_id('private-club'),'Free admission','Sample offer for page review.',
 'Training record only. Not redeemable.',true,'admission') on conflict(id) do nothing;
insert into nfc_tags(id,venue_id,tag_type,label,token_digest,status,created_by_user_id)
values(pg_temp.capture_id('private-tag'),pg_temp.capture_id('private-club'),'dressing_room','Manual capture - no physical sticker',
 encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),'active','daa5f349-604e-493e-a863-90d2b11070cd') on conflict(id) do nothing;
insert into dancer_nfc_enrollments(id,dancer_user_id,venue_id,nfc_tag_id,status,tapped_at,expires_at,audit)
values(pg_temp.capture_id('enrollment'),'2263ed60-ec6d-43ec-946e-c821cfec8a90',pg_temp.capture_id('private-club'),pg_temp.capture_id('private-tag'),
 'pending',now(),now()+interval '7 days',jsonb_build_object('dataset_marker','mydancr-manual-captures-20261030','training',true,'simulated_tap',true))
on conflict(dancer_user_id,venue_id) do nothing;
insert into club_dancer_approvals(venue_id,dancer_id,status)
values(pg_temp.capture_id('private-club'),'23cb64ea-f849-4fde-a526-260692b46e95','pending') on conflict do nothing;
-- Snapshot existing approved demo media. Do not copy or change originals.
insert into dancer_media_batches(id,dancer_id,venue_id,items)
select pg_temp.capture_id('kelly-batch'),'23cb64ea-f849-4fde-a526-260692b46e95',pg_temp.capture_id('private-club'),jsonb_agg(item order by item->>'key')
from private.media_batch_snapshot('23cb64ea-f849-4fde-a526-260692b46e95') where published
on conflict(id) do nothing;
insert into dancer_media_batches(id,dancer_id,venue_id,items)
select pg_temp.capture_id('aria-batch'),'b5f81d41-07e0-4317-8ee9-b386cd287d27','103e9b1b-77b5-43d2-9eb8-88aa11ed906d',jsonb_agg(item order by item->>'key')
from private.media_batch_snapshot('b5f81d41-07e0-4317-8ee9-b386cd287d27') where published
on conflict(id) do nothing;
insert into qr_redemptions(id,redemption_token,venue_id,club_deal_id,source_type,session_id,generated_at,expires_at,status,admission_pass_version,arrival_method,audit)
values(pg_temp.capture_id('guest-pass'),gen_random_uuid()::text||gen_random_uuid()::text,'103e9b1b-77b5-43d2-9eb8-88aa11ed906d',
 '96ea2bf1-b861-4274-a1db-459c41a6a591','club_page','mydancr-manual-captures-20261030',now(),now()+interval '24 hours','generated',1,'guest_list',
 jsonb_build_object('dataset_marker','mydancr-manual-captures-20261030','fictional',true,'simulated_consent',true,'admission_policy','staff-verified-v1',
 'deal_snapshot',jsonb_build_object('dealTitle','Free admission','offerType','admission'))) on conflict(id) do nothing;
insert into venue_guest_list_entries(pass_id,venue_id,guest_name,phone,email,consented_at)
values(pg_temp.capture_id('guest-pass'),'103e9b1b-77b5-43d2-9eb8-88aa11ed906d','Alex Training','+17025550180',
 'manual-customer-20261030@synthetic.mydancr.invalid',now()) on conflict(pass_id) do nothing;
insert into club_shuttle_requests(id,venue_id,deal_id,details_hash,notification_rows,created_at,handed_off_at,staff_status)
select pg_temp.capture_id('ride'),'103e9b1b-77b5-43d2-9eb8-88aa11ed906d','96ea2bf1-b861-4274-a1db-459c41a6a591',
 encode(sha256(convert_to(details::text,'UTF8')),'hex'),
 jsonb_build_array(jsonb_build_object('id',pg_temp.capture_id('ride-notice'),'recipient_id','a3775d81-b00d-4777-89d6-d9cb7e6c52e2',
 'notification_type','support_message','channel','in_app','title','Training ride request','body','Training record; no transport dispatched.','payload',details)),
 now(),now(),'received'
from (select jsonb_build_object('kind','club_shuttle_request','requestId',pg_temp.capture_id('ride'),
 'venueId','103e9b1b-77b5-43d2-9eb8-88aa11ed906d','dealId','96ea2bf1-b861-4274-a1db-459c41a6a591','name','Alex Training',
 'email','manual-customer-20261030@synthetic.mydancr.invalid','phone','+17025550180','location','Hotel main valet - training pickup',
 'partySize',2,'dataset_marker','mydancr-manual-captures-20261030','fictional',true,'notifications_suppressed',true) details) x
on conflict(id) do nothing;
insert into venue_vip_members(id,venue_id,user_id,display_name,nickname)
values(pg_temp.capture_id('vip-member'),'103e9b1b-77b5-43d2-9eb8-88aa11ed906d','0c6b08ec-4229-4fa0-a929-39a2d0fcef4c','Alex Training','Manual training guest')
on conflict do nothing;
insert into venue_vip_requests(id,venue_id,user_id,guest_name,starts_at,timezone,dancers,notes)
values(pg_temp.capture_id('vip-request'),'103e9b1b-77b5-43d2-9eb8-88aa11ed906d','0c6b08ec-4229-4fa0-a929-39a2d0fcef4c','Alex Training',
 now()+interval '2 hours','America/Los_Angeles',jsonb_build_array(jsonb_build_object('id','b5f81d41-07e0-4317-8ee9-b386cd287d27','stageName','Aria')),
 'Manual training visit: party of 2. No real reservation.') on conflict(id) do nothing;
insert into venue_follows(customer_id,venue_id,notifications_enabled)
values('0c6b08ec-4229-4fa0-a929-39a2d0fcef4c','103e9b1b-77b5-43d2-9eb8-88aa11ed906d',false) on conflict do nothing;
insert into internal_roster_links(id,venue_id,kind,label)
select pg_temp.capture_id('table-'||n),'103e9b1b-77b5-43d2-9eb8-88aa11ed906d','table','Training table '||n from generate_series(1,3)n on conflict(id) do nothing;
create temp table capture_new_requests(id uuid primary key) on commit drop;
with inserted as (
 insert into internal_roster_requests(id,venue_id,link_id,dancer_id,request_key,status,attendance,attendance_recorded_at)
 select pg_temp.capture_id('table-request-'||n),'103e9b1b-77b5-43d2-9eb8-88aa11ed906d',pg_temp.capture_id('table-'||n),
 'b5f81d41-07e0-4317-8ee9-b386cd287d27',pg_temp.capture_id('table-key-'||n),
 case when n=1 then 'pending' else 'acknowledged' end,case when n=3 then 'arrived' end,case when n=3 then now() end
 from generate_series(1,3)n on conflict(id) do nothing returning id
) insert into capture_new_requests select id from inserted;
-- Remove only deliveries generated for the new training requests, before commit.
delete from notifications where id in(select id from dancer_table_request_deliveries where request_id in(select id from capture_new_requests));
delete from dancer_table_request_deliveries where request_id in(select id from capture_new_requests);
delete from internal_request_push_deliveries where request_id in(select id from capture_new_requests);
set constraints all immediate;
select jsonb_build_object('privateClub',pg_temp.capture_id('private-club'),'kellyBatch',pg_temp.capture_id('kelly-batch'),'ariaBatch',pg_temp.capture_id('aria-batch'),
 'guestPass',pg_temp.capture_id('guest-pass'),'ride',pg_temp.capture_id('ride'),'vipRequest',pg_temp.capture_id('vip-request'),
 'tableRequests',(select count(*) from internal_roster_requests where id in(select pg_temp.capture_id('table-request-'||n) from generate_series(1,3)n)));
commit;
