import {readFileSync} from 'node:fs';
import {createTapDatabase,seedTapDatabase,fixtureId as id} from './dancer-tap-database.mjs';
export async function createInternalRosterDatabase(){
 const pg=await createTapDatabase();await seedTapDatabase(pg);await pg.exec('reset role');
 await pg.exec("alter table public.venue_team_members add column role text default 'staff';create table public.dancer_age_verifications(user_id uuid primary key,provider text,status text,verified_at timestamptz);grant all on public.dancer_age_verifications to service_role");
 for(const name of ['20260928090000_mydancr_internal_channels.sql','20260928090100_mydancr_internal_roster.sql'])await pg.exec(readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await pg.query("insert into public.dancer_age_verifications values($1,'ondato','verified',now()-interval '1 day'),($2,'ondato','verified',now()-interval '1 day')",[id(1),id(5)]);
 return pg;
}
