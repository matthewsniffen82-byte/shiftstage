import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, beforeEach, after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260909203842_add_atomic_gallery_publication.sql', import.meta.url), 'utf8');
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const owner = id(1), other = id(2), reviewer = id(3), profile = id(11), otherProfile = id(12);
const updatedAt = '2020-01-01T00:00:00Z';
const schema = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key);
create type public.user_role as enum('dancer','admin','customer','venue');
create type public.account_state as enum('active','disabled','deleted');
create type public.review_status as enum('pending','approved','rejected');
create table public.app_users(id uuid primary key references auth.users(id),role public.user_role not null,account_state public.account_state not null default 'active',dmca_suspended_at timestamptz);
create table public.dancer_profiles(id uuid primary key,user_id uuid unique not null references public.app_users(id),photo_review_status public.review_status not null default 'pending');
create table public.dancer_photos(
 id uuid primary key default gen_random_uuid(),dancer_id uuid not null references public.dancer_profiles(id) on delete cascade,
 storage_path text not null,alt_text text,sort_order integer not null default 0,is_primary boolean not null default false,
 review_status public.review_status not null default 'pending',created_at timestamptz not null default now(),
 like_count bigint not null default 0 check(like_count>=0),is_pinned boolean not null default false);
create table public.image_moderation_records(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 image_id uuid references public.dancer_photos(id) on delete set null,temporary_storage_path text,final_storage_path text,
 upload_context text not null,provider text not null default 'openai',provider_model text not null default 'synthetic',provider_flagged boolean not null default false,
 decision text not null check(decision in('approved','review','rejected')),status text not null check(status in('pending','completed','error','moderating','approved','pending_review','rejected','moderation_retry','moderation_error')),
 reason_codes jsonb not null default '[]',category_flags jsonb not null default '{}',category_scores jsonb not null default '{}',error_code text,
 reviewed_by uuid references auth.users(id) on delete set null,reviewed_at timestamptz,review_decision text check(review_decision is null or review_decision in('approved','rejected')),review_notes text,
 idempotency_key text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),attempt_count integer not null default 0,
 next_attempt_at timestamptz,locked_at timestamptz,last_error_code text,last_error_message text,completed_at timestamptz);
