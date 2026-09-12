// Supplement the existing function/row-policy/grant catalog with schema and
// type boundaries that a privilege-only comparison would otherwise miss.
export function privacyGuardDelimiter(...values) {
  const content = values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n');
  let suffix = 0;
  let delimiter = '$privacy_guard$';
  while (content.includes(delimiter)) delimiter = '$privacy_guard_' + (++suffix) + '$';
  return delimiter;
}

export function privacyCatalogMetadataSql(base) {
  return `select (${base}) || jsonb_build_object(
    'schemas',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',nspowner,'acl',nspacl::text)order by nspname)from pg_namespace where nspname in('public','auth','storage')),
    'types',(select jsonb_agg(to_jsonb(t)order by t.oid)from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in('public','auth','storage')),
    'enums',(select jsonb_agg(to_jsonb(e)order by e.enumtypid,e.enumsortorder)from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname in('public','auth','storage')),
    'default_privileges',(select jsonb_agg(to_jsonb(d)order by d.oid)from pg_default_acl d),
    'extensions',(select jsonb_agg(to_jsonb(e)order by e.oid)from pg_extension e)
  )metadata`;
}
