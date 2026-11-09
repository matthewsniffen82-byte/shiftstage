import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { fixture, row, id, compile } from './helpers/discovery-fixture.mjs';

test('directory keyset advances even when the first thousand identities have no displayable card',async()=>{
  const candidates=Array.from({length:1001},(_,i)=>({...row(i+1),cardEligible:i===1000}));
  const db=fixture(candidates);
  const service=compile('src/lib/dancr/directory-candidates.ts',{'./markets':{isAllMyDancrCities:()=>false}});
  assert.deepEqual(Array.from(await service.getDirectoryCandidates(db.admin,'Vegas'),r=>r.id),[id(1001)]);
});

test('directory counts require qualifying club media inside the card’s approved gallery window',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create schema private;
      create role anon; create role authenticated; create role service_role;
      create table dancer_profiles(id uuid,city text,status text,verification_status text,is_public boolean,disabled_at timestamptz);
      create table venues(id uuid,is_active boolean);
      create function has_active_club_deal(venues) returns boolean language sql as $$select true$$;
      create table shifts(id uuid,dancer_id uuid,venue_id uuid,status text,checked_in_at timestamptz,checked_out_at timestamptz,
        location_status text,location_verification_expires_at timestamptz,starts_at timestamptz);
      create table dancer_photos(id uuid,dancer_id uuid,review_status text,storage_path text,is_primary boolean,is_pinned boolean,sort_order int);
      create table affiliations(dancer_id uuid,venue_id uuid);
      create function public_dancer_club_affiliations(uuid[]) returns setof affiliations language sql as $$select * from public.affiliations where dancer_id=any($1)$$;
      create table eligibility(venue_id uuid,dancer_id uuid,eligible boolean,media jsonb);
      create function private.club_media_eligibility(uuid,uuid[]) returns setof eligibility language sql as
        $$select * from public.eligibility where venue_id=$1 and dancer_id=any($2)$$;`);
    const dir='supabase/migrations/';
    await db.exec(readFileSync(dir+readdirSync(dir).find(f=>f.endsWith('_align_directory_card_eligibility.sql')),'utf8'));
    await db.exec(readFileSync(dir+readdirSync(dir).find(f=>f.endsWith('_venue_scoped_working_candidates.sql')),'utf8'));
    await db.query("insert into dancer_profiles values($1,'Vegas','approved','approved',true,null)",[id(1)]);
    const visible=async()=>(await db.query("select get_public_directory_candidates('Vegas',null) as page")).rows[0].page[0].cardEligible;
    assert.equal(await visible(),true);
    await db.query('insert into affiliations values($1,$2)',[id(1),id(2)]);
    await db.query('insert into eligibility values($1,$2,false,$3)',[id(2),id(1),JSON.stringify([{photoId:id(3)}])]);
    await db.query("insert into dancer_photos values($1,$2,'approved','photo',false,false,100)",[id(3),id(1)]);
    assert.equal(await visible(),false);
    await db.exec('update eligibility set eligible=true');
    assert.equal(await visible(),true);
    await db.query("insert into dancer_photos select gen_random_uuid(),$1,'approved','other',false,true,n from generate_series(1,50) n",[id(1)]);
    assert.equal(await visible(),false);
    await db.query('update dancer_photos set is_primary=true where id=$1',[id(3)]);
    assert.equal(await visible(),true);
    await db.query("update dancer_photos set storage_path='https://example.invalid/photo' where id=$1",[id(3)]);
    assert.equal(await visible(),false);
    const roster = async venue => (await db.query("select get_public_directory_candidates('Vegas',null,$1::uuid) as page",[venue])).rows[0].page;
    assert.deepEqual(await roster(id(2)), [], 'affiliation alone never creates a working candidate');
    await db.query("insert into venues values($1,true),($2,true)",[id(2),id(4)]);
    await db.query("insert into shifts values($1,$2,$3,'posted',now(),null,'club_confirmed',now()+interval '1 hour',now())",[id(5),id(1),id(2)]);
    assert.equal((await roster(id(2)))[0].cardEligible,false);
    await db.query("update dancer_photos set storage_path='photo' where id=$1",[id(3)]);
    assert.equal((await roster(id(2)))[0].cardEligible,true);
    assert.deepEqual(await roster(id(4)),[]);
    await db.query("insert into shifts values($1,$2,$3,'posted',now(),null,'club_confirmed',now()+interval '1 hour',now()-interval '1 hour')",[id(6),id(1),id(4)]);
    assert.equal((await roster(id(2)))[0].cardEligible,false,'the earlier active club takes precedence');
    await db.query("update shifts set checked_out_at=now() where venue_id=$1",[id(2)]);
    assert.deepEqual(await roster(id(2)),[]);
  } finally { await db.close(); }
});
