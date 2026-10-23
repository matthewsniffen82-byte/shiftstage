import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const compiled=ts.transpileModule(readFileSync('app/api/venue/media-reviews/route.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const dancerId='12345678-1234-4123-8123-123456789012';
const photo={id:'photo',status:'pending_review',updated_at:'2026-10-23T00:00:00Z',upload_context:'profile_main',
  category_flags:{file_checks_passed:true},temporary_storage_path:'private/photo',user_id:'private-owner'};
function fixture(data){
  const calls=[],signed=[],access=[],thumbnails=[];
  const deps={PublicApiError,NextResponse:{json:body=>body},apiError:e=>({status:e.status,message:e.message}),
    createRequestSupabaseContext:async()=>({user:{id:'actor'},session:{}}),requireActiveVenueAccount:async()=>{},
    requireVenueAccess:async(_db,actor,permission)=>{access.push({actor,permission});return{venueId:'club'};},
    createAdminSupabaseClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data};},
      storage:{from:bucket=>({createSignedUrl:async(path,ttl)=>{signed.push({bucket,path,ttl});return{data:{signedUrl:'/signed-poster'}};}})}}),
    withSignedThumbnail:async(_db,record)=>{thumbnails.push(record.id);return{thumbnailUrl:'/signed-photo'};},
    MYDANCR_TV_BUCKET:'videos',
  };
  const exports={};vm.runInNewContext(compiled,{exports,require:()=>deps,URL,console});
  return{calls,signed,access,thumbnails,get:query=>exports.GET({url:'https://example.test/api/venue/media-reviews'+query})};
}
test('dancer overview signs only card photos/posters and returns no raw private moderation records',async()=>{
  const f=fixture({count:5,dancerCount:2,items:[],dancers:[
    {id:dancerId,stageName:'Star',count:3,photoCount:2,videoCount:1,kind:'photo',record:photo},
    {id:'other',stageName:'Star',count:2,photoCount:0,videoCount:2,kind:'video',record:{storage_path:'private/video.mp4',moderation_details:{posterStoragePath:'private/poster.jpg'}}},
  ]});
  const result=await f.get('?view=dancers&offset=12');
  assert.equal(result.dancers.length,2);assert.equal(result.count,5);assert.equal(result.dancerCount,2);
  assert.equal(f.calls[0].name,'get_venue_dancer_media_grid');assert.equal(f.calls[0].args.p_offset,12);
  assert.deepEqual(f.access,[{actor:'actor',permission:'manage_roster'}]);
  assert.deepEqual(f.signed,[{bucket:'videos',path:'private/poster.jpg',ttl:300}]);
  assert.doesNotMatch(JSON.stringify(result),/private-owner|temporary_storage_path|storage_path|moderation_details|category_flags/);
});
test('selected dancer query preserves the Main photo label and approval gates',async()=>{
  const f=fixture({count:3,uploadCount:1,dancerCount:2,dancers:[],items:[{id:'photo',dancerId,kind:'photo',stageName:'Star',record:photo}]});
  const result=await f.get('?view=dancers&dancerId='+dancerId);
  assert.equal(f.calls[0].args.p_dancer_id,dancerId);assert.equal(result.uploadCount,1);
  assert.equal(result.items[0].label,'Main photo');assert.equal(result.items[0].canApprove,true);
  assert.equal(result.items[0].version,photo.updated_at);assert.equal(result.items[0].previewUrl,'/signed-photo');
});
test('count-only uses no previews; invalid dancer IDs never reach the queue',async()=>{
  const f=fixture({count:5,dancerCount:2,dancers:[],items:[]});
  assert.equal((await f.get('?view=dancers&countOnly=1')).count,5);
  assert.equal(f.calls[0].args.p_limit,0);assert.equal(f.signed.length,0);assert.equal(f.thumbnails.length,0);
  assert.equal((await f.get('?view=dancers&dancerId=wrong')).status,400);assert.equal(f.calls.length,1);
});
