import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as limits from '../src/lib/dancr/media-limits.ts';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/onboarding-media-submission.ts','utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports,require:name=>name==='server-only'?{}:name==='./media-limits'?limits:assert.fail(name)});
const media = () => [0,1,2,3].map(i=>({id:`item-${i}`,dancer_id:'owner-profile',kind:i===3?'video':'photo',source:i===3?'video':'upload',content_version:'v1',is_main:i===0,
  record:{status:i===3?'submitted':'pending_review',upload_context:i===0?'profile_main':'profile_gallery',distribution_scope:'profile_and_feed'}}));
const receipts = rows => [{items:rows.map(row=>({key:`${row.source}:${row.id}`,version:row.content_version}))}];
async function check(rows,submissions=[],error,venue=null,rejections=[]) {
  const db={rpc:async(name,args)=>{assert.equal(name,'dancer_club_media');assert.deepEqual(Array.from(args.p_dancer_ids),['owner-profile']);return{data:rows,error:error==='media'?new Error('read failed'):null};},
    from(table){if(table==='club_media_permissions')return {select:()=>({eq:()=>({eq:()=>({eq:async()=>({data:rejections})})})})};
      assert.equal(table,'dancer_media_submissions');return{select(columns){assert.equal(columns,'items');return{async eq(column,value){assert.equal(column,'dancer_id');assert.equal(value,'owner-profile');return{data:submissions,error:error==='receipts'?new Error('read failed'):null};}};}};}};
  return JSON.parse(JSON.stringify(await exports.onboardingMediaSubmission(db,'owner-profile',venue)));
}

test('uploaded drafts are ready to submit but only matching receipts unlock the agreement',async()=>{
  const rows=media();assert.deepEqual(await check(rows),{ready:true,submitted:false});
  assert.deepEqual(await check(rows,receipts(rows)),{ready:true,submitted:true});
  assert.deepEqual(await check(rows,receipts(rows.slice(0,3))),{ready:true,submitted:false});
  assert.deepEqual(await check(rows,receipts(rows.slice(1))),{ready:true,submitted:false});
});
test('changed versions and removed required media invalidate an older submission',async()=>{
  const rows=media(),sent=receipts(rows);rows[3].content_version='v2';
  assert.deepEqual(await check(rows,sent),{ready:true,submitted:false});
  assert.deepEqual(await check(rows.slice(1),sent),{ready:false,submitted:false});
  assert.deepEqual(await check(rows.slice(0,3),sent),{ready:false,submitted:false});
});
test('avatars, feed-only videos, other clubs and other owners cannot fill required slots',async()=>{
  for(const modify of [rows=>rows[2].record.upload_context='profile_avatar',rows=>rows[3].record.distribution_scope='feed_only',
    rows=>rows[2].record.editor_venue_id='other-club',rows=>rows[2].dancer_id='other-owner',rows=>rows[0].is_main=false]){
    const rows=media();modify(rows);assert.deepEqual(await check(rows,receipts(rows)),{ready:false,submitted:false});
  }
});
test('approved media and submitted pending reviews count while optional drafts do not block continuation',async()=>{
  const rows=media();rows.forEach(row=>row.record.status='approved');
  assert.deepEqual(await check(rows),{ready:true,submitted:true});
  const drafts=media(),sent=receipts(drafts);drafts.push({...drafts[2],id:'extra'});
  assert.deepEqual(await check(drafts,sent),{ready:true,submitted:true});
});
test('duplicate main photos and replacements cannot inflate the required total',async()=>{
  const rows=media();rows[1].is_main=true;assert.deepEqual(await check(rows,receipts(rows)),{ready:false,submitted:false});
  const replaced=media();replaced[1].record.status='approved';replaced[1].photo_id='original';
  Object.assign(replaced[2].record,{photo_publication_mode:'replace',replacement_photo_id:'original'});
  assert.deepEqual(await check(replaced,receipts(replaced)),{ready:false,submitted:false});
});
test('a submitted video rejected by this club needs a submitted replacement for the same club',async()=>{
  const rows=media(), sent=receipts(rows), rejected=[{source:'video',media_id:'item-3',content_version:'v1'}];
  const item={...rows[3],id:'replacement',record:{...rows[3].record,editor_venue_id:'club-a'}};
  const checkA=receipts=>check([...rows,item],receipts,undefined,'club-a',rejected);
  assert.deepEqual(await checkA(sent),{ready:true,submitted:false});
  assert.deepEqual(await checkA([...sent,...receipts([item])]),{ready:true,submitted:true});
  assert.deepEqual(await check([...rows,item],sent,undefined,'club-b',rejected),{ready:false,submitted:false});
});
test('a failed required-media or receipt lookup cannot claim submission',async()=>{
  for(const error of ['media','receipts'])await assert.rejects(check(media(),[],error),/read failed/);
});
