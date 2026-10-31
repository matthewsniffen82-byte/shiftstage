begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Completed media references are recovery receipts, not an indefinite personal-data archive.
insert into public.lifecycle_retention_rules(source,policy_id,policy_revision,due_expression)
select 'retention_media_jobs',id,revision,
 $e$case when t.state='completed' then t.completed_at+interval '90 days' end$e$
from public.compliance_records where kind='retention' and title='Security logs' and status='verified'
order by created_at,id limit 1;

create function public.reapply_retention_media(p_job jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare b text:=p_job->>'bucket'; p text:=p_job->>'storage_path'; f text:=p_job->>'family';
 original_time timestamptz:=(p_job->>'trigger_at')::timestamptz;
 completed_time timestamptz:=(p_job->>'completed_at')::timestamptz;
begin
 if not public.assert_retention_restore_isolated() then raise exception 'Restored target must be isolated'; end if;
 if b not in ('dancer-photos','mydancr-tv-videos','dancer-photo-uploads','dancr-image-moderation-temp',
 'dancr-image-moderation-review','venue-ownership-proofs','venue-cover-images','venue-logo-images','venue-qr-codes')
 or b is null or p is null or f is null or f not in ('image','video','object')
 or original_time is null or original_time>clock_timestamp()
 or completed_time>clock_timestamp() or completed_time<now()-interval '90 days' then raise exception 'Invalid media recovery reference'; end if;
 insert into public.retention_media_jobs(bucket,storage_path,family,trigger_at,completed_at)
 values(b,p,f,original_time,completed_time)
 on conflict(bucket,storage_path) do update set
 family=excluded.family,trigger_at=least(retention_media_jobs.trigger_at,excluded.trigger_at),
 completed_at=least(retention_media_jobs.completed_at,excluded.completed_at),
 state='pending',next_attempt_at=now(),lease_id=null,lease_until=null,error_code=null;
 return true;
end $$;
revoke all on function public.reapply_retention_media(jsonb) from public,anon,authenticated;
grant execute on function public.reapply_retention_media(jsonb) to service_role;

-- A replayed completion is reconfirmed without restarting its original retention clock.
create function private.preserve_retention_media_completion() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.completed_at is not null then new.completed_at:=least(old.completed_at,new.completed_at); end if;
 return new;
end $$;
revoke all on function private.preserve_retention_media_completion() from public,anon,authenticated;
grant execute on function private.preserve_retention_media_completion() to service_role;
create trigger retention_media_completion_clock before update on public.retention_media_jobs
for each row execute function private.preserve_retention_media_completion();
notify pgrst,'reload schema';
commit;
