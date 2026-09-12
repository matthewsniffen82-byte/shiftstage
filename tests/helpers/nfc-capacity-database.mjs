import{readFileSync}from'node:fs';
import{PGlite}from'@electric-sql/pglite';
export const nfcCapacitySchema=JSON.parse(readFileSync(new URL('../fixtures/nfc-capacity-schema.json',import.meta.url),'utf8'));
export const nfcCapacityMigrationPath='supabase/migrations/20260912054100_enforce_active_nfc_sticker_capacity.sql';
export const nfcCapacityMigration=readFileSync(new URL('../../supabase/migrations/20260912054100_enforce_active_nfc_sticker_capacity.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
export const capId=n=>'a1500000-0000-4000-8000-'+String(n).padStart(12,'0');
export const capDigest=n=>String(n).padStart(64,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';

export async function createNfcCapacityDatabase({migrate=true}={}){
 const db=new PGlite();
 try{
  // Actual target schemas/policies and RPC definitions; control relations and
  // the auth claim accessor are explicit projections with synthetic identities.
  await db.exec(`create schema auth;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create table public.app_users(id uuid primary key,role text not null,account_state text not null);
   create table public.venues(id uuid primary key,name text not null,is_active boolean not null,owner_user_id uuid);
   create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   grant select on public.venues to anon,authenticated;
   grant all on public.app_users,public.venues to service_role;`);
  for(const table of nfcCapacitySchema.relations){
   const columns=nfcCapacitySchema.columns.filter(c=>c.table_name===table.name);
   await db.exec('create table public.'+quote(table.name)+'('+columns.map(c=>quote(c.column_name)+' '+quote(c.udt_schema)+'.'+quote(c.udt_name)+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':'')).join(',')+')');
   if(table.rls)await db.exec('alter table public.'+quote(table.name)+' enable row level security');
   for(const[role,rights]of Object.entries(table.grants)){const names=Object.entries(rights).filter(([,allow])=>allow).map(([right])=>right);if(names.length)await db.exec('grant '+names.join(',')+' on public.'+quote(table.name)+' to '+role);}
  }
  for(const foreign of[false,true])for(const c of nfcCapacitySchema.constraints.filter(c=>c.definition.startsWith('FOREIGN KEY')===foreign))await db.exec('alter table public.'+quote(c.table_name)+' add constraint '+quote(c.name)+' '+c.definition);
  const constraintNames=new Set(nfcCapacitySchema.constraints.map(c=>c.name));for(const i of nfcCapacitySchema.indexes)if(!constraintNames.has(i.indexname))await db.exec(i.indexdef);
  for(const f of nfcCapacitySchema.functions){await db.exec(f.definition+';');if(f.acl===null)continue;await db.exec('revoke all on function public.'+f.signature+' from public,anon,authenticated,service_role');for(const[role,key]of[['anon','anon'],['authenticated','authenticated'],['service_role','service']])if(f[key])await db.exec('grant execute on function public.'+f.signature+' to '+role);}
  for(const p of nfcCapacitySchema.policies)await db.exec('create policy '+quote(p.policyname)+' on public.'+quote(p.tablename)+' as '+p.permissive+' for '+p.cmd+' to '+p.roles.map(quote).join(',')+(p.qual?' using('+p.qual+')':'')+(p.with_check?' with check('+p.with_check+')':''));
  for(const t of nfcCapacitySchema.triggers)await db.exec(t.definition);
  if(migrate)await db.exec(nfcCapacityMigration);
  return db;
 }catch(error){await db.close();throw error;}
}
export async function seedNfcCapacity(db){
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);truncate public.nfc_tags,public.admin_actions,public.venues,public.app_users");
 await db.query("insert into public.app_users values($1,'admin','active'),($2,'venue','active'),($3,'customer','active'),($4,'admin','suspended')",[capId(1),capId(2),capId(3),capId(4)]);
 await db.query("insert into public.venues values($1,'Synthetic one',true,$3),($2,'Synthetic two',true,$3)",[capId(10),capId(11),capId(2)]);await db.exec('set role service_role');
}
export async function insertTags(db,{count=1,start=100,venue=capId(10),status='active',type='dressing_room'}={}){
 return(await db.query(`insert into public.nfc_tags(id,venue_id,tag_type,label,token_digest,status,created_by_user_id)
 select ('a1500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$2,'Synthetic sticker '||n,lpad(n::text,64,'0'),$3,$4 from generate_series($5::int,$6::int)n returning *`,[venue,type,status,capId(1),start,start+count-1])).rows;
}
export async function provisionTag(db,{id=200,venue=capId(10),actor=capId(1),type='dressing_room',label='Synthetic new sticker',digest=capDigest(id)}={}){return(await db.query('select * from public.provision_admin_venue_nfc_tag($1,$2,$3,$4,$5,$6)',[typeof id==='number'?capId(id):id,venue,actor,type,label,digest])).rows[0];}
export async function rotateTag(db,{id=100,replacement=300,actor=capId(1),digest=capDigest(replacement)}={}){return(await db.query('select * from public.rotate_admin_venue_nfc_tag($1,$2,$3,$4)',[capId(id),actor,capId(replacement),digest])).rows[0];}
export async function setTagStatus(db,{id=100,status='active',actor=capId(1)}={}){return(await db.query('select * from public.set_admin_venue_nfc_tag_status($1,$2,$3)',[capId(id),actor,status])).rows[0];}
export async function activeTags(db,venue=capId(10)){return(await db.query("select count(*)::int n from public.nfc_tags where venue_id=$1 and status='active'",[venue])).rows[0].n;}
export async function nfcCapacitySnapshot(db){return(await db.query("select jsonb_build_object('tags',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]')from public.nfc_tags t),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')from public.admin_actions a)) snapshot")).rows[0].snapshot;}
export async function asBrowser(db,role,id){await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);}
