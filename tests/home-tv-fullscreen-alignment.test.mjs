import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('src/live-shell/app/20-render.js','utf8');
const align=source.match(/    function alignHomeTvFeedFullscreenSlide\([^]*?\n    \}/)[0];

test('queued full-screen alignment cannot undo a newer swipe or run after closing',()=>{
 const frames=[],scrolls=[],first={offsetTop:0},second={offsetTop:800};
 let active=first,immersive=true;
 const context=vm.createContext({
  window:{requestAnimationFrame:callback=>frames.push(callback)},
  results:{scrollTop:0,scrollTo:options=>{assert.equal(options.behavior,'instant');scrolls.push(options.top);}},
  homeTvFeedIsImmersive:()=>immersive,homeTvFeedActiveSlide:()=>active,
  setupHomeTvFeedObserver(){},
 });
 vm.runInContext(align,context);
 context.alignHomeTvFeedFullscreenSlide(first);
 active=second; frames.shift()();
 assert.deepEqual(scrolls,[]);frames.shift()();
 active=first;context.alignHomeTvFeedFullscreenSlide(first);
 context.results.scrollTop=800;frames.shift()();
 assert.deepEqual(scrolls,[],'respect a swipe before the observer reports it');frames.shift()();
 active=second;
 context.alignHomeTvFeedFullscreenSlide(second);frames.shift()();
 assert.deepEqual(scrolls,[800]);frames.shift()();
 context.alignHomeTvFeedFullscreenSlide(second);
 immersive=false;frames.shift()();
 assert.deepEqual(scrolls,[800]);
});
