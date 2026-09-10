import {readFileSync} from 'node:fs';
import {createDecisionDatabase,seedDecisionDatabase,fixtureId} from './content-decision-database.mjs';
export {fixtureId};
export const retirementSchema=JSON.parse(readFileSync(new URL('../fixtures/gallery-retirement-schema.json',import.meta.url),'utf8'));
export const retirementMigrationPath='supabase/migrations/20260910125000_add_gallery_storage_retirement_guards.sql';
export const retirementMigration=readFileSync(new URL('../../'+retirementMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const retirementSignature='public.claim_gallery_storage_retirement(uuid,text)';
const historyMigration=readFileSync(new URL('../../supabase/migrations/20260910092022_add_gallery_reference_history.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createGalleryRetirementDatabase({migrate=true}={}){
 const db=await createDecisionDatabase({migrate:false});
 try{
  await db.exec('create schema auth;create table auth.users(id uuid primary key)');
  const columns=retirementSchema.columns.filter(r=>r.table==='image_moderation_records').map(r=>quote(r.name)+' '+quote(r.schema)+'.'+quote(r.type)+(r.nullable==='NO'?' not null':'')+(r.default?' default '+r.default:''));
  await db.exec('create table public.image_moderation_records('+columns.join(',')+');alter table public.image_moderation_records enable row level security;grant all on public.image_moderation_records to service_role');
  const constraints=retirementSchema.constraints.filter(r=>r.table==='image_moderation_records');
  for(const row of constraints)await db.exec('alter table public.image_moderation_records add constraint '+quote(row.name)+' '+row.definition);
  for(const row of retirementSchema.indexes.filter(r=>r.table==='image_moderation_records'))if(!constraints.some(c=>c.name===row.name))await db.exec(row.definition);
  await db.exec(historyMigration);
  // Simulate provider defaults so this migration must explicitly remove them.
  await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role;alter default privileges in schema public grant execute on functions to anon,authenticated,service_role');
  if(migrate)await db.exec(retirementMigration);
  return db;
 }catch(error){await db.close();throw error;}
}
export async function seedGalleryRetirementDatabase(db){
 await db.exec('reset role;truncate public.gallery_media_reference_history;');
 if((await db.query("select to_regclass('public.gallery_storage_retirements') name")).rows[0].name)await db.exec('truncate public.gallery_storage_retirements');
 // Include the added FK dependent in the shared fixture's single TRUNCATE;
 // keep every native constraint enabled throughout setup and testing.
 await seedDecisionDatabase({query:db.query.bind(db),exec:sql=>db.exec(sql.startsWith('truncate public.admin_actions,')?sql.replace('truncate ','truncate public.image_moderation_records,'):sql)});
 await db.exec('reset role;insert into auth.users select id from public.app_users on conflict do nothing;set role service_role');
}
export async function galleryRetirementSnapshot(db){
 const out={};for(const table of ['dancer_profiles','dancer_photos','image_moderation_records','gallery_media_reference_history'])out[table]=(await db.query('select to_jsonb(t) row from public.'+table+' t order by to_jsonb(t)::text')).rows.map(r=>r.row);return out;
}
export async function claimGalleryRetirement(db,path,profile=fixtureId(11)){
 return (await db.query('select public.claim_gallery_storage_retirement($1,$2) result',[profile,path])).rows[0].result;
}
