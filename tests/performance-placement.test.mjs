import assert from 'node:assert/strict';
import test from 'node:test';
import {compile} from './helpers/discovery-fixture.mjs';
import * as scoring from '../src/lib/dancr/venue-dancer-scores.ts';

const dancer = (id, conversion=10) => ({id,name:'Private '+id,
 internal:{checkedInHours:8,requests:20,requestsDuringHours:20,rosterTrackedHours:8,rosterExternalHours:8,rosterExternalTrackedHours:8,rosterBothHours:0,verifiedCheckInDays:4,checkoutEligibleDays:4,dancerCheckoutDays:4,activeCheckInDays:0},
 vip:{scoringRequests:20,scoringUniqueRequesters:10,scoringRepeatRequesters:2},
 external:{dancer_profile:10,club_page:10,directions:10,going:10,free_entry:10,transport:10},
 results:{profileClaims:20,profileCohortConversions:conversion},
});
const now=Date.parse('2026-10-12T14:00:00Z');
function fixture(reports, affiliations=[]) {
 const calls=[];let fail=false;
 const admin={
  async rpc(name,args){calls.push({name,args});const report=reports[args.p_venue_id];return {data:fail?null:{performance:{dancers:typeof report==='function'?report(args):report||[]}},error:fail?new Error('report unavailable'):null};},
  from(table){assert.equal(table,'venue_dancer_affiliations');let rows=[...affiliations];const q={
   select(){return q;},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return q;},eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},
   order(k){if(k==='approved_at')rows.sort((a,b)=>String(b[k]).localeCompare(String(a[k])));return q;},
   range(start,end){rows=rows.slice(start,end+1);return q;},then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve);},
  };return q;},
 };
 const service=compile('src/lib/dancr/performance-placement.ts',{'server-only':{},'./venue-dancer-scores':scoring});
 return {admin,service,calls,fail(value){fail=value;}};
}
test('placement uses a rolling 14-day window and the shared formula over the full venue cohort',async()=>{
 const report=[dancer('a',18),dancer('b',2),dancer('private-peer',10)];
 const f=fixture({club:report});
 const scores=await f.service.getPerformancePlacementScores(f.admin,[{dancerId:'b',venueId:'club'},{dancerId:'a',venueId:'club'}],now);
 const dashboard=scoring.scoreVenueDancers(report,'14d');
 assert.equal(f.service.PLACEMENT_PERIOD,'14d');
 assert.equal(f.service.PLACEMENT_VERSION,`performance-${scoring.DANCER_SCORE_VERSION}-14d`);
 assert.deepEqual(Array.from(scores),[dashboard[1].scores.overall.value,dashboard[0].scores.overall.value]);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'get_venue_performance_analytics');
 assert.equal(f.calls[0].args.p_since,new Date(now-14*86400000).toISOString());
 assert.equal(f.calls[0].args.p_until,new Date(now).toISOString());
 assert.equal(Date.parse(f.calls[0].args.p_tonight_until)-Date.parse(f.calls[0].args.p_tonight_since),86400000);
});
test('explicit club wins; otherwise only the most recent active affiliation supplies placement',async()=>{
 const report=[dancer('a',18),dancer('b'),dancer('c')], other=[dancer('a',0),dancer('b'),dancer('c')];
 const affiliations=[{id:'1',dancer_id:'a',venue_id:'club',status:'active',approved_at:'2026-10-01'},
 {id:'2',dancer_id:'a',venue_id:'other',status:'active',approved_at:'2026-09-01'},
 {id:'3',dancer_id:'a',venue_id:'revoked',status:'revoked',approved_at:'2026-10-12'}];
 const f=fixture({club:report,other},affiliations);
 const result=await f.service.getPerformancePlacementScores(f.admin,[{dancerId:'a'},{dancerId:'a',venueId:'other'},{dancerId:'new'}],now);
 assert.deepEqual(Array.from(result),[scoring.scoreVenueDancers(report,'14d')[0].scores.overall.value,scoring.scoreVenueDancers(other,'14d')[0].scores.overall.value,null]);
 assert.deepEqual(f.calls.map(c=>c.args.p_venue_id).sort(),['club','other']);
});

