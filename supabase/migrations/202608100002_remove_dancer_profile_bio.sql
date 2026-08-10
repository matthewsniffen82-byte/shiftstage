begin;

-- MyDancr dancer profiles intentionally have no biography field. Rebuild the
-- public view first so PostgreSQL can safely remove the legacy column.
drop view if exists public.public_dancer_profiles;

alter table public.dancer_profiles
  drop column if exists bio;

create view public.public_dancer_profiles as
select
  dp.id,
  dp.stage_name,
  dp.slug,
  dp.city,
  dp.approved_at,
  ts.rank,
  ts.score,
  ts.trend
from public.dancer_profiles dp
left join public.trending_scores ts on ts.dancer_id = dp.id
where (dp.status = 'approved' or dp.verification_status = 'approved')
  and dp.status not in ('rejected', 'disabled')
  and dp.is_public = true
  and dp.disabled_at is null;

grant select on public.public_dancer_profiles to anon, authenticated;

comment on view public.public_dancer_profiles is
  'Public dancer discovery fields. Dancer biographies are intentionally unsupported.';

notify pgrst, 'reload schema';

commit;
