-- Finish only the private training club's review of already-approved demo media.
-- Existing public profile, affiliations, check-ins, verification and other club decisions must remain unchanged.
begin;
set local lock_timeout='3s'; set local statement_timeout='30s';
create temp table training_review_baseline on commit drop as select
 (select md5(to_jsonb(d)::text) from dancer_profiles d where id='23cb64ea-f849-4fde-a526-260692b46e95') profile,
 (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'')) from shifts s where dancer_id='23cb64ea-f849-4fde-a526-260692b46e95') shifts,
 (select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from venue_dancer_affiliations a where dancer_id='23cb64ea-f849-4fde-a526-260692b46e95') affiliations;
do $capture$
declare b dancer_media_batches; item jsonb; result jsonb;
begin
 select * into strict b from dancer_media_batches where id='02ef2dd6-a70c-41c0-88b4-b57a9a17b455'
  and venue_id='ad4f25e0-ecdd-401c-8085-37ac04a2063d' and dancer_id='23cb64ea-f849-4fde-a526-260692b46e95' for update;
 if b.state='completed' then return; end if;
 if b.state<>'club' or not exists(select 1 from venues where id=b.venue_id and slug='manual-training-20261030' and not is_active and published_at is null)
 then raise exception 'Expected private training batch'; end if;
 for item in select value from jsonb_array_elements(b.items) loop
  if not exists(select 1 from dancer_club_media(array[b.dancer_id]) m where m.id=(item->>'id')::uuid and m.source=item->>'source'
    and m.content_version=item->>'version' and m.record->>'status'='approved') then raise exception 'Only already-approved demo media may be used'; end if;
  select * into b from dancer_media_batches where id=b.id;
  perform save_media_batch_decision('daa5f349-604e-493e-a863-90d2b11070cd','venue',b.id,b.revision,item->>'key','approved','Training review of previously MyDancr-approved demo media.');
 end loop;
 select * into b from dancer_media_batches where id=b.id;
 result:=submit_club_media_batch('daa5f349-604e-493e-a863-90d2b11070cd',b.id,b.revision);
 if result->>'state'<>'completed' then raise exception 'Training review did not finish';end if;
 -- Suppress this training result email before any delivery worker can see it.
 delete from dancer_media_email_deliveries where recipient_id='2263ed60-ec6d-43ec-946e-c821cfec8a90' and payload->>'batchId'=b.id::text and status='pending';
 if (select profile from training_review_baseline)<>(select md5(to_jsonb(d)::text) from dancer_profiles d where d.id=b.dancer_id)
 or (select shifts from training_review_baseline)<>(select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'')) from shifts s where dancer_id=b.dancer_id)
 or (select affiliations from training_review_baseline)<>(select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from venue_dancer_affiliations a where dancer_id=b.dancer_id)
 then raise exception 'Existing dancer state must remain unchanged';end if;
end $capture$;
select state,jsonb_array_length(items) items,club_submitted_at from dancer_media_batches where id='02ef2dd6-a70c-41c0-88b4-b57a9a17b455';
commit;
