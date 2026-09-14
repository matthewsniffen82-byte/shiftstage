import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync('outputs/index.html', 'utf8');
const fn = name => source.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];

function fixture() {
  const built = [], frames = [], timers = [];
  let slides = [];
  const context = vm.createContext({
    activeTab: 'tv', homeTvFeedVideos: Array.from({ length: 22 }, (_, i) => ({ id: String(i), dancer: { stageName: 'Dancer' } })),
    homeTvFeedActiveSlide: () => slides[0],
    document: { visibilityState: 'visible', createElement: () => ({ dataset: {}, setAttribute() {} }) },
    results: { dataset: { homeTvFeedKey: 'feed' }, contains: slide => slides.includes(slide),
      querySelector: () => slides.find(slide => slide.dataset.pendingVideoIndex !== undefined),
      querySelectorAll: () => slides,
      replaceChildren: (...children) => { slides = children; },
    },
    createHomeTvFeedSlide: (item, index) => { built.push(index); return { dataset: { videoId: item.id } }; },
    renderHomeTvFeedSlide: (_slide, _item, index) => built.push(index),
    window: { requestAnimationFrame: callback => frames.push(callback), setTimeout: callback => timers.push(callback) },
  });
  vm.runInContext(['hydrateHomeTvFeedSlide', 'finishHomeTvFeedCards', 'createHomeTvFeedPlaceholder'].map(fn).join('\n'), context);
  const render = fn('renderHomeTvFeed');
  vm.runInContext(render.match(/results\.replaceChildren\(\s*\.\.\.homeTvFeedVideos\.map\([^]*?\n      \);/)[0], context);
  return { context, built, frames, timers, slides,
    tick() { frames.shift()?.(); timers.shift()?.(); },
  };
}

test('initial TV render builds three cards and preserves all ordered scroll slots', () => {
  const f = fixture();
  assert.deepEqual(f.built, [0,1,2]);
  assert.equal(f.slides.length, 22);
  assert.deepEqual(f.slides.map(s => s.dataset.videoId), Array.from({ length: 22 }, (_, i) => String(i)));
  f.context.finishHomeTvFeedCards('feed');
  assert.deepEqual(f.built, [0,1,2], 'yield before building the fourth card');
  f.tick(); assert.deepEqual(f.built, [0,1,2,3]);
  while (f.frames.length) f.tick();
  assert.equal(f.built.length, 5, 'distant cards remain light scroll slots');
});

test('a jump immediately prepares its selected slot once; stale callbacks cannot repopulate another feed', () => {
  const f = fixture();
  f.context.hydrateHomeTvFeedSlide(f.slides[17]);
  f.context.hydrateHomeTvFeedSlide(f.slides[17]);
  assert.deepEqual(f.built, [0,1,2,17]);
  f.context.finishHomeTvFeedCards('feed');
  f.context.results.dataset.homeTvFeedKey = 'another-city';
  f.tick(); assert.deepEqual(f.built, [0,1,2,17]);
  const stale = f.slides[18];
  f.context.homeTvFeedVideos = [];
  f.context.hydrateHomeTvFeedSlide(stale);
  assert.equal(f.built.length, 4);
});

test('pending work stops when TV closes or the page becomes hidden', () => {
  for (const hide of [false, true]) {
    const f = fixture(); f.context.finishHomeTvFeedCards('feed');
    if (hide) f.context.document.visibilityState = 'hidden'; else f.context.activeTab = 'dancers';
    f.tick(); assert.equal(f.built.length, 3); assert.equal(f.frames.length, 0);
  }
});
