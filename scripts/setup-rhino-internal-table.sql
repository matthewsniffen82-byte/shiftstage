-- Operator setup for the club confirmed by the user on 2026-10-29.
-- Enables the existing authenticated dashboard preview. Physical NFC tags
-- still require Admin programming; no guest grants or tags are created here.
-- Rehearse with the final COMMIT replaced by ROLLBACK before applying.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $setup$
declare
  rhino_id constant uuid := '103e9b1b-77b5-43d2-9eb8-88aa11ed906d';
begin
  -- Use the same venue lock as Admin table provisioning to serialize setup.
  perform 1 from public.venues v
    join public.app_users u on u.id = v.owner_user_id
    where v.id = rhino_id and v.name = 'Spearmint Rhino'
      and v.slug = 'spearmint-rhino' and v.city = 'Las Vegas'
      and v.is_active and u.role = 'venue' and u.account_state = 'active'
    for update of v, u;
  if not found then
    raise exception 'Expected the active Spearmint Rhino club and owner';
  end if;

  -- Preserve any setup already completed by Admin, including renamed tables.
  if exists (select 1 from public.internal_roster_links
    where venue_id = rhino_id and kind = 'table' and active) then
    return;
  end if;
  -- A replay must not undo a deliberate revocation or replace legacy links.
  if exists (select 1 from public.internal_roster_links where venue_id = rhino_id) then
    raise exception 'Existing inactive or legacy Rhino links require Admin review';
  end if;

  insert into public.internal_roster_links (venue_id, kind, label)
    values (rhino_id, 'table', 'Table 1');
end $setup$;

-- Confirm setup without exposing the table capability token.
select v.name, l.label, l.active, l.kind,
  (l.token::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') as valid_token
from public.internal_roster_links l join public.venues v on v.id = l.venue_id
where v.id = '103e9b1b-77b5-43d2-9eb8-88aa11ed906d' and l.kind = 'table' and l.active
order by l.created_at, l.id;
commit;
