import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { encodeAdaptiveVideo } from '../src/lib/dancr/adaptive-video-encoder.ts';
const run=(args,input)=>execFileSync(ffmpeg,args,{input,windowsHide:true,maxBuffer:10*1024*1024,stdio:['pipe','pipe','pipe']});
for(const audio of [false,true])test('real encoder produces aligned playable full-resolution and low renditions '+(audio?'with audio':'without audio'),async()=>{
 const args=['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=480x854:rate=24'];
 if(audio)args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=48000');
 args.push('-t','4.2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1');
 const source=run(args);const preserved=Buffer.from(source);
 const result=await encodeAdaptiveVideo(source,480,854);
 assert.deepEqual(source,preserved);assert.deepEqual(result.manifest.renditions.map(row=>row.name),['360','source']);
 const original=result.manifest.renditions.find(row=>row.name==='source');assert.equal(original.width,480);assert.equal(original.height,854);
 for(const {body,rendition} of result.outputs){
  assert.equal(body.length,rendition.bytes);assert.equal(rendition.segments.length,3);
  assert.ok(rendition.segments.reduce((sum,row)=>sum+row.duration,0)>4.1);
  run(['-hide_banner','-loglevel','error','-i','pipe:0','-f','null','-'],body);
 }
});