test('public placement rewards recorded External-only and Both time equally over Internal-only', async () => {
 const cohort = [dancer('a-internal'), dancer('b-external'), dancer('c-both')];
 cohort[1].internal.rosterExternalHours = 8;
 Object.assign(cohort[2].internal, { rosterExternalHours: 8, rosterExternalTrackedHours: 8, rosterBothHours: 8 });
 cohort[0].internal.rosterExternalHours = 0;
 const f = fixture({ club: cohort });
 const rows = cohort.map(row => ({ id: row.id }));
 const result = await f.service.orderByPerformance(f.admin, rows, row => ({ dancerId: row.id, venueId: 'club' }), row => row.id);
 assert.deepEqual(Array.from(result, row => row.id), ['b-external', 'c-both', 'a-internal']);
 const cards = await f.service.getPerformancePlacementScorecards(f.admin, rows.map(row => ({ dancerId: row.id, venueId: 'club' })));
 assert.deepEqual(Array.from(cards, card => card.scores.externalTime.value), [0, 67, 67]);
});
test('duplicate dancers and concurrent requests share a report; scores refresh after one minute',async()=>{
 const report=[dancer('a',18),dancer('b'),dancer('c')], f=fixture({club:report});
 const ids=Array.from({length:25},()=>({dancerId:'a',venueId:'club'}));
 const [a,b]=await Promise.all([f.service.getPerformancePlacementScores(f.admin,ids,now),f.service.getPerformancePlacementScores(f.admin,ids,now)]);
 assert.deepEqual(a,b);assert.equal(f.calls.length,1);
 report[0].results.profileCohortConversions=0;
 const refreshed=await f.service.getPerformancePlacementScores(f.admin,ids,now+61000);
 assert.equal(f.calls.length,2);assert.ok(refreshed[0]<a[0]);
});

test('public ordering uses the five-minute benefit before other categories qualify',async()=>{
 const beginner=(id,hours)=>({id,name:id,internal:{rosterTrackedHours:hours,rosterExternalTrackedHours:hours,rosterExternalHours:hours,
   rosterBothHours:0,verifiedCheckInDays:1},vip:{},external:{},results:{}});
 const cohort=[beginner('a-under-five',299/3600),beginner('b-five-minutes',5/60),beginner('c-hour',1)];
 const f=fixture({club:cohort});
 const rows=cohort.map(({id})=>({id}));
 const ordered=await f.service.orderByPerformance(f.admin,rows,row=>({dancerId:row.id,venueId:'club'}),row=>row.id);
 assert.deepEqual(Array.from(ordered,row=>row.id),['c-hour','b-five-minutes','a-under-five']);
 const scores=await f.service.getPerformancePlacementScores(f.admin,rows.map(row=>({dancerId:row.id,venueId:'club'})));
 assert.deepEqual(Array.from(scores),[null,1,8]);
});
test('report failures reject and are evicted instead of reviving the retired algorithm',async()=>{
 const f=fixture({club:[dancer('a')]});f.fail(true);
 await assert.rejects(f.service.getPerformancePlacementScores(f.admin,[{dancerId:'a',venueId:'club'}],now),/unavailable/);
 f.fail(false);assert.equal((await f.service.getPerformancePlacementScores(f.admin,[{dancerId:'a',venueId:'club'}],now)).length,1);
 assert.equal(f.calls.length,2);
});
test('ordered public cards contain no private scores or report fields and unscored dancers remain visible',async()=>{
 const f=fixture({club:[dancer('a',18),dancer('b',2),dancer('c')]});
 const rows=[{id:'new'},{id:'b'},{id:'a'}];
 const result=await f.service.orderByPerformance(f.admin,rows,row=>({dancerId:row.id,venueId:'club'}),row=>row.id);
 assert.deepEqual(Array.from(result),[rows[2],rows[1],rows[0]]);
 assert.deepEqual(rows.map(r=>r.id),['new','b','a']);
 assert.doesNotMatch(JSON.stringify(result),/score|Private|internal|external|vip/);
});

