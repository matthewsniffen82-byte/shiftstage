-- Return bounded metric totals without transporting raw viewer event rows.
begin;
set local lock_timeout = '3s';

create function public.get_mydancr_tv_metric_counts(p_video_ids uuid[], p_since timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set timezone = 'UTC'
as $function$
declare
  v_counts jsonb;
begin
  if p_video_ids is null or cardinality(p_video_ids) > 100 or array_ndims(p_video_ids) > 1 then
    raise exception using errcode = '22023', message = 'Provide at most 100 video identifiers.';
  end if;
  if array_position(p_video_ids, null) is not null then
    raise exception using errcode = '22023', message = 'Video identifiers cannot be empty.';
  end if;
  if p_since is null or not isfinite(p_since)
    or p_since < statement_timestamp() - interval '31 days'
    or p_since > statement_timestamp()
  then
    raise exception using errcode = '22023', message = 'A recent metric cutoff is required.';
  end if;
  if cardinality(p_video_ids) = 0 then return '{}'::jsonb; end if;

  with selected as (
    select distinct unnest(p_video_ids) as video_id
  ), counts as (
    select event.video_id, event.event_type, count(*) as total
    from public.mydancr_tv_events event
    where event.video_id = any(p_video_ids) and event.occurred_at >= p_since
    group by event.video_id, event.event_type
  ), grouped as (
    select video_id, jsonb_object_agg(event_type, total) as metrics
    from counts group by video_id
  )
  select jsonb_object_agg(selected.video_id::text, coalesce(grouped.metrics, '{}'::jsonb))
    into v_counts
  from selected left join grouped using(video_id);
  return coalesce(v_counts, '{}'::jsonb);
end;
$function$;

revoke all on function public.get_mydancr_tv_metric_counts(uuid[],timestamptz) from public, anon, authenticated;
grant execute on function public.get_mydancr_tv_metric_counts(uuid[],timestamptz) to service_role;
commit;
