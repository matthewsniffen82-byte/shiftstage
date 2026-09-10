import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const venueMediaSchema=JSON.parse(readFileSync(new URL('../fixtures/venue-media-schema.json',import.meta.url),'utf8'));
export const venueMediaId=n=>'97000000-0000-4000-8000-'+String(n).padStart(12,'0');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
export async function createVenueMediaDatabase(){
 const db=new PGlite();
 try{
  // Only the dependencies are projections. The venue table and its triggers
  // retain their captured production definitions; no production rows are used.
  await db.exec(`create table public.app_users(id uuid primary key,role text,account_state text);
   create table public.club_deals(venue_id uuid,deal_title text,deal_description text,deal_terms text,is_active boolean,redemption_rules jsonb,payout_type text,payout_amount_cents integer,currency text);
   create table public.venue_team_members(venue_id uuid,user_id uuid,status text);
   create table public.notifications(recipient_id uuid,notification_type text,channel text,title text,body text,payload jsonb,sent_at timestamptz);`);
  const columns=venueMediaSchema.columns.map(r=>quote(r.name)+' '+quote(r.schema)+'.'+quote(r.type)+(r.nullable==='NO'?' not null':'')+(r.default?' default '+r.default:''));
  await db.exec('create table public.venues('+columns.join(',')+');alter table public.venues enable row level security');
  for(const row of venueMediaSchema.constraints)await db.exec('alter table public.venues add constraint '+quote(row.name)+' '+row.definition);
  const names=new Set(venueMediaSchema.constraints.map(r=>r.name));
  for(const row of venueMediaSchema.indexes)if(!names.has(row.name))await db.exec(row.definition);
  for(const row of venueMediaSchema.triggers){await db.exec(row.function_definition);await db.exec(row.definition);}
  return db;
 }catch(error){await db.close();throw error;}
}
export async function seedVenueMediaDatabase(db){
 await db.exec('truncate public.venues,public.app_users,public.club_deals,public.venue_team_members,public.notifications cascade');
 for(const n of [1,2]){
  await db.query("insert into public.app_users values($1,'venue','active')",[venueMediaId(n)]);
  await db.query(`insert into public.venues(id,owner_user_id,name,slug,city,is_active,page_review_status,cover_image_storage_path,cover_image_updated_at,logo_storage_path,logo_updated_at,qr_code_storage_path,qr_code_updated_at)
   values($1,$2,'Synthetic venue',$3,'Test city',true,'published',$4,'2026-09-01T01:02:03.123456Z',$4,'2026-09-01T01:02:03.123456Z',$4,'2026-09-01T01:02:03.123456Z')`,[venueMediaId(n+10),venueMediaId(n),'fixture-'+n,venueMediaId(n+10)+'/old.webp']);
 }
}
export async function venueMediaSnapshot(db){
 const out={};for(const table of ['venues','app_users','club_deals','venue_team_members','notifications'])out[table]=(await db.query('select to_jsonb(t) row from public.'+table+' t order by to_jsonb(t)::text')).rows.map(r=>r.row);return out;
}
