import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/** Build reviewed application DDL from a schema-only Postgres catalog export. */
export function applicationBaselineSql(source) {
const q=s=>'"'+s.replaceAll('"','""')+'"';
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const role=s=>s==='PUBLIC'?'PUBLIC':q(s);
const relation=name=>'public.'+q(name);
const signature=s=>s.startsWith('public.')?s:'public.'+s;
assert.equal(source.domains.length,0);
assert(source.relations.every(r=>['r','v'].includes(r.kind)&&r.owner==='postgres'));
assert(source.functions.every(f=>f.owner==='postgres'&&/^CREATE OR REPLACE FUNCTION /i.test(f.definition)));
assert(source.columns.every(c=>!c.generated));
assert(source.sequences.every(s=>s.dependency_kind==='i'));
assert(source.type_grants.every(g=>g.owner==='postgres'));
const tables=source.relations.filter(r=>r.kind==='r');
const views=source.relations.filter(r=>r.kind==='v');
const grantees=[...new Set(['PUBLIC','postgres','anon','authenticated','service_role',...source.default_grantees,...source.relation_grants.map(g=>g.grantee),...source.column_grants.map(g=>g.grantee),...source.function_grants.map(g=>g.grantee),...source.type_grants.map(g=>g.grantee)])];
const allRoles=grantees.map(role).join(',');
const lines=[];
lines.push('-- Reconstruct application objects only. Auth/Storage services, data and the migration ledger remain platform prerequisites.');
lines.push('set local check_function_bodies=off;');
for(const e of source.enums)lines.push(`create type ${relation(e.name)} as enum (${e.labels.map(literal).join(',')});`);
for(const table of tables){
 const holes=[];
 let ordinal=0;
 const columns=source.columns.filter(c=>c.table_name===table.name).flatMap(c=>{
  const skipped=[];
  while(++ordinal<c.position){const name='recovery_dropped_slot_'+ordinal;holes.push(name);skipped.push(q(name)+' text');}
  let ddl=q(c.name)+' '+c.type+(c.collation?' collate '+c.collation:'');
  if(c.identity_kind){
   const s=source.sequences.find(s=>s.owner_table===table.name&&s.owner_column===c.name);
   assert(s,'Missing identity sequence');
   for(const value of [s.start,s.increment,s.min,s.max,s.cache])assert(/^-?\d+$/.test(value));
   ddl+=` generated ${c.identity_kind==='a'?'always':'by default'} as identity (sequence name ${relation(s.name)} start with ${s.start} increment by ${s.increment} minvalue ${s.min} maxvalue ${s.max} cache ${s.cache} ${s.cycle?'cycle':'no cycle'})`;
  }
  if(c.not_null)ddl+=' not null';
  return [...skipped,ddl];
 });
 lines.push(`create ${table.persistence==='u'?'unlogged ':''}table ${relation(table.name)} (${columns.join(',\n')})${table.options?.length?' with ('+table.options.join(',')+')':''};`);
 for(const hole of holes)lines.push(`alter table ${relation(table.name)} drop column ${q(hole)};`);
}
for(const f of source.functions)lines.push(f.definition+';');
for(const c of source.columns.filter(c=>c.default_value&&!c.identity_kind))lines.push(`alter table ${relation(c.table_name)} alter column ${q(c.name)} set default ${c.default_value};`);
for(const foreign of [false,true])for(const c of source.constraints.filter(c=>(c.kind==='f')===foreign))lines.push(`alter table ${relation(c.table_name)} add constraint ${q(c.name)} ${c.definition};`);
for(const index of source.indexes)lines.push(index.definition+';');
for(const view of views)lines.push(`create view ${relation(view.name)}${view.options?.length?' with ('+view.options.join(',')+')':''} as ${view.view_definition.replace(/;\s*$/,'')};`);
for(const p of source.policies)lines.push(`create policy ${q(p.policyname)} on ${q(p.schemaname)}.${q(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(role).join(',')}${p.qual?' using ('+p.qual+')':''}${p.with_check?' with check ('+p.with_check+')':''};`);
for(const table of tables)lines.push(`alter table ${relation(table.name)} ${table.rls?'enable':'disable'} row level security; alter table ${relation(table.name)} ${table.force_rls?'force':'no force'} row level security;`);
for(const trigger of source.triggers){
 lines.push(trigger.definition+';');
 if(trigger.enabled!=='O')lines.push(`alter table ${q(trigger.schema_name)}.${q(trigger.table_name)} ${trigger.enabled==='D'?'disable':trigger.enabled==='R'?'enable replica':'enable always'} trigger ${q(trigger.name)};`);
}
for(const object of [...source.relations,...source.sequences.map(s=>({name:s.name,kind:'S'}))])lines.push(`revoke all on ${object.kind==='S'?'sequence':'table'} ${relation(object.name)} from ${allRoles};`);
for(const f of source.functions)lines.push(`revoke all on function ${signature(f.signature)} from ${allRoles};`);
for(const e of source.enums)lines.push(`revoke all on type ${relation(e.name)} from ${allRoles};`);
for(const g of source.relation_grants)lines.push(`grant ${g.privilege_type} on ${g.kind==='S'?'sequence':'table'} ${relation(g.name)} to ${role(g.grantee)}${g.is_grantable?' with grant option':''};`);
for(const g of source.column_grants)lines.push(`grant ${g.privilege_type} (${q(g.column_name)}) on ${relation(g.table_name)} to ${role(g.grantee)}${g.is_grantable?' with grant option':''};`);
for(const g of source.function_grants)lines.push(`grant ${g.privilege_type} on function ${signature(g.signature)} to ${role(g.grantee)}${g.is_grantable?' with grant option':''};`);
for(const g of source.type_grants)lines.push(`grant ${g.privilege_type} on type ${relation(g.name)} to ${role(g.grantee)}${g.is_grantable?' with grant option':''};`);

const kind = {r:'tables', S:'sequences', f:'functions', T:'types', n:'schemas'};
for (const group of source.default_acl) {
  assert.equal(group.owner, 'postgres'); assert.ok(kind[group.kind]);
  assert.ok(group.schema_name === '' || group.schema_name === 'public');
  const scope = group.schema_name ? ' in schema '+q(group.schema_name) : '';
  lines.push('alter default privileges for role postgres'+scope+' revoke all on '+kind[group.kind]+' from '+allRoles+';');
}
for (const g of source.default_privileges) {
  const scope = g.schema_name ? ' in schema '+q(g.schema_name) : '';
  lines.push('alter default privileges for role postgres'+scope+' grant '+g.privilege_type+' on '+kind[g.kind]+' to '+role(g.grantee)+(g.is_grantable?' with grant option':'')+';');
}
const schemaRoles=[...new Set(source.schema_grants.map(g=>g.grantee))].map(role).join(',');
lines.push('revoke all on schema public from '+schemaRoles+';');
for(const g of source.schema_grants)lines.push('grant '+g.privilege_type+' on schema public to '+role(g.grantee)+(g.is_grantable?' with grant option':'')+';');
assert.equal(source.storage_column_grants.length,0,'Storage column ACLs require explicit review');
const applicationStorageGrants=source.storage_grants.filter(g=>!['postgres','supabase_storage_admin'].includes(g.grantee));
const storageRoles=[...new Set(['PUBLIC',...applicationStorageGrants.map(g=>g.grantee)])].map(role).join(',');
for(const table of ['objects','buckets'])lines.push('revoke all on storage.'+q(table)+' from '+storageRoles+';');
for(const g of applicationStorageGrants)lines.push('grant '+g.privilege_type+' on storage.'+q(g.name)+' to '+role(g.grantee)+(g.is_grantable?' with grant option':'')+';');
for(const bucket of source.buckets) {
  const mime=bucket.allowed_mime_types === null ? 'null' : 'array['+bucket.allowed_mime_types.map(literal).join(',')+']::text[]';
  assert.ok(bucket.file_size_limit === null || Number.isSafeInteger(bucket.file_size_limit));
  lines.push('insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('+[literal(bucket.id),literal(bucket.name),String(bucket.public),bucket.file_size_limit??'null',mime].join(',')+') on conflict(id) do update set name=excluded.name,public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;');
}
return lines.join('\n')+'\n';
}

