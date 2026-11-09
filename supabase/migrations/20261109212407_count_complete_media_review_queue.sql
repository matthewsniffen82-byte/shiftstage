-- Compute reviewer totals across the authorized queue before selecting the visible page.
-- Preserve the existing attachment, onboarding and dancer-history behavior.
do $migration$
declare
  original text := pg_get_functiondef('public.get_media_batches(uuid,text,uuid,uuid)'::regprocedure);
  updated text := original;
  before_text text;
  after_text text;
begin
  for before_text, after_text in values
    ('declare result jsonb;', 'declare result jsonb; queue_count bigint;'),
    ($old$select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at),'[]') into result from ($old$,
     $new$select coalesce(jsonb_agg(to_jsonb(q) - 'queue_total' order by q.created_at,q.id),'[]'),
            coalesce(max(q.queue_total),0) into result,queue_count from ($new$),
    ('jsonb_array_length(b.items) item_count from public.dancer_media_batches b',
     $new$n.item_count, sum(n.item_count) over () as queue_total
   from public.dancer_media_batches b
   cross join lateral (
     select case when p_role='admin' then (
       select count(*) from jsonb_array_elements(b.items) as i(item)
       where b.club_decisions->(i.item->>'key')->>'decision'='approved'
     ) else jsonb_array_length(b.items) end as item_count
   ) n$new$),
    ($old$return jsonb_build_object('batches',result,$old$, $new$return jsonb_build_object('batches',result,'count',queue_count,$new$)
  loop
    if strpos(updated,before_text)=0 then raise exception 'Unexpected get_media_batches definition'; end if;
    updated := replace(updated,before_text,after_text);
  end loop;
  execute updated;
end $migration$;
