-- Private, versioned score summaries. Public visibility is still checked by
-- discovery before scores are applied; this table is never a public data API.
begin;
set local lock_timeout = '3s';
create table public.venue_performance_score_cache (
  venue_id uuid not null references public.venues(id) on delete cascade,
  score_version text not null check (length(score_version) between 1 and 120),
  computed_at timestamptz not null,
  scores jsonb not null check (jsonb_typeof(scores) = 'array'),
  primary key (venue_id, score_version)
);
alter table public.venue_performance_score_cache enable row level security;
revoke all on public.venue_performance_score_cache from public, anon, authenticated, service_role;
grant select on public.venue_performance_score_cache to service_role;

create function public.store_venue_performance_scores(p_venue_id uuid, p_version text, p_computed_at timestamptz, p_scores jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.venue_performance_score_cache(venue_id, score_version, computed_at, scores)
  values(p_venue_id, p_version, p_computed_at, p_scores)
  on conflict(venue_id, score_version) do update
    set computed_at = excluded.computed_at, scores = excluded.scores
    where venue_performance_score_cache.computed_at <= excluded.computed_at;
$$;
revoke all on function public.store_venue_performance_scores(uuid,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.store_venue_performance_scores(uuid,text,timestamptz,jsonb) to service_role;

-- Keep the existing nullable-version uniqueness contract; a surrogate key adds
-- stable row identity without changing how repeated consent is deduplicated.
alter table public.account_terms_acceptances add column id bigint generated always as identity;
alter table public.account_terms_acceptances add primary key (id);
commit;
