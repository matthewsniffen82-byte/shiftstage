-- Both callers share the same locks, holds, reference checks and five-minute leases.
create function public.claim_retention_media(p_limit integer) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='2s' set statement_timeout='10s' as $$
declare j public.retention_media_jobs; result jsonb:='[]';
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Media cleanup requires read committed'; end if;
 perform pg_advisory_xact_lock(71031,91);
 if not pg_try_advisory_xact_lock(71031,90) then return result; end if;
 if exists(select 1 from public.compliance_records where kind='hold' and status<>'completed') then return result; end if;
 if not exists(select 1 from public.lifecycle_retention_rules r join public.compliance_records p on p.id=r.policy_id and p.revision=r.policy_revision
  where r.source='dancer_photos' and r.enabled and p.status='verified') then return result; end if;
 for j in select * from public.retention_media_jobs where state<>'completed' and next_attempt_at<=now() and (lease_until is null or lease_until<now())
  order by next_attempt_at,id limit least(20,greatest(1,p_limit)) for update skip locked loop
  perform pg_advisory_xact_lock(hashtextextended(j.bucket||'/'||j.storage_path,71));
  if private.retention_media_referenced(j.bucket,j.storage_path) or exists(select 1 from public.safety_media_restrictions where private.retention_media_member(j.bucket,j.storage_path,bucket,storage_path)) then
   update public.retention_media_jobs set next_attempt_at=now()+interval '1 hour',error_code='reference_or_restriction' where id=j.id; continue;
  end if;
  update public.retention_media_jobs set state='deleting',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=j.id returning * into j;
  result:=result||jsonb_build_array(to_jsonb(j));
 end loop;
 return result;
end
$$;
revoke all on function public.claim_retention_media(integer) from public,anon,authenticated;
grant execute on function public.claim_retention_media(integer) to service_role;

create or replace function public.claim_retention_media() returns jsonb
language sql volatile security invoker set search_path='' as $$
  select public.claim_retention_media(20)
$$;

create function public.retention_media_queue_status() returns jsonb
language sql stable security invoker set search_path='' as $$
  with oldest as (
    select min(j.next_attempt_at) due from public.retention_media_jobs j
    where j.state<>'completed' and j.next_attempt_at<=now() and (j.lease_until is null or j.lease_until<now())
      and not exists(select 1 from public.compliance_records where kind='hold' and status<>'completed')
      and exists(select 1 from public.lifecycle_retention_rules r join public.compliance_records p
        on p.id=r.policy_id and p.revision=r.policy_revision
        where r.source='dancer_photos' and r.enabled and p.status='verified')
  )
  select jsonb_build_object('workDue',due is not null,'oldestDueMinutes',
    coalesce(floor(extract(epoch from now()-due)/60)::integer,0)) from oldest
$$;
revoke all on function public.retention_media_queue_status() from public,anon,authenticated;
grant execute on function public.retention_media_queue_status() to service_role;