export function normalizeBaselineCatalog(catalog) {
  const result = structuredClone(catalog);
  for (const key of ['captured_at','read_only','ledger']) delete result[key];
  result.default_acl = result.default_acl.map(({acl,...row})=>({...row,empty:acl==='{}'}));
  result.relations = result.relations.map(({object_oid: _oid,...row})=>row);
  result.default_grantees.sort();
  // Managed Storage may grant the same permission through multiple grantors.
  // Compare effective privileges; application grants still compare individually.
  result.storage_grants = [...new Map(result.storage_grants.map(row=>[stableCatalogJson(row),row])).values()];
  // ACL expansion order is not a schema property. Sort equal-priority grants.
  for (const key of ['storage_grants', 'schema_grants', 'default_privileges']) result[key].sort((a,b)=>stableCatalogJson(a).localeCompare(stableCatalogJson(b), 'en'));
  const old='CHECK ((((width >= 240) AND (width <= 4320)) AND ((height >= width) AND (height <= 7680))))';
  const canonical='CHECK (((width >= 240) AND (width <= 4320) AND ((height >= width) AND (height <= 7680))))';
  result.constraints = result.constraints.map(row=>row.table_name==='mydancr_tv_videos' && row.name==='mydancr_tv_dimensions_check' && row.definition===old ? {...row,definition:canonical} : row);
  return result;
}
export function stableCatalogJson(value) {
  if(Array.isArray(value))return '['+value.map(stableCatalogJson).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableCatalogJson(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export const baselineDigest = value => createHash('sha256').update(typeof value==='string'?value.replace(/\r\n?/g,'\n'):stableCatalogJson(value)).digest('hex');
