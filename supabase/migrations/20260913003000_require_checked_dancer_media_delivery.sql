-- Deploy the checked media delivery endpoints before applying this migration.
-- Retain every object and policy; the restrictive SELECT rule prevents browser
-- clients from minting direct Storage URLs that outlive an account pause.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $$begin
  if (select count(*) from storage.buckets where id in ('dancer-photos','mydancr-tv-videos')) <> 2 then
    raise exception 'Required dancer media buckets are missing';
  end if;
end$$;
update storage.buckets set public = false where id in ('dancer-photos','mydancr-tv-videos');
create policy "Dancer media reads require checked delivery"
  on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id not in ('dancer-photos','mydancr-tv-videos'));
commit;