create unique index image_moderation_records_user_idempotency_idx on public.image_moderation_records(user_id,idempotency_key) where idempotency_key is not null;
create table public.media_likes(id uuid primary key,photo_id uuid references public.dancer_photos(id) on delete cascade);
create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
alter table public.dancer_profiles enable row level security;
alter table public.dancer_photos enable row level security;
alter table public.image_moderation_records enable row level security;
grant usage on schema public,auth,storage to service_role,anon,authenticated;
grant all on all tables in schema public,auth,storage to service_role;
`;
let pg;
before(async () => { pg = new PGlite(); await pg.exec(schema); await pg.exec(migration); });
after(async () => pg?.close());
beforeEach(async () => {
  await pg.exec('reset role;drop trigger if exists synthetic_profile_failure on public.dancer_profiles;truncate public.media_likes,public.image_moderation_records,public.dancer_photos,public.dancer_profiles,public.app_users,auth.users,storage.objects cascade');
  for (const [userId, role] of [[owner,'dancer'],[other,'dancer'],[reviewer,'admin']]) {
    await pg.query('insert into auth.users values($1)', [userId]);
    await pg.query('insert into public.app_users(id,role) values($1,$2::public.user_role)', [userId,role]);
  }
  await pg.query('insert into public.dancer_profiles(id,user_id) values($1,$2),($3,$4)', [profile,owner,otherProfile,other]);
  await pg.exec('set role service_role');
});

async function review(number, { userId=owner, context='profile_gallery:1', mode='add', replaceId=null, decision='review', status='moderating' } = {}) {
  const recordId = id(number);
  await pg.query(`insert into public.image_moderation_records(id,user_id,upload_context,decision,status,updated_at,photo_publication_mode,replacement_photo_id)
    values($1,$2,$3,$4,$5,$6,$7,$8)`, [recordId,userId,context,decision,status,updatedAt,mode,replaceId]);
  const path = `${userId}/${userId===owner ? profile : otherProfile}/${number}.jpg`;
  await pg.query("insert into storage.objects values('dancer-photos',$1)", [path]);
  return { recordId, path };
}
async function photo(number, { dancerId=profile, sort=1, primary=false, status='approved' } = {}) {
  const path = `${dancerId===profile ? owner : other}/${dancerId}/${number}.jpg`;
  await pg.query(`insert into public.dancer_photos(id,dancer_id,storage_path,sort_order,is_primary,review_status)
    values($1,$2,$3,$4,$5,$6::public.review_status)`, [id(number),dancerId,path,sort,primary,status]);
  return { id: id(number), path };
}
async function publish(record, { expected=updatedAt, path=record.path, reasons=[], flags={}, scores={}, reviewerId=null } = {}) {
  const result = await pg.query(`select public.publish_approved_dancer_gallery_photo($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,false,null,$7,'Synthetic review') as result`,
    [record.recordId,expected,path,JSON.stringify(reasons),JSON.stringify(flags),JSON.stringify(scores),reviewerId]);
  return result.rows[0].result;
}
const sqlError = code => error => error.code === code;
const allPhotos = async () => (await pg.query('select * from public.dancer_photos order by id')).rows;
const allReviews = async () => (await pg.query('select * from public.image_moderation_records order by id')).rows;

test('two queued approvals with the same preferred slot keep both photos in different slots', async () => {
  const a = await review(101), b = await review(102);
  const results = await Promise.all([publish(a),publish(b)]);
  assert.deepEqual(results.map(r=>r.photo.sort_order).sort(), [1,2]);
  assert.equal(new Set(results.map(r=>r.photo.id)).size, 2);
  assert.equal((await allPhotos()).length, 2);
  assert.ok((await allReviews()).every(row=>row.status==='approved' && row.image_id));
  assert.equal((await pg.query('select photo_review_status from public.dancer_profiles where id=$1',[profile])).rows[0].photo_review_status, 'approved');
});

test('a lost approval response returns the prior committed identity without rewriting data', async () => {
  const record = await review(101);
  const first = await publish(record);
  const photos = await allPhotos(), reviews = await allReviews();
  const retry = await publish(record);
  assert.equal(retry.already_published, true);
  assert.equal(retry.photo.id, first.photo.id);
  assert.deepEqual(await allPhotos(), photos);
  assert.deepEqual(await allReviews(), reviews);
});

test('two explicit replacements of one photo cannot overwrite the winning replacement', async () => {
  const old = await photo(200, { sort: 3 });
  const a = await review(101,{ mode:'replace',replaceId:old.id,context:'profile_gallery:3' });
  const b = await review(102,{ mode:'replace',replaceId:old.id,context:'profile_gallery:3' });
  const results = await Promise.allSettled([publish(a),publish(b)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'40001');
  const winner=results.find(r=>r.status==='fulfilled').value;
  assert.deepEqual(winner.superseded_storage_paths,[old.path]);
  assert.equal(winner.photo.sort_order,3);
  assert.deepEqual((await allPhotos()).map(r=>r.id),[winner.photo.id]);
});

test('a failure after replacement rolls back photo removal, likes, review state and insertion together', async () => {
  const old=await photo(200);
  await pg.query('insert into public.media_likes values($1,$2)',[id(300),old.id]);
  const record=await review(101,{ mode:'replace',replaceId:old.id });
  const photos=await allPhotos(), reviews=await allReviews();
  await pg.exec(`reset role;create or replace function public.synthetic_profile_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic profile failure';end$$;
    create trigger synthetic_profile_failure before update on public.dancer_profiles for each row execute function public.synthetic_profile_failure();set role service_role`);
  await assert.rejects(publish(record), /synthetic profile failure/);
  assert.deepEqual(await allPhotos(),photos);
  assert.deepEqual(await allReviews(),reviews);
  assert.equal((await pg.query('select count(*)::int as count from public.media_likes')).rows[0].count,1);
});

test('legacy reviews add to a free slot and preserve an occupied slot and zero-order history', async () => {
  const zero=await photo(200,{ sort:0 }), occupied=await photo(201,{ sort:1 });
  const record=await review(101,{ mode:'legacy' });
  const result=await publish(record);
  assert.equal(result.photo.sort_order,2);
  assert.deepEqual(result.superseded_storage_paths,[]);
  assert.ok((await allPhotos()).some(row=>row.id===zero.id));
  assert.ok((await allPhotos()).some(row=>row.id===occupied.id));
});

test('a deleted photo is not resurrected by retrying its approval', async () => {
  const record=await review(101), result=await publish(record);
  await pg.query('delete from public.dancer_photos where id=$1',[result.photo.id]);
  await assert.rejects(publish(record),sqlError('40001'));
  assert.equal((await allPhotos()).length,0);
});

test('cross-owner replacement and storage paths fail without changing either profile', async () => {
  const foreign=await photo(200,{ dancerId:otherProfile });
  const record=await review(101,{ mode:'replace',replaceId:foreign.id });
  const original=await allPhotos();
  await assert.rejects(publish(record),sqlError('40001'));
  await assert.rejects(publish(record,{ path:foreign.path }),sqlError('42501'));
  await assert.rejects(publish(record,{ path:`${owner}/${profile}/../other.jpg` }),sqlError('42501'));
  assert.deepEqual(await allPhotos(),original);
});

test('missing storage and malformed provider metadata cannot publish a row', async () => {
  const record=await review(101);
  await assert.rejects(publish(record,{ path:`${owner}/${profile}/missing.jpg` }),sqlError('P0002'));
  await assert.rejects(publish(record,{ reasons:{} }),sqlError('22023'));
  await assert.rejects(publish(record,{ flags:[] }),sqlError('22023'));
  assert.equal((await allPhotos()).length,0);
});

test('a full library rejects additions but allows an explicit replacement', async () => {
  for(let n=0;n<50;n++) await photo(200+n,{ sort:n });
  const add=await review(101), replacement=await review(102,{ mode:'replace',replaceId:id(220) });
  await assert.rejects(publish(add),sqlError('23514'));
  await publish(replacement);
  assert.equal((await allPhotos()).length,50);
});

test('primary publication rejects implicit replacement and preserves gallery photos', async () => {
  const old=await photo(200,{ primary:true,sort:0 }), gallery=await photo(201,{ sort:1 });
  const add=await review(101,{ context:'profile_main',mode:'legacy' });
  await assert.rejects(publish(add),sqlError('40001'));
  const replace=await review(102,{ context:'profile_main',mode:'replace',replaceId:old.id });
  const result=await publish(replace);
  assert.equal(result.photo.is_primary,true);
  assert.ok((await allPhotos()).some(row=>row.id===gallery.id && !row.is_primary));
});

test('stale decisions, rejected reviews and avatar contexts cannot use gallery publication', async () => {
  const stale=await review(101), rejected=await review(102,{ decision:'rejected',status:'rejected' }), avatar=await review(103,{ context:'profile_avatar' });
  await assert.rejects(publish(stale,{ expected:'2019-01-01T00:00:00Z' }),sqlError('40001'));
  await assert.rejects(publish(rejected),sqlError('40001'));
  await assert.rejects(publish(avatar),sqlError('22023'));
  assert.equal((await allPhotos()).length,0);
});

test('only an active administrator can be recorded as the reviewer', async () => {
  const record=await review(101);
  await assert.rejects(publish(record,{ reviewerId:other }),sqlError('42501'));
  await pg.query("update public.app_users set account_state='disabled' where id=$1",[reviewer]);
  await assert.rejects(publish(record,{ reviewerId:reviewer }),sqlError('42501'));
  await pg.query("update public.app_users set account_state='active' where id=$1",[reviewer]);
  const result=await publish(record,{ reviewerId:reviewer });
  assert.equal(result.record.reviewed_by,reviewer);
  assert.equal(result.record.review_decision,'approved');
});

test('paused accounts cannot automatically publish while administrator review preserves account state', async () => {
  const record=await review(101);
  await pg.query("update public.app_users set account_state='disabled' where id=$1",[owner]);
  await assert.rejects(publish(record),sqlError('42501'));
  await publish(record,{ reviewerId:reviewer });
  assert.equal((await pg.query('select account_state from public.app_users where id=$1',[owner])).rows[0].account_state,'disabled');
});

test('browser roles cannot execute the function and RLS remains enabled', async () => {
  const record=await review(101);
  for(const role of ['anon','authenticated']) {
    await pg.exec(`reset role;set role ${role}`);
    await assert.rejects(publish(record),sqlError('42501'));
  }
  await pg.exec('reset role');
  const fn=(await pg.query("select prosecdef,proconfig from pg_proc where oid='public.publish_approved_dancer_gallery_photo(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,text,uuid,text)'::regprocedure")).rows[0];
  assert.equal(fn.prosecdef,false);
  assert.ok(fn.proconfig.includes('search_path=""'));
  const tables=(await pg.query("select relrowsecurity from pg_class where oid in('public.dancer_profiles'::regclass,'public.dancer_photos'::regclass,'public.image_moderation_records'::regclass)")).rows;
  assert.ok(tables.every(row=>row.relrowsecurity));
});

test('incomplete replacement intent is rejected by the database constraint', async () => {
  await assert.rejects(review(101,{ mode:'replace' }),sqlError('23514'));
  await assert.rejects(review(102,{ mode:'add',replaceId:id(200) }),sqlError('23514'));
});

test('replacement retains review history and withdraws only outstanding reviews for its exact target', async () => {
  const old=await photo(200), unrelated=await photo(201,{ sort:2 });
  const linked=await review(101), otherReview=await review(102), historical=await review(103,{ decision:'approved',status:'approved' });
  for(const [record, photoId] of [[linked,old.id],[otherReview,unrelated.id],[historical,old.id]]) {
    await pg.query('update public.image_moderation_records set image_id=$1 where id=$2',[photoId,record.recordId]);
  }
  const replacement=await review(104,{ mode:'replace',replaceId:old.id });
  await publish(replacement);
  const rows=await allReviews();
  const withdrawn=rows.find(row=>row.id===linked.recordId);
  assert.equal(withdrawn.decision,'rejected');
  assert.equal(withdrawn.error_code,'photo_replaced');
  assert.equal(withdrawn.image_id,null);
  assert.equal(rows.find(row=>row.id===historical.recordId).decision,'approved');
  assert.equal(rows.find(row=>row.id===otherReview.recordId).decision,'review');
  await assert.rejects(publish(linked),sqlError('40001'));
  assert.equal(rows.length,4);
});

test('an already referenced approved file cannot be published as a second photo', async () => {
  const first=await review(101), second=await review(102);
  await publish(first);
  await assert.rejects(publish(second,{ path:first.path }),sqlError('23505'));
  assert.equal((await allPhotos()).length,1);
  assert.equal((await allReviews()).find(row=>row.id===second.recordId).decision,'review');
});

test('the additive migration preserves pre-existing review values and grants no browser execution', async () => {
  const legacyPg=new PGlite();
  try {
    await legacyPg.exec(schema);
    await legacyPg.query('insert into auth.users values($1)',[owner]);
    await legacyPg.query(`insert into public.image_moderation_records(user_id,upload_context,decision,status,reason_codes,updated_at)
      values($1,'profile_gallery:1','review','pending_review','["synthetic_existing_reason"]',$2)`,[owner,updatedAt]);
    const before=(await legacyPg.query('select to_jsonb(r) as row from public.image_moderation_records r')).rows;
    await legacyPg.exec(migration);
    assert.deepEqual((await legacyPg.query("select to_jsonb(r)-'photo_publication_mode'-'replacement_photo_id' as row from public.image_moderation_records r")).rows,before);
    const intent=(await legacyPg.query('select photo_publication_mode,replacement_photo_id from public.image_moderation_records')).rows[0];
    assert.deepEqual(intent,{photo_publication_mode:'legacy',replacement_photo_id:null});
    for(const role of ['anon','authenticated']) {
      assert.equal((await legacyPg.query("select has_function_privilege($1,'public.publish_approved_dancer_gallery_photo(uuid,timestamptz,text,jsonb,jsonb,jsonb,boolean,text,uuid,text)','execute') as allowed",[role])).rows[0].allowed,false);
    }
  } finally { await legacyPg.close(); }
});