test('own scorecards match every venue category while omitting other dancer identities and raw reports',async()=>{
 const cohort=[dancer('a',18),dancer('b',2),dancer('private-peer',10)],f=fixture({club:cohort});
 const [card]=await f.service.getPerformancePlacementScorecards(f.admin,[{dancerId:'a',venueId:'club'}],now);
 const expected=scoring.scoreVenueDancers(cohort,'14d')[0].scores;
 assert.equal(card.venueId,'club');assert.equal(card.periodEnd,new Date(now).toISOString());
 assert.equal(card.externalHours,8);
 assert.equal(card.periodStart,new Date(now-14*86400000).toISOString());
 for(const key of ['overall',...scoring.DANCER_SCORE_CATEGORIES]) {
   assert.equal(card.scores[key].value,expected[key].value);assert.equal(card.scores[key].confidence,expected[key].confidence);
   assert.equal(card.scores[key].evidence,expected[key].evidence);assert.equal(card.scores[key].details,undefined);
 }
 assert.doesNotMatch(JSON.stringify(card),/Private|private-peer|profileClaims|dancer_id|customer_id/);
 assert.equal((await f.service.getPerformancePlacementScores(f.admin,[{dancerId:'a',venueId:'club'}],now))[0],card.scores.overall.value);
 assert.equal(f.calls.length,1);
});

test('recorded external hours earn early scores without peers, while unobserved history stays unknown',async()=>{
 const early=dancer('early');Object.assign(early.internal,{rosterTrackedHours:1,rosterExternalTrackedHours:1,rosterExternalHours:0.5});
 const unknown=dancer('unknown');delete unknown.internal.rosterExternalTrackedHours;
 const f=fixture({club:[early,unknown]});
 const cards=await f.service.getPerformancePlacementScorecards(f.admin,[{dancerId:'early',venueId:'club'},{dancerId:'unknown',venueId:'club'}],now);
 assert.equal(cards[0].scores.externalTime.value,11);assert.equal(cards[0].externalHours,0.5);
 assert.equal(cards[1].externalHours,null);
});

test('recent performance changes placement when older activity falls outside 14 days',async()=>{
 const day=86400000;
 const claims={a:[{at:now-20*day,count:100,redeemed:100},{at:now-2*day,count:20,redeemed:0}],
  b:[{at:now-20*day,count:100,redeemed:0},{at:now-2*day,count:20,redeemed:20}],
  c:[{at:now-2*day,count:20,redeemed:10}]};
 const report=({p_since,p_until})=>Object.entries(claims).map(([id,events])=>{
  const included=events.filter(event=>event.at>=Date.parse(p_since)&&event.at<Date.parse(p_until));
  return {...dancer(id),results:{profileClaims:included.reduce((sum,event)=>sum+event.count,0),
   profileCohortConversions:included.reduce((sum,event)=>sum+event.redeemed,0)}};
 });
 const month=scoring.scoreVenueDancers(report({p_since:new Date(now-30*day).toISOString(),p_until:new Date(now).toISOString()}),'30d');
 assert.ok(month[0].scores.overall.value>month[1].scores.overall.value);
 const f=fixture({club:report});
 const cards=await f.service.getPerformancePlacementScorecards(f.admin,[{dancerId:'a',venueId:'club'},{dancerId:'b',venueId:'club'}],now);
 assert.equal(cards[0].scores.conversions.value,0);assert.equal(cards[1].scores.conversions.value,100);
 assert.ok(cards[1].scores.overall.value>cards[0].scores.overall.value);
 // The window rolls with the current time rather than resetting on a calendar boundary.
 await f.service.getPerformancePlacementScores(f.admin,[{dancerId:'a',venueId:'club'}],now+day);
 assert.equal(f.calls.at(-1).args.p_since,new Date(now-13*day).toISOString());
});
