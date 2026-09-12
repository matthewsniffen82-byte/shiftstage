import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const schema=JSON.parse(readFileSync(new URL('../fixtures/dmca-lifecycle-current.json',import.meta.url),'utf8'));
export const id=n=>'a1700000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function database(){
 const db=new PGlite();
 try{
  await db.exec(`create schema auth;create schema storage;
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role()returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create table auth.users(id uuid primary key,raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}');
    create table public.shifts(id uuid primary key,dancer_id uuid,venue_id uuid,location_status text);
    create table public.dancer_profile_slug_aliases(slug text primary key,dancer_id uuid);
    create table public.dancer_photos(id uuid primary key,dancer_id uuid,storage_path text);
    create table public.image_moderation_records(id uuid primary key,final_storage_path text);
    create table public.gallery_media_reference_history(id uuid primary key default gen_random_uuid(),source_kind text,source_id uuid,profile_id uuid,storage_path text,event_kind text,created_at timestamptz default now());
    create table public.gallery_storage_retirements(storage_path text primary key);
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant all on all tables in schema public,auth to service_role;
    set search_path=public,pg_catalog;set timezone='UTC';`);
  for(const e of schema.enums)await db.exec('create type public.'+quote(e.name)+' as enum('+e.labels.map(s=>"'"+s.replaceAll("'","''")+"'").join(',')+')');
  for(const table of schema.scope.fullTargets){
   const columns=schema.columns.filter(c=>c.table_name===table);
   const definitions=[],dropped=[];let ordinal=1;
   for(const c of columns){
    // Preserve physical positions left by historical column removal without
    // recreating its old name, data or public interface in the native fixture.
    while(ordinal<c.ordinal_position){const name='fixture_removed_position_'+ordinal;assert.ok(!columns.some(v=>v.column_name===name));definitions.push(quote(name)+' text');dropped.push(name);ordinal++;}
    assert.equal(ordinal,c.ordinal_position);ordinal++;
    definitions.push(quote(c.column_name)+' '+quote(c.udt_schema)+'.'+quote(c.udt_name)+(c.column_default?' default '+c.column_default:'')+(c.is_nullable==='NO'?' not null':''));
   }
   await db.exec('create table public.'+quote(table)+'('+definitions.join(',')+')');
   for(const name of dropped)await db.exec('alter table public.'+quote(table)+' drop column '+quote(name));
  }
  // This immutable actual helper is referenced by captured club-deal checks.
  const checkHelper=schema.functions.find(f=>f.name==='club_deal_is_liquor_related');
  if(checkHelper)await db.exec(checkHelper.definition+';');
  // All target keys/checks are attached before their cross-table foreign keys.
  for(const type of ['p','u','c','f'])for(const c of schema.constraints.filter(c=>c.type===type))await db.exec('alter table public.'+quote(c.table_name)+' add constraint '+quote(c.name)+' '+c.definition+(c.validated?'':' not valid'));
  const constraintNames=new Set(schema.constraints.map(c=>c.name));
  for(const i of schema.indexes)if(!constraintNames.has(i.indexname))await db.exec(i.indexdef);
  // SQL helper dependencies precede trigger/case writers. All definitions are
  // hash checked before synthetic records are created or any action is called.
  const functions=[...schema.functions].sort((a,b)=>(a.name==='slugify'?-1:0)-(b.name==='slugify'?-1:0));
  for(const f of functions){
   await db.exec(f.definition+';');
   assert.equal((await db.query('select md5(pg_get_functiondef($1::regprocedure))hash',['public.'+f.signature])).rows[0].hash,f.fingerprint,f.name);
   if(f.acl!==null){
    await db.exec('revoke all on function public.'+f.signature+' from public,postgres,anon,authenticated,service_role');
    for(const entry of f.acl.slice(1,-1).split(',').filter(Boolean)){
     const parts=/^([^=]*)=(X\*?)\/postgres$/.exec(entry);assert.ok(parts,'Unsupported captured function grant: '+entry);
     const role=parts[1];assert.ok(['','postgres','anon','authenticated','service_role'].includes(role));
     await db.exec('grant execute on function public.'+f.signature+' to '+(role?quote(role):'public')+(parts[2]==='X*'?' with grant option':''));
    }
   }
   const access=(await db.query("select proacl::text as acl,has_function_privilege('anon',oid,'EXECUTE')as anon,has_function_privilege('authenticated',oid,'EXECUTE')as authenticated,has_function_privilege('service_role',oid,'EXECUTE')as service from pg_proc where oid=$1::regprocedure",['public.'+f.signature])).rows[0];
   assert.deepEqual(access,{acl:f.acl,anon:f.anon,authenticated:f.authenticated,service:f.service},'Exact function grant: '+f.name);
  }
  for(const p of schema.policies)await db.exec('create policy '+quote(p.policyname)+' on public.'+quote(p.tablename)+' as '+p.permissive+' for '+p.cmd+' to '+p.roles.map(quote).join(',')+(p.qual?' using('+p.qual+')':'')+(p.with_check?' with check('+p.with_check+')':''));
  for(const r of schema.relations){
   if(r.rls)await db.exec('alter table public.'+quote(r.name)+' enable row level security');
   if(r.force_rls)await db.exec('alter table public.'+quote(r.name)+' force row level security');
   const complete=schema.tableAccess?.find(t=>t.table===r.name);
   if(complete){
    if(complete.acl!==null){
     await db.exec('revoke all on public.'+quote(r.name)+' from public,postgres,anon,authenticated,service_role');
     for(const entry of complete.acl.slice(1,-1).split(',').filter(Boolean)){
      const parts=/^([^=]*)=((?:[arwdDxtm]\*?)*)\/postgres$/.exec(entry);assert.ok(parts,'Unsupported captured table grant: '+entry);
      const role=parts[1];assert.ok(['','postgres','anon','authenticated','service_role'].includes(role),'Captured table role: '+role);
      for(const privilege of parts[2].match(/[arwdDxtm]\*?/g)||[]){
       const right={r:'select',a:'insert',w:'update',d:'delete',D:'truncate',x:'references',t:'trigger',m:'maintain'}[privilege[0]];
       await db.exec('grant '+right+' on public.'+quote(r.name)+' to '+(role?quote(role):'public')+(privilege.endsWith('*')?' with grant option':''));
      }
     }
    }
    assert.equal((await db.query('select relacl::text acl from pg_class where oid=$1::regclass',['public.'+r.name])).rows[0].acl,complete.acl,'Exact table ACL: '+r.name);
    for(const [role,rights]of Object.entries(complete.effective))for(const [right,allowed]of Object.entries(rights))assert.equal((await db.query('select has_table_privilege($1,$2,$3)allowed',[role,'public.'+r.name,right])).rows[0].allowed,allowed,role+' '+r.name+' '+right);
   }else{
    for(const [role,rights]of Object.entries(r.grants)){const names=Object.entries(rights).filter(([,allow])=>allow).map(([right])=>right);if(names.length)await db.exec('grant '+names.join(',')+' on public.'+quote(r.name)+' to '+role);}
   }
  }
  for(const c of schema.columnAccess||[]){
   if(c.acl===null)continue;
   for(const entry of c.acl.slice(1,-1).split(',').filter(Boolean)){
    const parts=/^([^=]*)=((?:[rawx]\*?)*)\/postgres$/.exec(entry);assert.ok(parts,'Unsupported captured column grant: '+entry);
    const role=parts[1];assert.ok(['','postgres','anon','authenticated','service_role'].includes(role),'Captured column role: '+role);
    for(const privilege of parts[2].match(/[rawx]\*?/g)||[]){
     const right={r:'select',a:'insert',w:'update',x:'references'}[privilege[0]];
     await db.exec('grant '+right+'('+quote(c.column)+')on public.'+quote(c.table)+' to '+(role?quote(role):'public')+(privilege.endsWith('*')?' with grant option':''));
    }
   }
  }
  if(schema.columnAccess){
   const access=(await db.query(`select c.relname as "table",a.attname as "column",a.attacl::text as acl,
    has_column_privilege('anon',c.oid,a.attnum,'SELECT')as anon_select,
    has_column_privilege('anon',c.oid,a.attnum,'INSERT')as anon_insert,
    has_column_privilege('anon',c.oid,a.attnum,'UPDATE')as anon_update,
    has_column_privilege('authenticated',c.oid,a.attnum,'SELECT')as authenticated_select,
    has_column_privilege('authenticated',c.oid,a.attnum,'INSERT')as authenticated_insert,
    has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE')as authenticated_update,
    has_column_privilege('service_role',c.oid,a.attnum,'SELECT')as service_select,
    has_column_privilege('service_role',c.oid,a.attnum,'INSERT')as service_insert,
    has_column_privilege('service_role',c.oid,a.attnum,'UPDATE')as service_update
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'and c.relname=any($1)and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`,[schema.scope.fullTargets])).rows;
   assert.deepEqual(access,schema.columnAccess,'Target column permissions must match the independently captured catalog');
  }
  for(const t of schema.triggers)await db.exec(t.definition);
  return db;
 }catch(error){await db.close();throw error;}
}
export async function seed(db){
 await db.exec("reset role;select set_config('request.jwt.claim.role','service_role',false)");
 await db.query('insert into auth.users(id)values($1),($2),($3)',[id(1),id(2),id(3)]);
 await db.query("insert into public.app_users(id,role,display_name,email)values($1,'dancer','Synthetic dancer','dancer@example.invalid'),($2,'admin','Synthetic admin','admin@example.invalid'),($3,'customer','Synthetic claimant','claimant@example.invalid')",[id(1),id(2),id(3)]);
 await db.query("insert into public.dancer_profiles(id,user_id,real_name,stage_name,slug,status,verification_status,photo_review_status,is_public,venue_approved_at,approved_at)values($1,$2,'Synthetic dancer','Synthetic dancer','synthetic-dancer','approved','approved','approved',true,'2026-01-01Z','2026-01-01Z')",[id(10),id(1)]);
 for(let n=100;n<106;n++)await db.query("insert into public.mydancr_tv_videos(id,dancer_id,submitted_by,caption,storage_path,storage_mime,file_size_bytes,duration_seconds,width,height,status,published_at,review_notes,consent_confirmed,rights_confirmed)values($1,$2,$3,'Synthetic video',$4,'video/mp4',1024,10,720,1280,'approved','2026-01-01Z','Existing approval',true,true)",[id(n),id(10),id(1),'synthetic/'+n+'.mp4']);
 await db.exec('set role service_role');
}
export async function notice(db,n=200,video=100){
 await db.query("insert into public.dmca_cases(id,claimant_name,claimant_email,claimant_phone,claimant_address,copyrighted_work_description,infringing_url,target_type,target_id,uploader_id,good_faith_confirmed,accuracy_confirmed,authority_confirmed,signature,request_ip_hash)values($1,'Synthetic claimant','claimant@example.invalid','5555555555','123 Synthetic street','Synthetic copyrighted work','https://example.invalid/synthetic','tv_video',$2,$3,true,true,true,'Synthetic claimant','synthetic-not-an-ip')",[id(n),id(video),id(1)]);
}
export async function takeDown(db,n=200){return(await db.query('select public.apply_dmca_takedown($1,$2,$3)result',[id(n),id(2),'Synthetic takedown'])).rows[0].result;}
export async function eligible(db,n=200){
 await db.query("update public.dmca_cases set status='countered',counter_received_at=now()-interval '30 days',restore_eligible_at=now()-interval '1 day',restore_deadline_at=now()+interval '1 day' where id=$1",[id(n)]);
 await db.query("insert into public.dmca_counter_notices(case_id,uploader_id,legal_name,email,phone,address,removed_material_location,mistake_belief_confirmed,perjury_confirmed,jurisdiction_confirmed,service_confirmed,signature,status,forwarded_to_claimant_at)values($1,$2,'Synthetic dancer','dancer@example.invalid','5555555555','123 Synthetic street','https://example.invalid/synthetic',true,true,true,true,'Synthetic dancer','forwarded',now()-interval '20 days')",[id(n),id(1)]);
}
export async function restore(db,n=200){return(await db.query('select public.restore_dmca_case($1,$2,$3)result',[id(n),id(2),'Synthetic restoration'])).rows[0].result;}
export async function snapshot(db){
 const result={};
 for(const table of schema.scope.fullTargets)result[table]=(await db.query('select coalesce(jsonb_agg(to_jsonb(t)order by to_jsonb(t)::text),\'[]\')rows from public.'+quote(table)+' t')).rows[0].rows;
 return result;
}
// Deliberate operator decisions in synthetic setup must not borrow revoked
// service-column permissions. Native action calls remain under service_role.
export async function operatorQuery(db,sql,args=[]){
 await db.exec('reset role');
 try{return await db.query(sql,args);}finally{await db.exec('set role service_role');}
}
