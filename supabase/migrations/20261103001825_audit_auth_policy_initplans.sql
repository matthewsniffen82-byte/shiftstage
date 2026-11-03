begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
-- auth.uid() is constant for a statement. Hoist only bare calls in existing
-- policies; preserve commands, roles, permissiveness and every row predicate.
do $policies$
declare p record; expression text; statement text;
begin
  for p in select * from pg_policies where schemaname='public'
    and (coalesce(qual,'') || coalesce(with_check,'')) like '%auth.uid()%'
    and (coalesce(qual,'') || coalesce(with_check,'')) not ilike '%select auth.uid()%'
  loop
    statement := format('alter policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
    if p.qual is not null then
      expression := replace(p.qual,'auth.uid()','(select auth.uid())');
      statement := statement || ' using (' || expression || ')';
    end if;
    if p.with_check is not null then
      expression := replace(p.with_check,'auth.uid()','(select auth.uid())');
      statement := statement || ' with check (' || expression || ')';
    end if;
    execute statement;
  end loop;
end $policies$;
commit;
