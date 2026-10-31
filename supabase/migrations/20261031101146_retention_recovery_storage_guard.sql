begin;
set local lock_timeout='5s';
-- Recovery keys are server-only, even if another Storage policy is broadened later.
create policy retention_recovery_server_only on storage.objects as restrictive
for all to anon,authenticated using(bucket_id<>'retention-recovery') with check(bucket_id<>'retention-recovery');
commit;
