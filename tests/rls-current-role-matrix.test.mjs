import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test,{before,after} from 'node:test';
import {asIdentity,catalog as baseline,createPolicyDatabase,deniedOrEmpty,ids,preferenceTables,quote} from './helpers/rls-database.mjs';

const snapshot=JSON.parse(readFileSync(new URL('./fixtures/rls-current-access.json',import.meta.url),'utf8'));
const columnKey=c=>`${c.table_schema}.${c.table_name}.${c.column_name}`;
const replacements=new Map(snapshot.changedColumns.map(c=>[columnKey(c),c]));
const columns=baseline.columns.filter(c=>!snapshot.removedColumns.includes(columnKey(c))).map(c=>replacements.get(columnKey(c))||c);
for(const c of snapshot.changedColumns)if(!columns.some(old=>columnKey(old)===columnKey(c)))columns.push(c);
const enums=baseline.enums.map(e=>snapshot.changedEnums.find(n=>n.schema_name===e.schema_name&&n.name===e.name)||e);
const catalog={...baseline,relations:snapshot.relations,policies:snapshot.policies,views:snapshot.views,columns,enums};
const tables=catalog.relations.filter(t=>t.kind==='r');
const dancer='10000000-0000-4000-8000-000000000005',venue='10000000-0000-4000-8000-000000000006';
const strangers=[['anonymous','anon',null],['customer','authenticated',ids.other],['dancer','authenticated',dancer],['venue','authenticated',venue]];
let db;
before(async()=>{
 db=await createPolicyDatabase({applyCurrentMigration:false,catalogSnapshot:catalog,columnGrantSnapshot:snapshot.columnGrants,helperDefinitions:snapshot.helpers});
 await db.query("insert into app_users(id,role,account_state) values($1,'dancer','active'),($2,'venue','active')",[dancer,venue]);
 await db.query("insert into dancer_profiles(id,user_id,status,is_public) values($1,$1,'draft',false)",[dancer]);
 await db.query('insert into venues(id,owner_user_id,is_active) values($1,$1,false)',[venue]);
});
after(async()=>db?.close());

