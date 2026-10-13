import assert from 'node:assert/strict';
import test, {before, after, beforeEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

let pg;
const id=n=>`99000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const stamp=Date.now(), hour=3600000, time=hours=>new Date(stamp+hours*hour).toISOString();
before(async()=>{
 pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table qr_redemptions(id uuid primary key,venue_id uuid,status text,expires_at timestamptz,arrival_method text,redeemed_at timestamptz,redemption_token text);
 create table venue_guest_list_entries(pass_id uuid primary key,venue_id uuid,guest_name text,phone text,email text,created_at timestamptz);
 create index venue_guest_list_recent on venue_guest_list_entries(venue_id,created_at desc,pass_id);
 grant select on qr_redemptions,venue_guest_list_entries to service_role;`);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261013062154_venue_guest_list_workspace.sql',import.meta.url),'utf8'));
});
after(async()=>pg?.close());
beforeEach(async()=>{await pg.exec('reset role;truncate qr_redemptions,venue_guest_list_entries');});
async function seed(n,{venue=1,passVenue=venue,name=`Guest ${n}`,phone='+17025550123',email=null,created=time(-.5),expires=time(2),status='generated',redeemed=null}={}){
 await pg.query('insert into qr_redemptions values($1,$2,$3,$4,$5,$6,$7)',[id(n),id(passVenue),status,expires,'self_drive',redeemed,'private-token']);
 await pg.query('insert into venue_guest_list_entries values($1,$2,$3,$4,$5,$6)',[id(n),id(venue),name,phone,email,created]);
}
async function list({venue=1,search='',status='all',start=time(-1),end=time(23),offset=0}={}){
 return(await pg.query('select public.venue_guest_list_workspace($1,$2,$3,$4,$5,$6) data',[id(venue),search,status,start,end,offset])).rows[0].data;
}

test('counts cover all matching guests independently of the selected status and page',async()=>{
 for(let n=10;n<70;n++)await seed(n);
 await seed(70,{status:'redeemed',redeemed:time(-.25)});
 const first=await list();assert.equal(first.entries.length,50);assert.equal(first.hasMore,true);
 assert.deepEqual(first.counts,{all:61,generated:60,redeemed:1});
 const second=await list({offset:50});assert.equal(second.entries.length,11);assert.equal(second.hasMore,false);
 assert.equal(new Set([...first.entries,...second.entries].map(r=>r.id)).size,61);
 const admitted=await list({status:'redeemed'});assert.equal(admitted.entries.length,1);assert.deepEqual(admitted.counts,first.counts);
 assert.doesNotMatch(JSON.stringify(first),/redemption_token|private-token/);
});

test('date matching uses validity and actual admission time without hiding redeemed expired passes',async()=>{
 await seed(10,{created:time(-4),expires:time(2)}); // Valid across the boundary.
 await seed(11,{created:time(-4),expires:time(-.2),status:'redeemed',redeemed:time(-.3)});
 await seed(12,{created:time(-4),expires:time(2),status:'redeemed',redeemed:time(-2)}); // Earlier admission.
 await seed(13,{created:time(-4),expires:time(-.2)}); // Expired, never admitted.
 await seed(14,{status:'voided'});
 await seed(15,{created:time(23),expires:time(25)}); // Next date exactly.
 await seed(16,{created:time(-4),expires:time(-1)}); // Ends exactly at boundary.
 await seed(17,{venue:2});await seed(18,{passVenue:2});
 const result=await list();assert.deepEqual(result.entries.map(r=>r.id).sort(),[id(10),id(11),id(13)]);
 assert.deepEqual(result.counts,{all:3,generated:1,redeemed:1});
 assert.equal(result.entries.find(r=>r.id===id(13)).status,'expired');
 assert.equal(Date.parse(result.entries.find(r=>r.id===id(11)).redeemed_at),Date.parse(time(-.3)));
 assert.equal((await list({status:'generated'})).entries.length,1);
});

test('search matches literal name, phone and email within the authorized venue and date',async()=>{
 await seed(10,{name:'María %_ Guest',email:'guest@example.test'});await seed(11,{name:'Other'});
 await seed(12,{venue:2,name:'María %_ Guest'});
 for(const search of ['maría','%_','GUEST@EXAMPLE.TEST']){
  const result=await list({search});assert.deepEqual(result.entries.map(r=>r.id),[id(10)]);assert.equal(result.counts.all,1);
 }
 assert.equal((await list({search:'+1702555'})).counts.all,2);
 assert.deepEqual((await list({search:"' OR true --"})).counts,{all:0,generated:0,redeemed:0});
});

test('all-active view excludes expired and voided passes and keeps unknown admission times unknown',async()=>{
 await seed(10,{status:'redeemed',redeemed:null});await seed(11,{expires:time(-.1)});await seed(12,{status:'voided'});
 const result=await list({start:null,end:null});assert.equal(result.entries.length,1);assert.equal(result.entries[0].redeemed_at,null);
 assert.deepEqual(result.counts,{all:1,generated:0,redeemed:1});
});

test('empty pages keep totals and invalid filters never execute a guest query',async()=>{
 await seed(10);const result=await list({offset:50});assert.deepEqual(result.entries,[]);assert.equal(result.hasMore,false);assert.equal(result.counts.all,1);
 for(const input of [{status:'voided'},{status:null},{search:null},{offset:-1},{offset:100001},{start:null},{end:time(-1)},{end:time(40)}]){
  await assert.rejects(list(input),error=>error.code==='22023');
 }
});

test('only the server role can execute the contact RPC',async()=>{
 for(const role of ['anon','authenticated']){
  await pg.exec(`set role ${role}`);await assert.rejects(list(),error=>error.code==='42501');await pg.exec('reset role');
 }
 await pg.exec('set role service_role');assert.deepEqual((await list()).counts,{all:0,generated:0,redeemed:0});
});
