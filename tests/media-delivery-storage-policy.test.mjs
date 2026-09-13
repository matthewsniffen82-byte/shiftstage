import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import test from 'node:test';import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20260913003000_require_checked_dancer_media_delivery.sql',import.meta.url),'utf8');
test('private media migration overrides permissive public/owner/admin reads while preserving server and unrelated buckets',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage;grant usage on schema storage to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,public boolean);create table storage.objects(id integer primary key,bucket_id text,name text);alter table storage.objects enable row level security;
 grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
 create policy legacy_public on storage.objects for select using(true);
 create policy legacy_admin on storage.objects for all to authenticated using(true)with check(true);
 insert into storage.buckets values('dancer-photos',true),('mydancr-tv-videos',false),('verification-documents',false),('venue-logo-images',true);
 insert into storage.objects values(1,'dancer-photos','owner/a.jpg'),(2,'mydancr-tv-videos','owner/a.mp4'),(3,'verification-documents','owner/a.pdf'),(4,'venue-logo-images','venue/a.jpg');`);
 await db.exec(migration);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);assert.deepEqual((await db.query('select id from storage.objects order by id')).rows.map(r=>r.id),[3,4]);await db.exec('reset role');}
 await db.exec('set role service_role');assert.equal((await db.query('select * from storage.objects')).rows.length,4);await db.query("update storage.objects set name='owner/b.jpg' where id=1");await db.exec('reset role');
 assert.deepEqual((await db.query('select id,public from storage.buckets order by id')).rows,[{id:'dancer-photos',public:false},{id:'mydancr-tv-videos',public:false},{id:'venue-logo-images',public:true},{id:'verification-documents',public:false}]);
 assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,4);
 }finally{await db.close();}
});
