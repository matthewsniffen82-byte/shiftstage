begin;
-- The worker reads report existence to protect active pickup case material.
-- This grants no public access and no report deletion or editing privilege.
grant select on public.pickup_reports to service_role;
commit;
