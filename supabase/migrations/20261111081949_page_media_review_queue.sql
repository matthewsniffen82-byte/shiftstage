-- Keep the original callers on page zero and share their authorization, attachment
-- and visibility rules with the paged queue.
do $migration$
declare
  original text := pg_get_functiondef('public.get_media_batches(uuid,text,uuid,uuid)'::regprocedure);
  body text := split_part(original, 'AS $function$', 2);
  queue_start integer := strpos(body, ' select coalesce(jsonb_agg(to_jsonb(q)');
  rows_start integer := strpos(body, '  select b.id,b.dancer_id,b.venue_id');
  order_start integer := strpos(body, '   order by case when p_role=''dancer'' then b.created_at');
  result_start integer := strpos(body, ' return jsonb_build_object(''batches'',result,');
begin
  if not (queue_start > 0 and rows_start > queue_start and order_start > rows_start and result_start > order_start)
    then raise exception 'Unexpected media review queue definition'; end if;
  body := replace(left(body, queue_start - 1), 'queue_count bigint;', 'queue_count bigint; batch_count bigint;')
    || ' with eligible as materialized (' || replace(substr(body, rows_start, order_start - rows_start),
      'n.item_count, sum(n.item_count) over () as queue_total', 'n.item_count')
    || $page$
    ), page as (
      select * from eligible
      order by case when p_role='dancer' then created_at end desc, created_at, id
      limit case when p_role='venue' and p_dancer is not null then null else 100 end
      offset (p_page::bigint * 100)
    )
    select (select coalesce(jsonb_agg(to_jsonb(page) order by created_at,id),'[]') from page),
           coalesce(sum(item_count),0), count(*) into result,queue_count,batch_count from eligible;
    $page$
    || replace(substr(body, result_start), '''count'',queue_count,', '''count'',queue_count,''batchCount'',batch_count,');
  execute 'create function public.get_media_batches_page(p_actor uuid,p_role text,p_venue uuid,p_dancer uuid,p_page integer)
    returns jsonb language plpgsql security invoker set search_path='''' as $function$' || body;
end $migration$;

revoke all on function public.get_media_batches_page(uuid,text,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.get_media_batches_page(uuid,text,uuid,uuid,integer) to service_role;

create or replace function public.get_media_batches(p_actor uuid,p_role text,p_venue uuid default null,p_dancer uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select public.get_media_batches_page(p_actor,p_role,p_venue,p_dancer,0)
$$;
