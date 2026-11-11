-- Filter the authorized review queue before paging or counting its approved items.
-- The original entry point keeps the same result for callers without a wait filter.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $migration$
declare
  body text;
  age_anchor constant text := 'where (p_dancer is null or b.dancer_id=p_dancer)';
  page_anchor constant text := 'select * from eligible';
begin
  select prosrc into strict body from pg_proc
    where oid = 'public.get_media_batches_page(uuid,text,uuid,uuid,integer)'::regprocedure;
  if strpos(body, age_anchor) = 0 or strpos(body, page_anchor) = 0 then
    raise exception 'Unexpected media batch queue definition';
  end if;
  body := replace(body, age_anchor, age_anchor || $age$
    and (p_hours = 0 or (p_role = 'admin' and b.club_submitted_at <= now() - make_interval(hours => p_hours)))$age$);
  body := replace(body, page_anchor, page_anchor || ' where not p_counts_only');
  execute 'create function public.get_media_batches_page(p_actor uuid, p_role text, p_venue uuid,
    p_dancer uuid, p_page integer, p_hours integer, p_counts_only boolean)
    returns jsonb language plpgsql security invoker set search_path='''' as ' || quote_literal(body);
end $migration$;

revoke all on function public.get_media_batches_page(uuid,text,uuid,uuid,integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.get_media_batches_page(uuid,text,uuid,uuid,integer,integer,boolean) to service_role;

create or replace function public.get_media_batches_page(p_actor uuid,p_role text,p_venue uuid,p_dancer uuid,p_page integer)
returns jsonb language sql security invoker set search_path='' as $$
  select public.get_media_batches_page(p_actor,p_role,p_venue,p_dancer,p_page,0,false)
$$;
