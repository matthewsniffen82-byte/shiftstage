begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The live 1–30 second check already guards new writes. All 30 existing
-- videos passed the read-only exception scan. Validate without rewriting rows.
-- PostgreSQL will abort this transaction if a legacy exception is discovered.
alter table public.mydancr_tv_videos
  validate constraint mydancr_tv_duration_check;

commit;
