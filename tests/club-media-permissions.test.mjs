import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/club-media-permissions.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports,Map,Set,Error,require:()=>({})});
const {restrictClubCard,restrictClubCards,restrictClubProfile,clubMediaPermissions}=exports;
const card={id:'dancer',venueId:'club-a',primaryPhotoUrl:'main.jpg',primaryPhotoFocalX:20,primaryPhotoWidth:500,
  avatarPhotoUrl:'personal-avatar.jpg',galleryPhotoIds:['main','safe','declined'],galleryPhotoUrls:['main.jpg','safe.jpg','declined.jpg'],
  galleryPhotoSrcSets:['main-set','safe-set','declined-set'],galleryPhotoPins:[true,false,true],galleryPhotoLikeCounts:[4,2,3]};
const media=ids=>({photoIds:new Set(ids),videoIds:new Set(),avatarPaths:new Set()});
const normalize=value=>JSON.parse(JSON.stringify(value));

test('club fallback changes the main photo and avatar, keeping gallery metadata aligned',()=>{
  const scoped=restrictClubCard(card,media(['safe']));
  assert.equal(scoped.primaryPhotoUrl,'safe.jpg');assert.equal(scoped.avatarPhotoUrl,'safe.jpg');
  assert.equal(scoped.primaryPhotoSrcSet,'safe-set');assert.equal(scoped.avatarPhotoSrcSet,'safe-set');
  assert.equal(scoped.primaryPhotoFocalX,50);assert.equal(scoped.primaryPhotoWidth,null);
  assert.deepEqual(normalize(scoped.galleryPhotoIds),['safe']);assert.deepEqual(normalize(scoped.galleryPhotoLikeCounts),[2]);
  assert.deepEqual(normalize(scoped.galleryPhotoPins),[false]);assert.equal(card.primaryPhotoUrl,'main.jpg');
  assert.equal(restrictClubCard(card,media([])),null);
});

test('the same dancer has different cards at two clubs while an unassociated personal card is unchanged',async()=>{
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push([name,args]);return{data:[{dancerId:'dancer',photoId:args.p_venue_id==='club-a'?'main':'safe'}]};}};
  const personal={...card,venueId:null};
  const result=await restrictClubCards(client,[card,{...card,venueId:'club-b'},personal]);
  assert.equal(result[0].primaryPhotoUrl,'main.jpg');assert.equal(result[1].primaryPhotoUrl,'safe.jpg');assert.equal(result[2],personal);
  assert.equal(calls.length,2);
  const profile=await restrictClubProfile(client,{...card,photos:[{id:'main'},{id:'safe'},{id:'declined'}]},'club-b');
  assert.deepEqual(normalize(profile.photos),[{id:'safe'}]);
});

test('permission lookup fails closed and ignores unrelated dancer rows',async()=>{
  for(const result of [{error:new Error('offline')},{data:null}])await assert.rejects(clubMediaPermissions({rpc:async()=>result},'club-a',['dancer']));
  const result=await clubMediaPermissions({rpc:async()=>({data:[{dancerId:'other',photoId:'main'}]})},'club-a',['dancer']);
  assert.equal(result.get('dancer').photoIds.size,0);
});
