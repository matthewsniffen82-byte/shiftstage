import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import { profilePhotoSlotFromUploadContext } from '../src/lib/dancr/photo-slot.ts';
import { MYDANCR_TV_POSTER_BUCKET, myDancrTvPosterStoragePath } from '../src/lib/dancr/media-watermark.ts';

const tvExports={};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/tv.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:tvExports,require:()=>({myDancrTvPosterStoragePath})});

const compiled=ts.transpileModule(readFileSync('app/api/venue/media-reviews/route.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const avatarExports={};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/dancr/venue-media-avatar.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:avatarExports,require:()=>({APPROVED_PHOTO_BUCKET:'dancer-photos',profilePhotoSlotFromUploadContext})});
const dancerId='12345678-1234-4123-8123-123456789012';
const photo={id:'photo',decision:'review',status:'pending_review',updated_at:'2026-10-23T00:00:00Z',upload_context:'profile_main',
  category_flags:{file_checks_passed:true},temporary_storage_path:'private/photo',user_id:'private-owner'};
function fixture(data,{profiles=[],pending=[],unavailable=[],queryError=null}={}){
  const calls=[],signed=[],access=[],thumbnails=[],queries=[];
  function from(table){
    const query={table,filters:[],orders:[]};queries.push(query);
    const builder={
      select(columns){query.columns=columns;return builder;},
      in(key,value){query.filters.push({op:'in',key,value:Array.from(value)});return builder;},
      eq(key,value){query.filters.push({op:'eq',key,value});return builder;},
      like(key,value){query.filters.push({op:'like',key,value});return builder;},
      not(key,operator,value){query.filters.push({op:'not',key,value});assert.equal(operator,'is');return builder;},
      order(key,options){query.orders.push({key,...options});return builder;},
      then(resolve,reject){
        if(queryError===table)return Promise.resolve({error:new Error('Query unavailable')}).then(resolve,reject);
        let rows=structuredClone(table==='dancer_profiles'?profiles:pending);
        for(const {op,key,value} of query.filters){
          if(key.startsWith('dancer_photos.')){
            rows=rows.map(row=>({...row,dancer_photos:row.dancer_photos.filter(photo=>photo[key.split('.')[1]]===value)}));continue;
          }
          rows=rows.filter(row=>{
            const actual=key.split('->>').reduce((current,part)=>current?.[part],row);
            if(op==='in')return value.includes(actual);
            if(op==='like')return actual.startsWith(value.slice(0,-1));
            if(op==='not')return actual!==null&&actual!==undefined;
            return key.includes('->>')?String(actual)===value:actual===value;
          });
        }
        rows.sort((a,b)=>{for(const {key,ascending} of query.orders){const diff=String(a[key]).localeCompare(String(b[key]));if(diff)return ascending?diff:-diff;}return 0;});
        return Promise.resolve({data:rows}).then(resolve,reject);
      },
    };return builder;
  }
  const deps={PublicApiError,profilePhotoSlotFromUploadContext,NextResponse:{json:body=>body},apiError:e=>({status:e.status||500,message:e.message}),
    venueMediaAvatar:avatarExports.venueMediaAvatar,
    createRequestSupabaseContext:async()=>({user:{id:'actor'},session:{}}),requireActiveVenueAccount:async()=>{},
    requireVenueAccess:async(_db,actor,permission)=>{access.push({actor,permission});return{venueId:'club'};},
    createAdminSupabaseClient:()=>({from,rpc:async(name,args)=>{calls.push({name,args});return{data};},
      storage:{from:bucket=>({createSignedUrl:async(path,ttl)=>{signed.push({bucket,path,ttl});return unavailable.includes(path)
        ? {error:new Error('Missing file')} : {data:{signedUrl:bucket==='videos'?'/signed-video':path.startsWith('tv-posters/')?'/signed-poster':'/signed/'+path}};}})}}),
    withSignedThumbnail:async(_db,record)=>{thumbnails.push(record);const path=record.decision==='approved'?record.final_storage_path:record.temporary_storage_path;
      return{thumbnailUrl:unavailable.includes(path)?'':'/signed/'+path};},
    MYDANCR_TV_BUCKET:'videos',MYDANCR_TV_POSTER_BUCKET,normalizedVideoPosterStoragePath:tvExports.normalizedVideoPosterStoragePath,
  };
  const exports={};vm.runInNewContext(compiled,{exports,require:()=>deps,URL,console});
  return{calls,signed,access,thumbnails,queries,get:query=>exports.GET({url:'https://example.test/api/venue/media-reviews'+query})};
}
const approved={id:'approved',storage_path:'approved/main.jpg',is_primary:true,review_status:'approved'};
const profile={id:dancerId,user_id:'private-owner',dancer_photos:[approved]};
const card={id:dancerId,stageName:'Star',count:3,photoCount:2,videoCount:1,kind:'photo',record:{...photo,upload_context:'profile_gallery:1'}};

test('dancer overview uses pending main photos and approved mains for video-only queues without returning private records',async()=>{
  const f=fixture({count:5,dancerCount:2,items:[],dancers:[
    card,
    {id:'other',stageName:'Star',count:2,photoCount:0,videoCount:2,kind:'video',record:{storage_path:'private/video.mp4',moderation_details:{posterStoragePath:'private/poster.jpg'}}},
  ]},{profiles:[profile,{id:'other',user_id:'other-owner',dancer_photos:[{...approved,storage_path:'other/main.jpg'}]}],pending:[photo]});
  const result=await f.get('?view=dancers&offset=12');
  assert.equal(result.dancers.length,2);assert.equal(result.count,5);assert.equal(result.dancerCount,2);
  assert.equal(f.calls[0].name,'get_venue_dancer_media_grid');assert.equal(f.calls[0].args.p_offset,12);
  assert.deepEqual(f.access,[{actor:'actor',permission:'manage_roster'}]);
  assert.deepEqual(f.signed,[]);
  assert.equal(result.dancers[0].previewUrl,'/signed/private/photo');
  assert.equal(result.dancers[1].previewUrl,'/signed/other/main.jpg');
  assert.equal(f.queries.length,2);
  assert.deepEqual(f.queries[0].filters.find(filter=>filter.op==='in').value,[dancerId,'other']);
  assert.deepEqual(f.queries[1].filters.find(filter=>filter.op==='in').value,['private-owner','other-owner']);
  assert.doesNotMatch(JSON.stringify(result),/private-owner|temporary_storage_path|storage_path|moderation_details|category_flags/);
});
test('selected dancer query uses the Main photo/avatar label and preserves approval gates',async()=>{
  const f=fixture({count:3,uploadCount:1,dancerCount:2,dancers:[],items:[{id:'photo',dancerId,kind:'photo',stageName:'Star',record:photo}]});
  const result=await f.get('?view=dancers&dancerId='+dancerId);
  assert.equal(f.calls[0].args.p_dancer_id,dancerId);assert.equal(result.uploadCount,1);
  assert.equal(result.items[0].label,'Main photo/avatar');assert.equal(result.items[0].canApprove,true);
  assert.equal(result.items[0].version,photo.updated_at);assert.equal(result.items[0].previewUrl,'/signed/private/photo');
  assert.equal(f.queries.length,0);
});

const videoRecord={id:dancerId,caption:dancerId,storage_path:'owner/video.mp4',status:'submitted',updated_at:photo.updated_at,
  moderation_details:{fileChecksPassed:true,posterStoragePath:'tv-posters/owner/video.poster.webp'}};
const videoData=record=>({dancers:[],items:[{id:dancerId,dancerId,kind:'video',stageName:'Star',record}]});

test('video reviews sign the real poster from the image bucket and hide generated file-ID captions',async()=>{
  const f=fixture(videoData(videoRecord));
  const result=await f.get('?view=dancers&dancerId='+dancerId);
  assert.equal(result.items[0].previewUrl,'/signed-video');
  assert.equal(result.items[0].posterUrl,'/signed-poster');
  assert.equal(result.items[0].caption,null);
  assert.equal(result.items[0].canApprove,true);
  assert.deepEqual(f.signed,[{bucket:'videos',path:'owner/video.mp4',ttl:300},
    {bucket:MYDANCR_TV_POSTER_BUCKET,path:'tv-posters/owner/video.poster.webp',ttl:300}]);
  assert.doesNotMatch(JSON.stringify(result),/storage_path|moderation_details|posterStoragePath/);
});

test('missing or mismatched posters do not block playback or sign another video image',async()=>{
  for(const posterStoragePath of [undefined,'tv-posters/another/video.poster.webp']){
    const f=fixture(videoData({...videoRecord,moderation_details:{fileChecksPassed:true,posterStoragePath}}));
    const result=await f.get('?view=dancers&dancerId='+dancerId);
    assert.equal(result.items[0].posterUrl,'');assert.equal(result.items[0].previewUrl,'/signed-video');
    assert.equal(f.signed.length,1);
  }
  const f=fixture(videoData(videoRecord),{unavailable:['tv-posters/owner/video.poster.webp']});
  const result=await f.get('?view=dancers&dancerId='+dancerId);
  assert.equal(result.items[0].posterUrl,'');assert.equal(result.items[0].previewUrl,'/signed-video');
});

test('file-ID labels with video extensions are hidden but written captions remain reviewable',async()=>{
  for(const caption of [dancerId,' '+dancerId+'.MOV ',null,'']){
    const f=fixture(videoData({...videoRecord,caption}));
    assert.equal((await f.get('?view=dancers&dancerId='+dancerId)).items[0].caption,null);
  }
  const f=fixture(videoData({...videoRecord,caption:'New performance tonight'}));
  assert.equal((await f.get('?view=dancers&dancerId='+dancerId)).items[0].caption,'New performance tonight');
});
test('newest checked main wins even after club signoff while unrelated and unsafe uploads are excluded',async()=>{
  const candidate=(id,extra={})=>({...photo,id,created_at:'2026-10-23T01:00:00Z',temporary_storage_path:id,...extra});
  const f=fixture({dancers:[card]}, {profiles:[profile,{id:'foreign',user_id:'foreign-owner',dancer_photos:[]}],pending:[
    candidate('older',{created_at:'2026-10-22T01:00:00Z'}),
    candidate('new-main',{upload_context:'profile_main:0',club_reviewed_at:'2026-10-23T02:00:00Z'}),
    candidate('rejected',{decision:'rejected'}),candidate('processing',{status:'moderating'}),candidate('unchecked',{category_flags:{}}),
    candidate('gallery',{upload_context:'profile_gallery:1'}),candidate('avatar',{upload_context:'profile_avatar'}),
    candidate('foreign',{user_id:'foreign-owner'}),candidate('missing',{temporary_storage_path:null}),
  ]});
  const result=await f.get('?view=dancers');
  assert.equal(result.dancers[0].previewUrl,'/signed/new-main');
  assert.equal(f.thumbnails.length,1);
  assert.equal(f.thumbnails[0].id,'new-main');
  assert.deepEqual(f.queries[1].filters.find(filter=>filter.op==='in').value,['private-owner']);
});

test('current approved primary is the fallback, never an old main, avatar, gallery photo or poster',async()=>{
  for(const pending of [[],[{...photo,image_id:approved.id,final_storage_path:approved.storage_path}]]){
    const f=fixture({dancers:[card]}, {profiles:[{...profile,dancer_photos:[
      {...approved,id:'old-main',is_primary:false,storage_path:'old.jpg'},
      {...approved,id:'unapproved',review_status:'pending',storage_path:'unapproved.jpg'},approved,
    ]}],pending});
    assert.equal((await f.get('?view=dancers')).dancers[0].previewUrl,'/signed/approved/main.jpg');
    assert.equal(f.thumbnails.length,1);
  }
  const f=fixture({dancers:[card]}, {profiles:[profile],pending:[photo],unavailable:['private/photo']});
  assert.equal((await f.get('?view=dancers')).dancers[0].previewUrl,'/signed/approved/main.jpg');
  const missing=fixture({dancers:[card]}, {profiles:[{...profile,dancer_photos:[]}]});
  assert.equal((await missing.get('?view=dancers')).dancers[0].previewUrl,'');
  assert.equal(missing.thumbnails.length,0);
  const failed=fixture({dancers:[card]}, {profiles:[profile],queryError:'image_moderation_records'});
  assert.equal((await failed.get('?view=dancers')).status,500);
  assert.equal(failed.thumbnails.length,0);
});

test('count-only uses no previews; invalid dancer IDs never reach the queue',async()=>{
  const f=fixture({count:5,dancerCount:2,dancers:[],items:[]});
  assert.equal((await f.get('?view=dancers&countOnly=1')).count,5);
  assert.equal(f.calls[0].args.p_limit,0);assert.equal(f.signed.length,0);assert.equal(f.thumbnails.length,0);
  assert.equal(f.queries.length,0);
  assert.equal((await f.get('?view=dancers&dancerId=wrong')).status,400);assert.equal(f.calls.length,1);
});

const avatarPath=`private-owner/${dancerId}/avatar/approved.jpg`;
const mainPath=`private-owner/${dancerId}/replacement.jpg`;
const avatarProfile={...profile,avatar_storage_path:avatarPath};
const selectedData={count:1,uploadCount:1,dancers:[],items:[],dancer:{id:dancerId,stageName:'Star'}};
const preparedMain={...photo,final_storage_path:mainPath,created_at:'2026-10-23T01:00:00Z',
  category_flags:{file_checks_passed:true,publication_prepared:true}};

test('opened approval view shows the actual approved avatar without exposing profile data',async()=>{
  const f=fixture(selectedData,{profiles:[avatarProfile]});
  const result=await f.get('?view=dancers&dancerId='+dancerId);
  assert.equal(result.dancerAvatar.url,'/signed/'+avatarPath);assert.equal(result.dancerAvatar.status,'approved');
  assert.deepEqual(f.signed,[{bucket:'dancer-photos',path:avatarPath,ttl:300}]);
  assert.doesNotMatch(JSON.stringify(result),/user_id|avatar_storage_path|category_flags/);
});

test('pending main face crop or pending avatar replaces the approved avatar, including after club signoff',async()=>{
  for(const upload_context of ['profile_main','profile_main:0','profile_avatar']){
    const f=fixture(selectedData,{profiles:[avatarProfile],pending:[{...preparedMain,upload_context,club_reviewed_at:'2026-10-23T02:00:00Z'}]});
    const result=await f.get('?view=dancers&dancerId='+dancerId);
    const path=mainPath+(upload_context==='profile_avatar'?'':'.avatar.jpg');
    assert.equal(result.dancerAvatar.url,'/signed/'+path);assert.equal(result.dancerAvatar.status,'pending');
    assert.deepEqual(f.signed,[{bucket:'dancer-photos',path,ttl:300}]);
  }
});

test('unprepared, rejected, unrelated and already-published media cannot become the pending avatar',async()=>{
  for(const extra of [
    {category_flags:{file_checks_passed:true}}, {category_flags:{publication_prepared:true}},
    {decision:'rejected'}, {status:'moderating'}, {upload_context:'profile_gallery:1'}, {user_id:'someone-else'},
    {image_id:approved.id}, {final_storage_path:approved.storage_path},
    {upload_context:'profile_avatar',final_storage_path:avatarPath},
  ]){
    const f=fixture(selectedData,{profiles:[avatarProfile],pending:[{...preparedMain,...extra}]});
    const result=await f.get('?view=dancers&dancerId='+dancerId);
    assert.equal(result.dancerAvatar.status,'approved');assert.equal(f.signed.length,1);assert.equal(f.signed[0].path,avatarPath);
  }
});

test('the newest pending avatar wins; unavailable or unsafe crops fall back to the approved avatar',async()=>{
  const pending=[{...preparedMain,id:'old',final_storage_path:mainPath+'old',created_at:'2026-10-22T00:00:00Z'},preparedMain];
  const f=fixture(selectedData,{profiles:[avatarProfile],pending});
  assert.equal((await f.get('?dancerId='+dancerId)).dancerAvatar.url,'/signed/'+mainPath+'.avatar.jpg');
  for(const path of ['another-owner/main.jpg',`private-owner/${dancerId}/../other.jpg`,`private-owner/${dancerId}/bad\\path.jpg`,mainPath]){
    const f=fixture(selectedData,{profiles:[avatarProfile],pending:[{...preparedMain,final_storage_path:path}],unavailable:[mainPath+'.avatar.jpg']});
    assert.equal((await f.get('?dancerId='+dancerId)).dancerAvatar.status,'approved');
    assert.ok(f.signed.every(item=>item.path===mainPath+'.avatar.jpg'||item.path===avatarPath));
  }
  const missing=fixture(selectedData,{profiles:[{...avatarProfile,avatar_storage_path:null}]});
  assert.equal((await missing.get('?dancerId='+dancerId)).dancerAvatar,null);
});

test('avatar lookup requires the exact venue-authorized dancer and is skipped for counts and outer grids',async()=>{
  for(const [data,query] of [
    [{...selectedData,dancer:null},'?dancerId='+dancerId],
    [{...selectedData,dancer:{id:'other'}},'?dancerId='+dancerId],
    [selectedData,'?dancerId='+dancerId+'&countOnly=1'], [selectedData,'?view=dancers'],
  ]){
    const f=fixture(data,{profiles:[avatarProfile],pending:[preparedMain]});
    assert.equal((await f.get(query)).dancerAvatar,null);assert.equal(f.queries.length,0);assert.equal(f.signed.length,0);
  }
});
