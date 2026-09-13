import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptiveVideoPath, adaptiveVideoPlaylist, parseAdaptiveVideoManifest } from '../src/lib/dancr/adaptive-video-manifest.ts';
export const manifestFixture = () => ({version:1,generation:'a'.repeat(32),renditions:['360','720','source'].map((name,index)=>({name,width:360*(index+1),height:640*(index+1),bytes:1100,initBytes:100,segments:[{duration:2,bytes:600},{duration:1,bytes:400}]}))});
test('generated master and VOD playlists contain only same-origin protected routes and contiguous ranges',()=>{
 const manifest=manifestFixture();assert.equal(parseAdaptiveVideoManifest(manifest),manifest);
 const url=new URL('https://app.test/api/media/dancer-video?id=owned&preview=scoped&hls=master&evil=ignored');
 const master=adaptiveVideoPlaylist(manifest,url);assert.equal((master.match(/#EXT-X-STREAM-INF/g)||[]).length,3);
 assert.match(master,/BANDWIDTH=3200,AVERAGE-BANDWIDTH=2934,RESOLUTION=360x640/);
 const playlist=adaptiveVideoPlaylist(manifest,url,manifest.renditions[0]);
 assert.match(playlist,/BYTERANGE="100@0"/);assert.match(playlist,/#EXT-X-BYTERANGE:600@100/);assert.match(playlist,/#EXT-X-BYTERANGE:400@700/);
 assert.match(playlist,/preview=scoped/);assert.match(playlist,/#EXT-X-ENDLIST/);
 for(const text of [master,playlist])assert.doesNotMatch(text,/https:|storage|evil|\.mp4/);
 assert.equal(adaptiveVideoPath('owner/dancer/id.mp4',manifest,'360'),'owner/dancer/id.mp4.hls-'+manifest.generation+'-360.mp4');
});
for(const [label,mutate] of [
 ['generation',m=>m.generation='../else'],['version',m=>m.version=2],['original missing',m=>m.renditions.pop()],
 ['duplicates',m=>m.renditions[1].name='360'],['oversized file',m=>m.renditions[0].bytes=80*1024*1024],
 ['incorrect total',m=>m.renditions[0].bytes++],['negative bytes',m=>m.renditions[0].segments[0].bytes=-2],
 ['segment alignment',m=>m.renditions[0].segments[0].duration=2.2],['long segment',m=>m.renditions[0].segments[0].duration=4],
 ['unbounded segments',m=>m.renditions[0].segments=Array(100).fill({duration:2,bytes:1})],
 ['fractional dimensions',m=>m.renditions[0].width=360.5],['invalid dimensions',m=>m.renditions[0].height=Infinity],
])test('rejects '+label,()=>{const manifest=manifestFixture();mutate(manifest);assert.equal(parseAdaptiveVideoManifest(manifest),null);});
test('object paths cannot cross a source boundary',()=>{
 for(const source of ['../a.mp4','/a.mp4','owner//a.mp4','owner/./a.mp4','https://other/a.mp4','owner/a.webm'])assert.throws(()=>adaptiveVideoPath(source,manifestFixture(),'360'));
 assert.throws(()=>adaptiveVideoPath('owner/a.mp4',manifestFixture(),'../source'));
});

test('master playlists declare verified codecs and reject playlist attribute injection',()=>{
 const manifest=manifestFixture();manifest.renditions[0].codecs='avc1.64001e,mp4a.40.2';
 assert.equal(parseAdaptiveVideoManifest(manifest),manifest);
 assert.match(adaptiveVideoPlaylist(manifest,new URL('https://app.test/video?id=owned')),/CODECS="avc1.64001e,mp4a.40.2"/);
 for(const codecs of ['avc1.64001e"\n/other','mp4a.40.2',123]){
  manifest.renditions[0].codecs=codecs;assert.equal(parseAdaptiveVideoManifest(manifest),null);
 }
});
