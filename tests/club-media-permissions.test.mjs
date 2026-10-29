import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/club-media-permissions.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports,Map,Set,Error,require:()=>({})});
const {restrictClubCard,restrictClubCards,restrictClubProfile,clubMediaPermissions,withApprovedClubAffiliations}=exports;
const card={id:'dancer',venueId:'club-a',primaryPhotoUrl:'main.jpg',primaryPhotoFocalX:20,primaryPhotoWidth:500,
  avatarPhotoUrl:'personal-avatar.jpg',galleryPhotoIds:['main','safe','declined'],galleryPhotoUrls:['main.jpg','safe.jpg','declined.jpg'],
  galleryPhotoSrcSets:['main-set','safe-set','declined-set'],galleryPhotoPins:[true,false,true],galleryPhotoLikeCounts:[4,2,3]};
const media=ids=>({photoIds:new Set(ids),videoIds:new Set(),avatarPaths:new Set()});
const normalize=value=>JSON.parse(JSON.stringify(value));

test('approved main photos retain their linked avatar crop and its own responsive framing',()=>{
 const linked={...card,avatarSourcePhotoId:'main',avatarPhotoUrl:'face-crop.jpg',avatarPhotoSrcSet:'face-set',
   avatarPhotoFocalX:43,avatarPhotoFocalY:37,avatarPhotoWidth:320,avatarPhotoHeight:320};
 const scoped=restrictClubCard(linked,media(['main','safe']));
 for(const key of ['avatarPhotoUrl','avatarPhotoSrcSet','avatarPhotoFocalX','avatarPhotoFocalY','avatarPhotoWidth','avatarPhotoHeight','avatarSourcePhotoId'])assert.equal(scoped[key],linked[key]);
 assert.equal(scoped.primaryPhotoUrl,'main.jpg');
 const elsewhere=restrictClubCard(linked,media(['safe']));
 assert.equal(elsewhere.avatarPhotoUrl,'safe.jpg');assert.equal(elsewhere.avatarSourcePhotoId,null);
 assert.equal(elsewhere.avatarPhotoSrcSet,'safe-set');assert.equal(elsewhere.avatarPhotoFocalX,50);
 assert.equal(restrictClubCard({...linked,avatarSourcePhotoId:null},media(['main'])).avatarPhotoUrl,'main.jpg');
 assert.equal(restrictClubCard({...linked,avatarSourcePhotoId:'declined'},media(['main'])).avatarPhotoUrl,'main.jpg');
 assert.equal(restrictClubCard(linked,media([])),null);
 assert.equal(linked.avatarPhotoUrl,'face-crop.jpg');
});

test('public card builder links an avatar only to the current approved main photo version',()=>{
 const source=readFileSync('src/lib/dancr/public.ts','utf8');
 const code=source.slice(source.indexOf('function buildDancerCard('),source.indexOf('async function toDancerCards('))
   +source.slice(source.indexOf('function approvedDancerPhotoSources('),source.indexOf('function approvedSocialLinks('));
 const context=vm.createContext({Date,Number,approvedSocialLinks:()=>[],safeMetricCount:Number,publicLocationStatus:()=>undefined,
   responsivePublicImage:(_client,_bucket,path)=>path?{imageUrl:path,imageSrcSet:path+'-set',imageFocalX:50,imageFocalY:50,imageWidth:320,imageHeight:320}:null});
 vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const row={id:'dancer',avatar_storage_path:'saved-crop.jpg',avatar_source_photo_id:'main',avatar_source_storage_path:'main-v2.jpg',
   dancer_photos:[{id:'main',storage_path:'main-v2.jpg',is_primary:true,review_status:'approved'},
   {id:'safe',storage_path:'safe.jpg',is_primary:false,is_pinned:true,review_status:'approved'}]};
 const build=changes=>context.buildDancerCard({}, {...row,...changes}).card;
 const current=build({});assert.equal(current.avatarSourcePhotoId,'main');assert.equal(current.primaryPhotoUrl,'main-v2.jpg');
 assert.equal(restrictClubCard(current,media(['main'])).avatarPhotoUrl,'saved-crop.jpg');
 for(const changes of [{avatar_source_storage_path:'old-version.jpg'},{avatar_source_photo_id:'missing'},
   {avatar_source_photo_id:'safe',avatar_source_storage_path:'safe.jpg'},{avatar_storage_path:null},
   {dancer_photos:row.dancer_photos.map(photo=>({...photo,review_status:photo.id==='main'?'pending':photo.review_status}))}]){
  const result=build(changes);assert.equal(result.avatarSourcePhotoId,null);
  assert.notEqual(restrictClubCard(result,media(['main','safe']))?.avatarPhotoUrl,'saved-crop.jpg');
 }
});

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

test('approved affiliation decorates an off-shift card without inventing Working Now or replacing live presence',async()=>{
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push({name,args});return {data:[{dancer_id:'dancer',venue_id:'club-b',venue_name:'New club',venue_slug:'new-club'}]};}};
  const personal={...card,venueId:null,shiftId:null,checkedInAt:null,locationVerificationExpiresAt:null};
  const result=await withApprovedClubAffiliations(client,[personal,card]);
  assert.equal(result[0].venueId,'club-b');assert.equal(result[0].venueName,'New club');
  assert.equal(result[0].shiftId,null);assert.equal(result[0].checkedInAt,null);assert.equal(result[1],card);
  assert.deepEqual(normalize(calls[0]),{name:'public_dancer_club_affiliations',args:{p_dancer_ids:['dancer']}});
  assert.equal((await withApprovedClubAffiliations({rpc:async()=>({data:[]})},[personal]))[0],personal);
});
