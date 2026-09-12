import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAvatarRetirementDatabase,seedGalleryRetirementDatabase,fixtureId} from './avatar-retirement-database.mjs';
export {fixtureId};
export const avatarSchema=JSON.parse(readFileSync(new URL('../fixtures/avatar-publication-schema.json',import.meta.url),'utf8'));
export const avatarMigrationPath='supabase/migrations/20260912194200_make_avatar_publication_atomic.sql';
const source=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8').replaceAll('\r\n','\n');
export const avatarMigration=source(avatarMigrationPath);
export const avatarUser=fixtureId(1),avatarProfile=fixtureId(11),avatarAdmin=fixtureId(3);
export const avatarPath=name=>`${avatarUser}/${avatarProfile}/avatar/${name}.webp`;
export const avatarTemp=name=>`${avatarUser}/${avatarProfile}/${name}.jpg`;
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createAvatarDatabase({migrate=true}={}){
 const db=await createAvatarRetirementDatabase();
 try{
  await db.exec('reset role;create schema storage;create table storage.objects(bucket_id text not null,name text not null,primary key(bucket_id,name));grant usage on schema storage to service_role;grant all on storage.objects to service_role');
  const pause=source('supabase/migrations/20260912113200_make_self_service_account_transitions_atomic.sql');
  const dmca=source('supabase/migrations/20260912140704_preserve_owned_dmca_lifecycle_states.sql');
  // Execute the committed private ownership schemas and functions, with their FKs.
  await db.exec(pause.slice(pause.indexOf('create table public.account_self_pauses'),pause.indexOf('create trigger invalidate_account_pause_after_decision')));
  await db.exec(dmca.slice(dmca.indexOf('create table public.dmca_enforcement_states'),dmca.indexOf('create trigger invalidate_dmca_account_enforcement')));
  for(const trigger of avatarSchema.triggers){
   const existing=(await db.query('select pg_get_triggerdef(t.oid) definition,md5(pg_get_functiondef(t.tgfoid)) function_md5 from pg_trigger t where t.tgrelid=$1::regclass and tgname=$2',['public.'+trigger.table,trigger.name])).rows[0];
   if(existing)assert.deepEqual(existing,{definition:trigger.definition,function_md5:trigger.function_md5},trigger.name+' existing native metadata');
   else {await db.exec(trigger.function_definition);await db.exec(trigger.definition);}
  }
  const columns=(await db.query(`select c.relname as table,a.attname name,format_type(a.atttypid,a.atttypmod) type,not a.attnotnull nullable,pg_get_expr(d.adbin,d.adrelid) as default
   from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where n.nspname='public' and c.relname in('dancer_profiles','image_moderation_records') and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`)).rows;
  assert.deepEqual(columns,avatarSchema.columns.map(({table,name,type,nullable,default:defaultValue})=>({table,name,type,nullable,default:defaultValue})), 'all 52 current target column identities');
  const constraints=(await db.query("select conrelid::regclass::text as table,conname name,pg_get_constraintdef(oid) definition from pg_constraint where conrelid in('public.dancer_profiles'::regclass,'public.image_moderation_records'::regclass) and contype<>'n' order by conrelid::regclass::text,conname")).rows;
  assert.deepEqual(constraints,avatarSchema.constraints,'current target constraint definitions');
  if(migrate)await db.exec(avatarMigration);
  return db;
 }catch(error){await db.close();throw error;}
}
export async function seedAvatarDatabase(db){
 await db.exec('reset role;truncate storage.objects;drop trigger if exists synthetic_failure on public.image_moderation_records');
 await seedGalleryRetirementDatabase({query:db.query.bind(db),exec:sql=>db.exec(sql.startsWith('truncate public.image_moderation_records,')?sql.replace('truncate ','truncate public.account_self_pauses,public.dmca_enforcement_states,'):sql)});
 await db.query("update public.dancer_profiles set avatar_storage_path=$1 where id=$2",[avatarPath('original'),avatarProfile]);
 await putAvatarObject(db,avatarPath('original'));
 await db.query("insert into public.account_self_pauses(user_id,dancer_id,dancer_previous_state) values($1,$2,'{\"status\":\"approved\",\"disabled_at\":null,\"is_public\":true}')",[avatarUser,avatarProfile]);
 await db.query("insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state) values('dancer_profile',$1,$2,'{}','{}')",[avatarProfile,avatarUser]);
}
export async function putAvatarObject(db,path,bucket='dancer-photos'){
 await db.query('insert into storage.objects values($1,$2) on conflict do nothing',[bucket,path]);return path;
}
export async function readAvatarProfile(db,id=avatarProfile){return (await db.query('select to_jsonb(p) value from public.dancer_profiles p where id=$1',[id])).rows[0]?.value;}
export async function readAvatarRecord(db,id){return (await db.query('select to_jsonb(r) value from public.image_moderation_records r where id=$1',[id])).rows[0]?.value;}
export async function avatarSnapshot(db){
 const result={};for(const table of ['dancer_profiles','dancer_photos','image_moderation_records','gallery_media_reference_history','gallery_storage_retirements','account_self_pauses','dmca_enforcement_states','admin_actions','app_users'])result[table]=(await db.query('select to_jsonb(t) value from public.'+table+' t order by to_jsonb(t)::text')).rows.map(r=>r.value);return result;
}
export const avatarRpcArgs={
 create_dancer_avatar_review:['p_user_id','p_profile_id','p_expected_avatar_path','p_expected_avatar_updated_at','p_temporary_storage_path','p_idempotency_key','p_provider_model'],
 publish_approved_dancer_avatar:['p_record_id','p_expected_updated_at','p_storage_path','p_reason_codes','p_category_flags','p_category_scores','p_provider_flagged','p_reviewer_id','p_review_notes','p_legacy_avatar_path','p_legacy_avatar_updated_at'],
 clear_dancer_avatar_safely:['p_user_id','p_profile_id','p_expected_avatar_path','p_expected_avatar_updated_at'],
 recenter_dancer_avatar_safely:['p_reviewer_id','p_profile_id','p_expected_avatar_path','p_expected_avatar_updated_at','p_storage_path','p_source_path','p_source_photo_id'],
};
export function avatarDatabaseClient(db,{beforeQuery,afterQuery}={}){
 const calls=[],removed=[];
 const client={calls,removed,storage:{from(bucket){return {remove:async paths=>{removed.push({bucket,paths});return {data:paths,error:null};},getPublicUrl:path=>({data:{publicUrl:'https://synthetic.invalid/'+path}})};}},
  async rpc(name,args){
   assert.ok(avatarRpcArgs[name],name);calls.push({name,args:structuredClone(args)});
   try{await beforeQuery?.({name,args});const values=avatarRpcArgs[name].map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]??null);
    const data=(await db.query('select public.'+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') value',values)).rows[0].value;
    return await afterQuery?.({name,args,data})??{data,error:null};
   }catch(error){return {data:null,error};}
  },
  from(table){
   assert.ok(['dancer_profiles','image_moderation_records','dancer_photos','notifications','app_users','admin_actions'].includes(table),table);
   let operation='select',value=null,selection='*',limit=null;const filters=[];
   const query={select(s){selection=s;return query;},update(v){operation='update';value=v;return query;},insert(v){operation='insert';value=v;return query;},delete(){operation='delete';return query;},
    eq(k,v){filters.push([k,'=',v]);return query;},neq(k,v){filters.push([k,'<>',v]);return query;},is(k,v){assert.equal(v,null);filters.push([k,'is null',null]);return query;},in(k,v){filters.push([k,'in',v]);return query;},
    limit(n){limit=n;return query;},order(){return query;},maybeSingle:()=>execute(true),single:()=>execute(true),then(a,b){return execute(false).then(a,b);}};
   async function execute(single){
    const info={table,operation,value,filters:structuredClone(filters),selection};calls.push(info);await beforeQuery?.(info);
    const args=[];const bind=v=>{args.push(v);return '$'+args.length;};
    const where=filters.length?' where '+filters.map(([k,op,v])=>quote(k)+(op==='is null'?' is null':op==='in'?' in('+v.map(bind).join(',')+')':' '+op+' '+bind(v))).join(' and '):'';
    let sql;if(operation==='select')sql='select * from public.'+quote(table)+where+(limit?' limit '+limit:'');
    else if(operation==='update')sql='update public.'+quote(table)+' set '+Object.keys(value).map(k=>quote(k)+'=p.'+quote(k)).join(',')+' from jsonb_populate_record(null::public.'+quote(table)+','+bind(JSON.stringify(value))+'::jsonb) p'+where.replaceAll(/(?<![.\w])"([^"]+)"/g,quote(table)+'."$1"')+' returning '+quote(table)+'.*';
    else if(operation==='insert')sql='insert into public.'+quote(table)+'('+Object.keys(value).map(quote).join(',')+') select '+Object.keys(value).map(quote).join(',')+' from jsonb_populate_record(null::public.'+quote(table)+','+bind(JSON.stringify(value))+'::jsonb) returning *';
    else sql='delete from public.'+quote(table)+where+' returning *';
    try{const rows=(await db.query('with changed as ('+sql+') select to_jsonb(changed) value from changed',args)).rows.map(r=>r.value);const data=single?rows[0]??null:rows;return await afterQuery?.({...info,data})??{data,error:null};}
    catch(error){return {data:null,error};}
   }
   return query;
  }
 };return client;
}
