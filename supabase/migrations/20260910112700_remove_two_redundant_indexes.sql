-- Preserve the unique constraints that fully cover these ordinary indexes.
-- Refuse drift; never remove dependencies or modify rows to make this apply.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

lock table public.club_invoice_items, public.venues in access exclusive mode;

do $indexes$
declare
  pair record;
  redundant oid;
  covering oid;
begin
  for pair in select * from (values
    ('club_invoice_items', 'revenue_event_id', 'club_invoice_items_revenue_idx', 'club_invoice_items_revenue_event_once_key'),
    ('venues', 'owner_user_id', 'venues_owner_user_id_idx', 'venues_owner_user_id_key')
  ) as pairs(table_name, column_name, redundant_name, covering_name)
  loop
    covering := to_regclass('public.' || pair.covering_name);
    redundant := to_regclass('public.' || pair.redundant_name);
    if covering is null or not exists (
      select 1 from pg_index i
      join pg_constraint c on c.conindid = i.indexrelid
      where i.indexrelid = covering
        and i.indrelid = to_regclass('public.' || pair.table_name)
        and i.indisunique and i.indisvalid and i.indisready and i.indislive
        and not i.indisprimary and not i.indisexclusion
        and c.contype = 'u' and c.conname = pair.covering_name
        and c.conrelid = i.indrelid and c.convalidated and not c.condeferrable
        and pg_get_indexdef(i.indexrelid) = format(
          'CREATE UNIQUE INDEX %s ON public.%s USING btree (%s)',
          pair.covering_name, pair.table_name, pair.column_name)
    ) then
      raise exception 'Required covering unique index changed: %', pair.covering_name;
    end if;
    if redundant is not null then
      if not exists (
        select 1 from pg_index a join pg_index b on b.indexrelid = covering
        join pg_class x on x.oid = a.indexrelid
        join pg_class y on y.oid = b.indexrelid
        where a.indexrelid = redundant and a.indrelid = b.indrelid
          and not a.indisunique and not a.indisprimary and not a.indisexclusion
          and not a.indisreplident and not a.indisclustered
          and a.indisvalid and a.indisready and a.indislive
          and a.indkey = b.indkey and a.indclass = b.indclass
          and a.indcollation = b.indcollation and a.indoption = b.indoption
          and a.indnkeyatts = b.indnkeyatts and a.indnatts = b.indnatts
          and a.indnullsnotdistinct = b.indnullsnotdistinct
          and a.indpred is null and b.indpred is null
          and a.indexprs is null and b.indexprs is null
          and x.relam = y.relam and x.relkind = 'i' and y.relkind = 'i'
          and x.reltablespace = y.reltablespace
          and x.reloptions is not distinct from y.reloptions
          and pg_get_indexdef(a.indexrelid) = format(
            'CREATE INDEX %s ON public.%s USING btree (%s)',
            pair.redundant_name, pair.table_name, pair.column_name)
      ) or exists (select 1 from pg_constraint where conindid = redundant)
        or exists (select 1 from pg_depend where refclassid = 'pg_class'::regclass and refobjid = redundant)
      then
        raise exception 'Redundant index no longer safe to remove: %', pair.redundant_name;
      end if;
    end if;
  end loop;
end;
$indexes$;

drop index if exists public.club_invoice_items_revenue_idx restrict;
drop index if exists public.venues_owner_user_id_idx restrict;

commit;
