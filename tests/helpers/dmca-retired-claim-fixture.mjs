import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const retiredClaimFunction=JSON.parse(readFileSync(new URL('../fixtures/dmca-retired-claim-function.json',import.meta.url),'utf8'));
export const retiredClaimSchema=JSON.parse(readFileSync(new URL('../fixtures/dmca-retired-claim-schema.json',import.meta.url),'utf8'));
export const retiredClaimTables=['public.venue_ownership_claims','public.venue_claim_codes'];
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function installRetiredClaimFixture(db){
 const schema=retiredClaimSchema,retired=retiredClaimFunction;
 await db.exec('create table public.venue_claim_codes(id uuid primary key)');
 const definitions=[],dropped=[];let position=1;
 for(const c of schema.columns){while(position<c.ordinal_position){const name='fixture_removed_position_'+position++;definitions.push(quote(name)+' text');dropped.push(name);}assert.equal(position++,c.ordinal_position);definitions.push(quote(c.column_name)+' '+c.formatted_type+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':''));}
 await db.exec('create table public.venue_ownership_claims('+definitions.join(',')+')');
 for(const name of dropped)await db.exec('alter table public.venue_ownership_claims drop column '+quote(name));
 const nativeColumns=(await db.query("select attname as column_name,format_type(atttypid,atttypmod)as formatted_type,atttypmod as type_modifier from pg_attribute where attrelid='public.venue_ownership_claims'::regclass and attnum>0 and not attisdropped order by attnum")).rows;
 assert.deepEqual(nativeColumns,schema.columns.map(c=>({column_name:c.column_name,formatted_type:c.formatted_type,type_modifier:c.type_modifier})),'Every current retired claim type and modifier');
 for(const type of ['p','u','c','f'])for(const c of schema.constraints.filter(c=>c.type===type))await db.exec('alter table public.venue_ownership_claims add constraint '+quote(c.name)+' '+c.definition+(c.validated?'':' not valid'));
 const keys=new Set(schema.constraints.map(c=>c.name));for(const i of schema.indexes)if(!keys.has(i.indexname))await db.exec(i.indexdef);
 for(const p of schema.policies)await db.exec('create policy '+quote(p.policyname)+' on public.venue_ownership_claims as '+p.permissive+' for '+p.cmd+' to '+p.roles.map(quote).join(',')+(p.qual?' using('+p.qual+')':'')+(p.with_check?' with check('+p.with_check+')':''));
 if(schema.relation.rls)await db.exec('alter table public.venue_ownership_claims enable row level security');if(schema.relation.force_rls)await db.exec('alter table public.venue_ownership_claims force row level security');
 const access=schema.tableAccess;assert.ok(access);assert.equal(schema.columnAccess.length,schema.columns.length);
 await db.exec('revoke all on public.venue_ownership_claims from public,postgres,anon,authenticated,service_role');
 for(const entry of access.acl.slice(1,-1).split(',').filter(Boolean)){
  const parts=/^([^=]*)=((?:[arwdDxtm]\*?)*)\/postgres$/.exec(entry);assert.ok(parts,'Unsupported captured claim grant');
  const role=parts[1];assert.ok(['','postgres','anon','authenticated','service_role'].includes(role));
  for(const privilege of parts[2].match(/[arwdDxtm]\*?/g)||[]){
   const right={r:'select',a:'insert',w:'update',d:'delete',D:'truncate',x:'references',t:'trigger',m:'maintain'}[privilege[0]];
   await db.exec('grant '+right+' on public.venue_ownership_claims to '+(role?quote(role):'public')+(privilege.endsWith('*')?' with grant option':''));
  }
 }
 assert.equal((await db.query("select relacl::text acl from pg_class where oid='public.venue_ownership_claims'::regclass")).rows[0].acl,access.acl);
 for(const[role,rights]of Object.entries(access.effective))for(const[right,allowed]of Object.entries(rights))assert.equal((await db.query("select has_table_privilege($1,'public.venue_ownership_claims',$2)allowed",[role,right])).rows[0].allowed,allowed);
 for(const c of schema.columnAccess){
  assert.equal(c.acl,null,'A changed explicit column grant needs a new fixture review');
  assert.equal((await db.query("select attacl::text acl from pg_attribute where attrelid='public.venue_ownership_claims'::regclass and attname=$1",[c.column])).rows[0].acl,null);
  for(const[role,prefix]of [['anon','anon'],['authenticated','authenticated'],['service_role','service']])for(const right of ['select','insert','update'])assert.equal((await db.query("select has_column_privilege($1,'public.venue_ownership_claims',$2,$3)allowed",[role,c.column,right])).rows[0].allowed,c[prefix+'_'+right]);
 }
 // Return type and complete claim fields are real captured metadata. Body
 // validation remains deferred because old approval behavior is not exercised.
 await db.exec('set check_function_bodies=false;'+retired.definition+';set check_function_bodies=true;revoke all on function public.'+retired.signature+' from public,anon,authenticated;grant execute on function public.'+retired.signature+' to service_role');
 assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',['public.'+retired.signature])).rows[0].hash,retired.fingerprint);
 const nativeFunction=(await db.query("select pg_get_userbyid(proowner)owner,proacl::text acl,proconfig settings,prosecdef security_definer,has_function_privilege('anon',oid,'execute')anon,has_function_privilege('authenticated',oid,'execute')authenticated,has_function_privilege('service_role',oid,'execute')service from pg_proc where oid=$1::regprocedure",['public.'+retired.signature])).rows[0];
 for(const key of Object.keys(nativeFunction))assert.deepEqual(nativeFunction[key],retired[key],'Exact retired function security: '+key);
}
export async function seedRetiredClaimHistory(db){
 const id=n=>'a1700000-0000-4000-8000-'+String(n).padStart(12,'0');
 await db.exec('reset role');
 await db.query('insert into auth.users(id)values($1)',[id(5)]);
 await db.query("insert into public.app_users(id,role,display_name,email)values($1,'venue','Synthetic legacy claimant','legacy@example.invalid')",[id(5)]);
 await db.query("insert into public.venues(id,name,owner_user_id,slug,city)values($1,'Synthetic legacy venue',$2,'synthetic-legacy-venue','Las Vegas')",[id(40),id(5)]);
 await db.query('insert into public.venue_claim_codes(id)values($1)',[id(50)]);
 await db.query("insert into public.venue_ownership_claims(id,venue_id,claim_code_id,claimant_user_id,claimant_email,claimant_name,claimant_title,claimant_phone,proof_file_name,proof_mime_type,request_ip_hash,status,reviewed_by,reviewed_at)values($1,$2,$3,$4,'legacy@example.invalid','Synthetic claimant','Manager','5555555555','synthetic.pdf','application/pdf','synthetic','rejected',$5,'2026-01-01Z')",[id(250),id(40),id(50),id(5),id(2)]);
 await db.exec('set role service_role');
}
