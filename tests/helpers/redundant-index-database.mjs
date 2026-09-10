import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const redundantIndexSchema=JSON.parse(readFileSync(new URL('../fixtures/redundant-index-schema.json',import.meta.url),'utf8'));
export const redundantIndexMigrationPath='supabase/migrations/20260910112700_remove_two_redundant_indexes.sql';
export const redundantIndexMigration=readFileSync(new URL('../../'+redundantIndexMigrationPath,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const removedIndexNames=['club_invoice_items_revenue_idx','venues_owner_user_id_idx'];
export async function createRedundantIndexDatabase(){
 const db=new PGlite();
 try{await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls');await seedRedundantIndexDatabase(db);return db;}catch(error){await db.close();throw error;}
}
export async function seedRedundantIndexDatabase(db){
 await db.exec(`reset role;drop table if exists public.index_history,public.owner_reference,public.club_invoice_items,public.venues cascade;
 create table public.venues(id uuid primary key,owner_user_id uuid,label text);
 create table public.club_invoice_items(id uuid primary key,invoice_id uuid,revenue_event_id uuid,amount_cents integer);
 create table public.index_history(value text);
 alter table public.venues enable row level security;alter table public.club_invoice_items enable row level security;
 grant usage on schema public to anon,authenticated,service_role;grant all on all tables in schema public to service_role;
 grant select on public.venues to anon,authenticated;create policy synthetic_public_venue on public.venues for select to anon using(true);`);
 // Only the index-related columns are projected; each of the four definitions is captured from production.
 for(const index of redundantIndexSchema.indexes){
  if(index.constraints.length)await db.exec('alter table public.'+index.table+' add constraint '+index.constraints[0].name+' '+index.constraints[0].definition);
  else await db.exec(index.definition);
 }
 await db.exec(`create table public.owner_reference(owner_id uuid references public.venues(owner_user_id) on delete restrict);
 create or replace function public.record_index_test_write() returns trigger language plpgsql as $$begin insert into public.index_history values(TG_TABLE_NAME);return new;end;$$;
 create trigger record_index_write after update on public.venues for each row execute function public.record_index_test_write();
 insert into public.venues values('98000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000002','Synthetic venue');
 insert into public.owner_reference values('98000000-0000-4000-8000-000000000002');
 insert into public.club_invoice_items values('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000004','98000000-0000-4000-8000-000000000005',100);`);
}
export async function retainedIndexSnapshot(db){return (await db.query(`select jsonb_build_object(
 'venues',(select jsonb_agg(to_jsonb(t) order by id) from public.venues t),
 'items',(select jsonb_agg(to_jsonb(t) order by id) from public.club_invoice_items t),
 'history',(select jsonb_agg(t) from public.index_history t),
 'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where connamespace='public'::regnamespace),
 'indexes',(select jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) order by indexname) from pg_indexes where schemaname='public' and indexname not in('club_invoice_items_revenue_idx','venues_owner_user_id_idx')),
 'access',(select jsonb_agg(jsonb_build_object('table',relname,'rls',relrowsecurity,'acl',relacl) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'),
 'policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public'),
 'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where not tgisinternal and tgrelid in('public.venues'::regclass,'public.club_invoice_items'::regclass))
 ) snapshot`)).rows[0].snapshot;}
