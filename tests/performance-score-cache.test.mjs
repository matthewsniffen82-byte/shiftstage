import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { compile } from './helpers/discovery-fixture.mjs';
import * as scoring from '../src/lib/dancr/venue-dancer-scores.ts';
const cache = compile('src/lib/dancr/performance-score-cache.ts', { 'server-only': {} });
const venue='92000000-0000-4000-8000-000000000001';
const now=Date.parse('2026-11-02T23:00:00Z');
const card={venueId:venue,periodStart:'2026-10-19T23:00:00Z',periodEnd:new Date(now).toISOString(),externalHours:null,scores:{overall:{value:null}}};
function fixture() {
  let row=null, error=null;
  const writes=[],reads=[];
  const admin={from(table){assert.equal(table,'venue_performance_score_cache');const q={select(){return q;},eq(...args){reads.push(args);return q;},async maybeSingle(){return {data:row,error};}};return q;},
    async rpc(name,args){assert.equal(name,'store_venue_performance_scores');writes.push(args);row={computed_at:args.p_computed_at,scores:args.p_scores};return {error};}};
  return {admin,reads,writes,setRow(value){row=value;},fail(value){error=value;}};
}
test('summaries are shared between workers and preserve the original expiry',async()=>{
  const f=fixture();f.setRow({computed_at:new Date(now).toISOString(),scores:[['a',card]]});
  const service=()=>compile('src/lib/dancr/performance-placement.ts',{'server-only':{},'./venue-dancer-scores':scoring,'./performance-score-cache':cache});
  const one=service(),two=service();
  for(const worker of [one,two])assert.equal((await worker.getPerformancePlacementScorecards(f.admin,[{dancerId:'a',venueId:venue}],now+30_000))[0].venueId,venue);
  assert.equal(f.writes.length,0);
  assert.equal(f.reads.filter(([key])=>key==='score_version').length,2);
  assert.equal(await cache.readPerformanceScoreCache(f.admin,venue,'version',now+60_000),null);
  assert.equal(await cache.readPerformanceScoreCache(f.admin,venue,'version',now-1),null);
});
test('cache errors and malformed summaries fail closed; empty cohorts are valid',async()=>{
  const f=fixture();f.fail({code:'42501',message:'denied'});
  await assert.rejects(cache.readPerformanceScoreCache(f.admin,venue,'version',now),{code:'42501'});
  f.fail(null);f.setRow({computed_at:new Date(now).toISOString(),scores:[['a',{...card,venueId:'another'}]]});
  await assert.rejects(cache.readPerformanceScoreCache(f.admin,venue,'version',now),/could not be confirmed/);
  f.setRow({computed_at:new Date(now).toISOString(),scores:[]});
  assert.equal((await cache.readPerformanceScoreCache(f.admin,venue,'version',now)).scores.size,0);
  f.fail({code:'SUPABASE_UNAVAILABLE'});
  assert.equal(await cache.readPerformanceScoreCache(f.admin,venue,'version',now),null);
  await cache.storePerformanceScoreCache(f.admin,venue,'version',now,new Map([['a',card]]));
  assert.equal(f.writes.length,1,'uncertain writes are not retried');
});
test('Postgres cache is private, monotonic and keeps consent deduplication',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table venues(id uuid primary key);create table account_terms_acceptances(user_id uuid,user_terms_version text,access_terms_version text,
      unique nulls not distinct(user_id,user_terms_version,access_terms_version));`);
    await db.exec(readFileSync('supabase/migrations/20261103001823_audit_stability_score_cache.sql','utf8'));
    await db.query('insert into venues values ($1)',[venue]);
    await db.exec('set role service_role');
    for(const time of [now,now-1000])await db.query('select store_venue_performance_scores($1,$2,$3,$4)',[venue,'version',new Date(time).toISOString(),JSON.stringify([['a',card]])]);
    assert.equal(new Date((await db.query('select computed_at from venue_performance_score_cache')).rows[0].computed_at).getTime(),now);
    for(const role of ['anon','authenticated']){
      await db.exec('reset role;set role '+role);
      await assert.rejects(db.query('select * from venue_performance_score_cache'),/permission denied/);
      await assert.rejects(db.query('select store_venue_performance_scores($1,$2,now(),$3)',[venue,'version','[]']),/permission denied/);
    }
    await db.exec('reset role');
    await db.query('insert into account_terms_acceptances(user_id,user_terms_version) values ($1,$2)',[venue,'v1']);
    await assert.rejects(db.query('insert into account_terms_acceptances(user_id,user_terms_version) values ($1,$2)',[venue,'v1']),/duplicate key/);
    assert.equal((await db.query('select id from account_terms_acceptances')).rows[0].id,1);
  } finally { await db.close(); }
});
