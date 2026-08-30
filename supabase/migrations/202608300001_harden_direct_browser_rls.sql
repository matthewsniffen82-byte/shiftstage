begin;

-- Public analytics and report writes are validated, rate-limited, and attributed
-- by server routes. Authenticated browser sessions must not bypass those routes by
-- writing directly through PostgREST.
revoke insert on table public.profile_views from anon, authenticated;
revoke insert on table public.schedule_views from anon, authenticated;
revoke insert on table public.direction_requests from anon, authenticated;
revoke insert on table public.social_clicks from anon, authenticated;
revoke insert on table public.content_reports from anon, authenticated;

drop policy if exists "insert public profile views" on public.profile_views;
drop policy if exists "insert public schedule views" on public.schedule_views;
drop policy if exists "insert public direction requests" on public.direction_requests;
drop policy if exists "insert public social clicks" on public.social_clicks;
drop policy if exists "users create content reports" on public.content_reports;

-- The public DMCA page reads the designated-agent record through a server-only
-- client. Anonymous PostgREST callers do not need direct table access.
revoke select on table public.dmca_agent_settings from anon;
drop policy if exists "public reads dmca agent settings" on public.dmca_agent_settings;

commit;
