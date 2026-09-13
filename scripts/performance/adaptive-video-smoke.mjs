// Controlled bandwidth comparison using real encoded bytes and real browser HLS.
// Bind a finite fixture server locally; no production writes or background watcher.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { adaptiveVideoPlaylist } from '../../src/lib/dancr/adaptive-video-manifest.ts';
const { chromium, webkit }=createRequire(import.meta.url)(process.env.PERF_PLAYWRIGHT_MODULE || 'playwright');
const fixture=process.env.PERF_VIDEO_FIXTURE || '.next-adaptive-20260912';
const output=process.env.PERF_OUTPUT || fixture+'/playback';
const manifest=JSON.parse(await readFile(fixture+'/manifest.json','utf8'));
const bytes=new Map(await Promise.all(['source',...manifest.renditions.map(row=>'fixture-'+row.name)].map(async name=>[name,await readFile(fixture+'/'+name+'.mp4')])));
const controller=await readFile('public/adaptive-video.mjs');
const engine=await readFile('node_modules/hls.js/dist/hls.light.min.mjs');
const traces=[];let mode='progressive',network='cellular',epoch=0;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const respond=(type,body)=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
 if(url.pathname==='/')return respond('text/html','<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><video muted playsinline loop style="width:360px;height:640px"></video>');
 if(url.pathname==='/adaptive-video.mjs')return respond('application/javascript',controller);
 if(url.pathname==='/hls-engine.js')return respond('application/javascript',engine);
 if(url.pathname!=='/api/media/dancer-video'){res.writeHead(404);res.end();return;}
 const hls=url.searchParams.get('hls');
 if(hls&&hls!=='media'){
  // Include realistic visibility lookup latency instead of instant local manifests.
  await new Promise(resolve=>setTimeout(resolve,150));
  return respond('application/vnd.apple.mpegurl',adaptiveVideoPlaylist(manifest,url,hls==='master'?undefined:manifest.renditions.find(row=>row.name===hls)));
 }
 const name=hls==='media'?'fixture-'+url.searchParams.get('rendition'):'source';
 const body=bytes.get(name);if(!body){res.writeHead(404);res.end();return;}
 const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
 let offset=range?Number(range[1]):0;const end=range&&range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;
 const trace={mode,network,name,range:req.headers.range,at:Date.now()-epoch,bytes:0,closed:false};traces.push(trace);
 res.on('close',()=>{trace.closed=true;});
 await new Promise(resolve=>setTimeout(resolve,150));
 if(res.destroyed)return;
 res.writeHead(range?206:200,{'Content-Type':'video/mp4','Cache-Control':'no-store','Accept-Ranges':'bytes','Content-Length':end-offset+1,...(range?{'Content-Range':`bytes ${offset}-${end}/${body.length}`}:{})});
 while(offset<=end&&!res.destroyed){
  // 1.5 Mbps cellular, or a bandwidth drop followed by recovery. Per-request
  // throughput is intentional: assertions prohibit competing adaptive players.
  const elapsed=Date.now()-epoch;
  const rate=network==='fast'?3_000_000:network==='changing'?(elapsed<3500?1_000_000:elapsed<11000?160_000:1_000_000):187_500;
  // Coarser fast-link chunks avoid Windows timer granularity turning a nominal
  // 24 Mbps connection into a 4 Mbps connection.
  const count=Math.min(network==='fast'?65536:8192,end-offset+1);res.write(body.subarray(offset,offset+count));offset+=count;trace.bytes+=count;
  await new Promise(resolve=>setTimeout(resolve,count/rate*1000));
 }
 if(!res.destroyed)res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=process.env.PERF_BROWSER==='webkit'?await webkit.launch():await chromium.launch({channel:'msedge',headless:true});
const results=[];
try{
 for(const settings of [['progressive','cellular'],['adaptive','cellular'],['adaptive','changing'],['adaptive','fast']]){
  if(process.env.PERF_CASES&&!process.env.PERF_CASES.split(',').includes(settings.join('-')))continue;
  [mode,network]=settings;epoch=Date.now();const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.evaluate(async({mode})=>{
   const v=document.querySelector('video');window.events=[];
   for(const type of ['loadstart','loadeddata','playing','waiting','error'])v.addEventListener(type,()=>window.events.push({type,at:performance.now(),time:v.currentTime}));
   window.adapter=await import('/adaptive-video.mjs');window.start=performance.now();
   if(mode==='adaptive')await window.adapter.attachAdaptiveVideo(v,'/api/media/dancer-video?id=fixture&hls=master','/api/media/dancer-video?id=fixture');
   else v.src='/api/media/dancer-video?id=fixture';
   void v.play().catch(error=>window.events.push({type:'play-rejection',message:error.message}));
  },{mode});
  await page.waitForTimeout(network==='changing'?21000:18000);
  const result=await page.evaluate(()=>{const v=document.querySelector('video');return {events:window.events,start:window.start,time:v.currentTime,nativeHls:Boolean(v.canPlayType('application/vnd.apple.mpegurl')),frames:v.getVideoPlaybackQuality?.().totalVideoFrames,dropped:v.getVideoPlaybackQuality?.().droppedVideoFrames};});
  const mediaTraces=traces.filter(row=>row.mode===mode&&row.network===network);
  results.push({mode,network,...result,errors,transferred:mediaTraces.reduce((sum,row)=>sum+row.bytes,0),requests:mediaTraces});
  assert.deepEqual(errors,[]);assert.ok(result.events.some(row=>row.type==='playing'),'video plays');
  if(mode==='adaptive'){
   assert.ok(!mediaTraces.some(row=>row.name==='source'),'adaptive playback does not silently fall back');
   if(network==='fast')assert.ok(mediaTraces.some(row=>row.name==='fixture-source'),'fast connections can select full resolution');
   await page.evaluate(()=>{const v=document.querySelector('video');window.adapter.releaseAdaptiveVideo(v);});
   await page.waitForTimeout(300);assert.equal(await page.locator('video').getAttribute('src'),null);
   assert.ok(mediaTraces.every(row=>row.closed),'all segment transfers stop on release');
  }
  await context.close();
 }
 const stalls=row=>row.events.filter(event=>event.type==='waiting'&&event.time>0).length;
 const baseline=results.find(row=>row.mode==='progressive'&&row.network==='cellular');
 const adaptive=results.find(row=>row.mode==='adaptive'&&row.network==='cellular');
 if(baseline&&adaptive){
  assert.ok(stalls(adaptive)<stalls(baseline),'adaptive playback reduces cellular stalls on the same clip');
  assert.ok(adaptive.transferred<baseline.transferred,'adaptive playback transfers fewer media bytes');
 }
}finally{
 await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await mkdir(output,{recursive:true});await writeFile(output+'/results.json',JSON.stringify({results,traces},null,2));
}
console.log(JSON.stringify(results.map(({mode,network,events,start,time,transferred,nativeHls,dropped})=>({mode,network,startup:events.find(row=>row.type==='playing')?.at-start,stalls:events.filter(row=>row.type==='waiting'&&row.time>0).length,time,transferred,nativeHls,dropped}))));
