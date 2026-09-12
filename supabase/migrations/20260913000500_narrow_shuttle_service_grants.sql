-- Supabase may grant service_role ALL through its table default privileges.
-- Remove inherited table grants before allowing only receipt creation/handoff.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
revoke all on public.club_shuttle_requests from service_role;
grant select, insert on public.club_shuttle_requests to service_role;
grant update (handed_off_at) on public.club_shuttle_requests to service_role;
commit;
