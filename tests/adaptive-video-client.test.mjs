import assert from 'node:assert/strict';
import test from 'node:test';
import { attachAdaptiveVideo, releaseAdaptiveVideo } from '../public/adaptive-video.mjs';
globalThis.document=Object.assign(new EventTarget(),{visibilityState:'visible'});
Object.defineProperty(globalThis,'navigator',{value:{userAgent:'Mozilla/5.0 (iPhone) AppleWebKit Safari'},configurable:true});
function video(native=true){
 return Object.assign(new EventTarget(),{isConnected:true,paused:true,autoplay:false,currentTime:0,duration:15,preload:'auto',src:'',loads:0,
 canPlayType(){return native?'maybe':'';},hasAttribute(name){return name==='src'&&Boolean(this.src);},removeAttribute(name){if(name==='src')this.src='';},
 load(){this.loads++;},pause(){this.paused=true;this.dispatchEvent(new Event('pause'));},async play(){this.paused=false;this.dispatchEvent(new Event('play'));}});
}
test('native HLS assigns immediately, reuses its element and manifest, and releases idempotently',async()=>{
 const v=video();const ready=attachAdaptiveVideo(v,'/master','/original');assert.equal(v.src,'/master');assert.equal(await ready,true);
 assert.equal(attachAdaptiveVideo(v,'/master','/original'),ready);v.currentTime=3;assert.equal(v.currentTime,3);
 releaseAdaptiveVideo(v);assert.equal(v.src,'');assert.equal(v.preload,'none');assert.equal(v.loads,1);
 releaseAdaptiveVideo(v);assert.equal(v.loads,1);
});
test('native manifest errors fall back once and preserve playback position',async()=>{
 const v=video();await attachAdaptiveVideo(v,'/master','/original');v.currentTime=4;await v.play();
 v.dispatchEvent(new Event('error'));assert.equal(v.src,'/original');v.currentTime=0;v.dispatchEvent(new Event('loadedmetadata'));assert.equal(v.currentTime,4);
 assert.equal(v.paused,false);v.dispatchEvent(new Event('error'));assert.equal(v.src,'/original');releaseAdaptiveVideo(v);
});
test('removed native sessions cannot restart through stale error events',async()=>{
 const v=video();await attachAdaptiveVideo(v,'/master','/original');releaseAdaptiveVideo(v);v.dispatchEvent(new Event('error'));assert.equal(v.src,'');
});
test('releasing while the engine import is pending prevents any late source assignment',async()=>{
 const v=video(false);const ready=attachAdaptiveVideo(v,'/master','/original');releaseAdaptiveVideo(v);assert.equal(await ready,false);assert.equal(v.src,'');
});
test('engine loading failures use the original without leaving a broken video',async()=>{
 const v=video(false);assert.equal(await attachAdaptiveVideo(v,'/master','/original'),true);assert.equal(v.src,'/original');releaseAdaptiveVideo(v);
});