test('the current fixture uses all captured policies, view security and column grants',async()=>{
 assert.equal(tables.length,81);assert.equal(snapshot.policies.length,140);
 const actual=(await db.query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname")).rows;
 const shape=p=>[p.tablename,p.policyname,p.permissive,Array.from(p.roles).sort().join(','),p.cmd,p.qual?.replace(/\s+/g,' ').trim()||null,p.with_check?.replace(/\s+/g,' ').trim()||null];
 const ordered=rows=>rows.map(shape).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 assert.deepEqual(ordered(actual),ordered(snapshot.policies));
 const grants=(await db.query("select c.relname as table,a.attname as column,r.rolname as role,x.privilege_type as privilege from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) x join pg_roles r on r.oid=x.grantee where n.nspname='public' and a.attnum>0 and not a.attisdropped and r.rolname in('anon','authenticated','service_role') order by c.relname,a.attname,r.rolname")).rows;
 assert.deepEqual(grants,snapshot.columnGrants);
 for(const relation of snapshot.relations){
  const options=(await db.query("select reloptions from pg_class where oid=$1::regclass",[`public.${relation.name}`])).rows[0].reloptions;
  assert.deepEqual(options||[],relation.options||[],`${relation.name} view/security options`);
  for(const [role,commands] of Object.entries(relation.grants))for(const [command,allowed] of Object.entries(commands)){
   // Views are read-only fixtures; base-table privileges reproduce every CRUD grant.
   if(relation.kind==='v'&&command!=='select')continue;
   assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',[role,`public.${relation.name}`,command])).rows[0].allowed,allowed,`${role} ${command} ${relation.name}`);
  }
 }
 assert.equal((await db.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")).rows[0].n,81);
 for(const helper of snapshot.helpers){
  const definition=(await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[`public.${helper.name}()`])).rows[0].prosrc;
  assert.equal(definition,helper.definition.split('$function$')[1]);
 }
 for(const role of snapshot.roles){assert.equal(role.superuser,false);assert.equal(role.can_login,false);assert.equal(role.create_role,false);assert.equal(role.create_db,false);assert.equal(role.bypass_rls,role.name==='service_role');}
});
for(const table of tables){
 test(`current RLS isolates private ${table.name} from anonymous, customer, dancer and venue outsiders`,async()=>{
  const fields=catalog.columns.filter(c=>c.table_schema==='public'&&c.table_name===table.name);
  const owner=fields.find(c=>c.udt_name==='uuid');const predicate=owner?`${quote(owner.column_name)}='${ids.owner}'`:'true';
  const target=`public.${quote(table.name)}`;
  // Every negative SELECT targets a real synthetic row visible to the trusted service role.
  assert.ok((await asIdentity(db,'service_role',null,()=>db.query(`select 1 from ${target} where ${predicate}`))).rows.length>0);
  for(const [label,role,user] of strangers){
   const statements=[
    `select 1 from ${target} where ${predicate}`,
    `update ${target} set ${quote(fields[0].column_name)}=${quote(fields[0].column_name)} where ${predicate} returning 1`,
    `delete from ${target} where ${predicate} returning 1`,
    `insert into ${target} (${quote(fields[0].column_name)}) values (${fields[0].udt_name==='uuid'?`'${ids.owner}'`:'null'}) returning 1`,
   ];
   for(const sql of statements)assert.equal(await asIdentity(db,role,user,()=>deniedOrEmpty(()=>db.query(sql))),true,`${label}: ${sql.split(' ')[0]}`);
  }
 });
}
test('current owner and venue reads preserve intentional self-service access',async()=>{
 for(const table of ['app_users','customer_profiles','favorites','follows','going_signals','venue_follows','support_threads','support_messages','notifications']){
  assert.ok((await asIdentity(db,'authenticated',ids.owner,()=>db.query(`select 1 from public.${quote(table)}`))).rows.length>0,table);
 }
 assert.equal((await asIdentity(db,'authenticated',dancer,()=>db.query('select id from dancer_profiles where id=$1',[dancer]))).rows.length,1);
 assert.equal((await asIdentity(db,'authenticated',venue,()=>db.query('select id from venues where id=$1',[venue]))).rows.length,1);
});
test('only an active database administrator can read audit history and browsers cannot forge that history',async()=>{
 assert.equal((await asIdentity(db,'authenticated',ids.admin,()=>db.query('select 1 from admin_actions'))).rows.length,1);
 for(const user of [ids.admin,ids.owner,dancer,venue]){
  for(const sql of ["insert into admin_actions(id) values('20000000-0000-4000-8000-000000000099')",'update admin_actions set id=id','delete from admin_actions']){
   assert.equal(await asIdentity(db,'authenticated',user,()=>deniedOrEmpty(()=>db.query(sql))),true);
  }
 }
 await asIdentity(db,'authenticated',dancer,async()=>{
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:dancer,role:'authenticated',user_metadata:{role:'admin'}})]);
  assert.equal((await db.query('select is_admin() as allowed')).rows[0].allowed,false);
 });
 await db.query("update app_users set account_state='disabled' where id=$1",[ids.admin]);
 try{assert.equal((await asIdentity(db,'authenticated',ids.admin,()=>db.query('select 1 from admin_actions'))).rows.length,0);}
 finally{await db.query("update app_users set account_state='active' where id=$1",[ids.admin]);}
});
test('ordinary roles cannot escalate accounts, publish dancers or change media approvals',async()=>{
 for(const user of [ids.owner,dancer,venue])for(const sql of ["update app_users set role='admin'","update dancer_profiles set status='approved'","update dancer_photos set review_status='approved'","update mydancr_tv_videos set status='approved'"]){
  assert.equal(await asIdentity(db,'authenticated',user,()=>deniedOrEmpty(()=>db.query(sql))),true);
 }
});
test('private fields and the private analytics view remain unavailable even to signed-in owners',async()=>{
 for(const [role,user] of [['anon',null],['authenticated',ids.owner],['authenticated',dancer],['authenticated',venue]]){
  for(const sql of ['select real_name from dancer_profiles','select * from dancer_monthly_impact']){
   assert.equal(await asIdentity(db,role,user,()=>deniedOrEmpty(()=>db.query(sql))),true);
  }
 }
});
test('current public profile visibility permits published fields and removes hidden profiles',async()=>{
 await db.query("update dancer_profiles set status='approved',verification_status='approved',photo_review_status='approved',venue_approved_at=now(),is_public=true where id=$1",[dancer]);
 try{
  for(const table of ['dancer_profiles','public_dancer_profiles'])assert.equal((await asIdentity(db,'anon',null,()=>db.query(`select id from ${table} where id=$1`,[dancer]))).rows.length,1);
  await db.query('update dancer_profiles set is_public=false where id=$1',[dancer]);
  assert.equal((await asIdentity(db,'anon',null,()=>db.query('select id from public_dancer_profiles where id=$1',[dancer]))).rows.length,0);
 }finally{await db.query("update dancer_profiles set status='draft',verification_status=null,photo_review_status=null,venue_approved_at=null,is_public=false where id=$1",[dancer]);}
});
for(const table of preferenceTables){
 test(`current ${table} owner writes cannot transfer ownership and disabled owners cannot write`,async()=>{
  const key=table==='customer_profiles'?'user_id':'customer_id',target=`public.${quote(table)}`;
  assert.ok((await asIdentity(db,'authenticated',ids.owner,()=>db.query(`update ${target} set ${key}=${key} where ${key}=$1 returning 1`,[ids.owner]))).rows.length>0);
  assert.equal(await asIdentity(db,'authenticated',ids.owner,()=>deniedOrEmpty(()=>db.query(`update ${target} set ${key}=$1 where ${key}=$2 returning 1`,[ids.other,ids.owner]))),true);
  await db.query("update app_users set account_state='disabled' where id=$1",[ids.owner]);
  try{assert.equal(await asIdentity(db,'authenticated',ids.owner,()=>deniedOrEmpty(()=>db.query(`update ${target} set ${key}=${key} where ${key}=$1 returning 1`,[ids.owner]))),true);}
  finally{await db.query("update app_users set account_state='active' where id=$1",[ids.owner]);}
 });
}

for (const table of ['gallery_media_reference_history', 'gallery_storage_retirements']) {
 test('current ' + table + ' receipts are readable but cannot be forged by the service role', async () => {
  const target = 'public.' + quote(table);
  assert.ok((await asIdentity(db, 'service_role', null, () => db.query('select 1 from ' + target))).rows.length > 0);
  for (const sql of ['insert into ' + target + ' default values returning 1', 'update ' + target + ' set profile_id=profile_id returning 1', 'delete from ' + target + ' returning 1']) {
   assert.equal(await asIdentity(db, 'service_role', null, () => deniedOrEmpty(() => db.query(sql))), true);
  }
 });
}
