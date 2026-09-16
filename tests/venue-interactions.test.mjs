import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const source=readFileSync(new URL('../src/live-shell/app/02-venue-interactions.js',import.meta.url),'utf8');
function fixture(){
 const calls=[],listeners={};let observer;
 const context={crypto:{randomUUID},Set,Promise,window:{location:{protocol:'https:'}},trendEventStore:{viewerId:'browser-test'},
  document:{body:{},visibilityState:'visible',querySelectorAll:()=>[],addEventListener:(name,handler)=>listeners[name]=handler},
  fetch:async(url,options)=>{calls.push({url,...JSON.parse(options.body)});},
  resolveVenueByName:ref=>ref==='venue-1'?{id:'venue-1'}:null,findProfile:ref=>ref==='dancer-1'?{id:'dancer-1'}:null,
  decodeDealPass:value=>JSON.parse(value),MutationObserver:class{observe(){}},IntersectionObserver:class{constructor(callback){observer=callback;}observe(){}unobserve(){}},
 };
 vm.createContext(context);vm.runInContext(source,context);
 const root={dataset:{analyticsVenueId:'venue-1',analyticsSource:'venue_detail'}};
 const target=(kind,dataset={},profile=null)=>({dataset,disabled:false,getAttribute:()=>null,matches:selector=>selector.split(',').map(s=>s.trim()).includes(kind),closest:selector=>selector.includes('data-analytics-venue-id')?root:selector.includes('#profileModal')?profile:selector==='a, button, .dancer-card, .venue-shift-row'?null:null});
 return {calls,context,root,target,click:node=>listeners.click({target:{closest:()=>node}}),observe:entries=>observer(entries)};
}
test('directions capture once, preserve explicit dancer and actual venue surface',()=>{
 const f=fixture();f.click(f.target('.venue-directions-btn',{venueId:'venue-1',dancerId:'dancer-1'}));
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].eventType,'directions');assert.equal(f.calls[0].source,'venue_detail');assert.equal(f.calls[0].dancerId,'dancer-1');
});
test('disabled actions do not count and ride links have a separate metric',()=>{
 const f=fixture(),disabled=f.target('[data-free-ride-link]',{venueId:'venue-1'});disabled.disabled=true;f.click(disabled);assert.equal(f.calls.length,0);
 f.click(f.target('[data-free-ride-link]',{venueId:'venue-1'}));assert.equal(f.calls[0].eventType,'transport');
});
test('visible card impressions deduplicate re-renders and skip offscreen cards',()=>{
 const f=fixture(),target={dataset:{analyticsVenueId:'venue-1'}};
 f.observe([{target,isIntersecting:false,intersectionRatio:0}]);assert.equal(f.calls.length,0);
 f.observe([{target,isIntersecting:true,intersectionRatio:0.7}]);f.observe([{target,isIntersecting:true,intersectionRatio:1}]);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].eventType,'card_impression');
});
test('every separate click gets its own event id while retaining one browser identity',()=>{
 const f=fixture(),node=f.target('[data-share-venue]',{shareVenue:'venue-1'});f.click(node);f.click(node);
 assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].eventId,f.calls[1].eventId);assert.equal(f.calls[0].sessionId,f.calls[1].sessionId);
});
