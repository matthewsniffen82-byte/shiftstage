import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDecisionDatabase,seedDecisionDatabase,decisionSchema,fixtureId} from './content-decision-database.mjs';
export {fixtureId,seedDecisionDatabase};
export const profileDecisionTransition=JSON.parse(readFileSync(new URL('../fixtures/profile-decision-transition.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
export const profileDecisionMigrationPath='supabase/migrations/20260910070000_add_atomic_profile_review_decisions.sql';
export const profileDecisionMigration=readFileSync(new URL('../../'+profileDecisionMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const profileDecisionSignature='public.review_dancer_profile_safely(uuid,uuid,text,text,jsonb)';
export const profileVersionFields=['user_id','stage_name','city','status','verification_status','photo_review_status','avatar_storage_path','is_public','approved_at','disabled_at','admin_disabled_at','venue_approved_at','venue_approved_by_user_id','venue_approved_venue_id','updated_at'];
export {decisionSchema};
export async function createProfileDecisionDatabase({migrate=true}={}){
 const pg=await createDecisionDatabase();
 try{
  await pg.exec(profileDecisionTransition.definition);
  await pg.exec('revoke all on function public.transition_dancer_publication_safely(uuid,text,uuid) from public,anon,authenticated;grant execute on function public.transition_dancer_publication_safely(uuid,text,uuid) to service_role');
  const hash=(await pg.query("select md5(pg_get_functiondef('public.transition_dancer_publication_safely(uuid,text,uuid)'::regprocedure)) fingerprint")).rows[0].fingerprint;
  assert.equal(hash,profileDecisionTransition.fingerprint);
  if(migrate)await pg.exec(profileDecisionMigration);
  return pg;
 }catch(error){await pg.close();throw error;}
}
export async function profileDecisionVersion(pg,dancer=fixtureId(11)){
 return (await pg.query('select jsonb_object_agg(key,value) version from public.dancer_profiles p cross join lateral jsonb_each(to_jsonb(p)) where p.id=$1 and key=any($2::text[])',[dancer,profileVersionFields])).rows[0].version;
}
export async function reviewProfile(pg,{reviewer=fixtureId(3),dancer=fixtureId(11),status='rejected',notes='Synthetic review notes',expected}={}){
 const version=expected===undefined?await profileDecisionVersion(pg,dancer):expected;
 return (await pg.query('select public.review_dancer_profile_safely($1,$2,$3,$4,$5::jsonb) result',[reviewer,dancer,status,notes,JSON.stringify(version)])).rows[0].result;
}
export async function profileDecisionSnapshot(pg){
 const out={};for(const table of ['app_users','dancer_profiles','approval_reviews','admin_actions','dancer_photos','social_links'])out[table]=(await pg.query('select to_jsonb(r) value from public.'+table+' r order by id')).rows.map(r=>r.value);return out;
}
