import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync('outputs/index.html', 'utf8');
const fn = name => source.match(new RegExp('    (?:async )?function ' + name + '\\([^]*?\\n    \\}'))[0];
const clip = id => ({ id: String(id), videoUrl: `/video-${id}`, dancer: { stageName: 'Dancer' } });

function fixture(count, cursor = null) {
  let slides = [], scroll = 0;
  const requests = [], likes = [];
  const element = () => ({ dataset: {}, attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    querySelector() { return this.video; },
    replaceChildren() { this.video = null; },
    getBoundingClientRect() { return { top: slides.indexOf(this) * 700 - scroll }; },
    addEventListener() {}, remove() { slides = slides.filter(slide => slide !== this); },
  });
  const context = vm.createContext({ AbortController, URLSearchParams, Set, Math, console,
    activeTab: 'tv', homeTvFeedStatus: 'ready', homeTvFeedRequest: 1,
    homeTvFeedCity: 'Vegas', homeTvFeedVenueId: '', homeTvFeedActiveVideoId: '0',
    homeTvFeedNextCursor: cursor, homeTvFeedPageAbort: null, homeTvFeedPageError: false, homeTvFeedLoopStarted: false,
    homeTvFeedVideos: Array.from({ length: count }, (_, i) => clip(i)),
    PUBLIC_DISCOVERY_REQUEST_RETRIES: 1,
    homeTvFeedCoveredByProfile: () => false, homeTvFeedIsImmersive: () => false,
    document: { visibilityState: 'visible', createElement: element },
    window: { scrollBy({ top }) { scroll += top; } },
    homeTvFeedObserver: { observe() {} },
    homeTvFeedActiveSlide: () => slides.find(slide => (slide.dataset.playbackId || slide.dataset.videoId) === context.homeTvFeedActiveVideoId),
    results: { dataset: {}, contains: slide => slides.includes(slide),
      querySelectorAll: () => slides.filter(slide => slide.dataset.videoId),
      querySelector: () => slides.find(slide => slide.dataset.tvPageRetry),
      appendChild(slide) { slides = slides.filter(item => item !== slide); slides.push(slide); },
      prepend(slide) { slides = slides.filter(item => item !== slide); slides.unshift(slide); },
    },
    hydrateHomeTvFeedSlide(slide) { if (!slide.video) slide.video = { paused: true }; delete slide.dataset.pendingVideoIndex; },
    releaseDeferredVideoSource(video) { video.paused = true; video.released = true; },
    primeHomeTvFeedNeighbors() {}, finishHomeTvFeedCards() {}, clearHomeTvFeedEngagedTimer() {}, renderHomeTvFeed() {},
    loadPublicMediaLikes: rows => likes.push(...rows),
    fetchJson: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  });
  vm.runInContext(['createHomeTvFeedPlaceholder', 'maintainHomeTvFeedWindow', 'loadNextHomeTvFeedPage'].map(fn).join('\n'), context);
  slides = context.homeTvFeedVideos.map((_, i) => context.createHomeTvFeedPlaceholder(i));
  return { context, requests, likes, slides: () => slides, select(slide) {
    context.homeTvFeedActiveVideoId = slide.dataset.playbackId;
    context.hydrateHomeTvFeedSlide(slide);
    slide.video.paused = false;
    scroll = slides.indexOf(slide) * 700;
    context.maintainHomeTvFeedWindow();
  } };
}

for (const count of [2, 3, 8, 25]) test(`${count}-video feed cycles in order with fixed card/player counts and stable neighbors`, () => {
  const f = fixture(count); f.select(f.slides()[0]);
  const poolSize = f.slides().length, sequence = [];
  for (let step = 0; step < count * 4; step++) {
    const active = f.context.homeTvFeedActiveSlide();
    sequence.push(active.dataset.videoId);
    const before = f.slides(), index = before.indexOf(active);
    const next = before[index + 1];
    assert.ok(next, 'there is always a next card');
    const buffered = before.slice(Math.max(0, index-1), index+4).filter(slide => slide !== next);
    f.select(next);
    assert.equal(next.getBoundingClientRect().top, 0, 'recycling does not move the viewed card');
    assert.equal(f.slides().length, poolSize, 'repeating does not append another library');
    assert.ok(f.slides().filter(slide => slide.video).length <= 9);
    assert.ok(buffered.every(slide => f.slides().includes(slide)), 'nearby cards keep their elements');
  }
  assert.deepEqual(sequence, Array.from({ length: count * 4 }, (_, i) => String(i % count)));
  for (let step = 0; step < count * 2; step++) {
    const active = f.context.homeTvFeedActiveSlide(), index = f.slides().indexOf(active);
    const previous = f.slides()[index - 1]; assert.ok(previous);
    f.select(previous); assert.equal(previous.getBoundingClientRect().top, 0);
  }
});

test('single-video TV keeps native looping without generating duplicate players', () => {
  const f = fixture(1); f.select(f.slides()[0]);
  assert.equal(f.slides().length, 1); assert.equal(f.requests.length, 0);
});

test('one next-page request survives rapid swipes, skips duplicate/empty pages, and appends before repeating', async () => {
  const f = fixture(8, 'page-2');
  const pending = f.context.loadNextHomeTvFeedPage();
  await f.context.loadNextHomeTvFeedPage(); assert.equal(f.requests.length, 1);
  f.select(f.slides()[7]); assert.equal(f.requests.length, 1);
  assert.equal(f.context.homeTvFeedLoopStarted, false, 'no repeats while more unwatched pages exist');
  f.requests[0].resolve({ ok: true, videos: [clip(7)], nextCursor: 'page-3' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve({ ok: true, videos: [clip(8), clip(9), clip(9)], nextCursor: null });
  await pending;
  assert.deepEqual(Array.from(f.context.homeTvFeedVideos, row => row.id), Array.from({ length: 10 }, (_, i) => String(i)));
  const active = f.context.homeTvFeedActiveSlide(), index = f.slides().indexOf(active);
  assert.equal(f.slides()[index+1].dataset.videoId, '8');
  assert.equal(f.context.homeTvFeedPageAbort, null);
});

test('failed pages preserve the current feed and cursor; retry recovers without duplicate requests', async () => {
  const f = fixture(8, 'page-2');
  const pending = f.context.loadNextHomeTvFeedPage();
  f.requests[0].reject(new Error('offline')); await pending;
  assert.equal(f.context.homeTvFeedVideos.length, 8);
  assert.equal(f.context.homeTvFeedNextCursor, 'page-2');
  assert.ok(f.slides().some(slide => slide.dataset.tvPageRetry));
  await f.context.loadNextHomeTvFeedPage(); assert.equal(f.requests.length, 1);
  const retry = f.context.loadNextHomeTvFeedPage(true);
  f.requests[1].resolve({ ok: true, videos: [clip(8)], nextCursor: null }); await retry;
  assert.equal(f.context.homeTvFeedVideos.length, 9); assert.equal(f.context.homeTvFeedPageError, false);
});

test('obsolete or aborted page results cannot change another TV scope', async () => {
  for (const abort of [true, false]) {
    const f = fixture(8, 'page-2'), pending = f.context.loadNextHomeTvFeedPage();
    if (abort) f.context.homeTvFeedPageAbort.abort(); else f.context.homeTvFeedRequest++;
    f.requests[0].resolve({ ok: true, videos: [clip(8)], nextCursor: null }); await pending;
    assert.equal(f.context.homeTvFeedVideos.length, 8); assert.equal(f.context.homeTvFeedNextCursor, 'page-2');
  }
});
