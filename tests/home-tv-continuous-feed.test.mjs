import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync('outputs/index.html', 'utf8');
const fn = name => source.match(new RegExp('    (?:async )?function ' + name + '\\([^]*?\\n    \\}'))[0];
const clip = id => ({ id: String(id), videoUrl: `/video-${id}`, dancer: { stageName: 'Dancer' } });

function fixture(count, cursor = null) {
  let slides = [], scroll = 0, now = 0;
  const requests = [], likes = [];
  const element = () => ({ dataset: {}, attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    querySelector() { return this.video; },
    replaceChildren() { this.video = null; },
    get nextSibling() { return slides[slides.indexOf(this) + 1] || null; },
    getBoundingClientRect() { return { top: slides.indexOf(this) * 700 - scroll }; },
    addEventListener() {}, remove() { slides = slides.filter(slide => slide !== this); },
  });
  const context = vm.createContext({ AbortController, URLSearchParams, Set, Math, console, CSS: { escape: String }, Date: { now: () => now },
    discoveryRequestHeaders: () => ({}), homeTvFeedSelectedVideoId: '',
    activeTab: 'tv', homeTvFeedStatus: 'ready', homeTvFeedRequest: 1,
    homeTvFeedCity: 'Vegas', homeTvFeedVenueId: '', homeTvFeedActiveVideoId: '0',
    homeTvFeedNextCursor: cursor, homeTvFeedPageAbort: null, homeTvFeedPageRetryAt: 0, homeTvFeedLoopStarted: false,
    homeTvFeedVideos: Array.from({ length: count }, (_, i) => clip(i)),
    PUBLIC_DISCOVERY_REQUEST_RETRIES: 1,
    homeTvFeedCoveredByProfile: () => false, homeTvFeedIsImmersive: () => false,
    document: { visibilityState: 'visible', createElement: element },
    window: { scrollBy({ top }) { scroll += top; } },
    homeTvFeedObserver: { observe() {}, unobserve() {} },
    results: { dataset: {}, contains: slide => slides.includes(slide),
      querySelectorAll: () => slides.filter(slide => slide.dataset.videoId),
      querySelector(selector) {
        if (selector === '[data-tv-page-retry]') return slides.find(slide => slide.dataset.tvPageRetry) || null;
        if (selector === '.home-tv-feed-slide') return slides.find(slide => slide.dataset.videoId);
        const match = selector.match(/\[data-(playback|video)-id="([^"]*)"\]/);
        return slides.find(slide => slide.dataset[match[1] + 'Id'] === match[2]);
      },
      insertBefore(slide, next) {
        slides = slides.filter(item => item !== slide);
        slides.splice(next ? slides.indexOf(next) : slides.length, 0, slide);
      },
      replaceChildren(...children) { slides = children; },
      appendChild(slide) { slides = slides.filter(item => item !== slide); slides.push(slide); },
      prepend(slide) { slides = slides.filter(item => item !== slide); slides.unshift(slide); },
    },
    hydrateHomeTvFeedSlide(slide) { if (!slide.video) slide.video = { paused: true }; delete slide.dataset.pendingVideoIndex; },
    renderHomeTvFeedSlide(slide, item) { slide.dataset.videoId = item.id; slide.video = { paused: true }; },
    releaseDeferredVideoSource(video) { video.paused = true; video.released = true; },
    primeHomeTvFeedNeighbors() {}, finishHomeTvFeedCards() {}, clearHomeTvFeedEngagedTimer() {}, renderHomeTvFeed() {},
    loadPublicMediaLikes: rows => likes.push(...rows),
    fetchJson: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  });
  vm.runInContext(['createHomeTvFeedSlide', 'createHomeTvFeedPlaceholder', 'homeTvFeedActiveSlide', 'restoreHomeTvFeedScroll',
    'appendHomeTvFeedPage', 'maintainHomeTvFeedWindow', 'loadNextHomeTvFeedPage'].map(fn).join('\n'), context);
  // Use the same initial players and deferred cards as the real feed.
  vm.runInContext(fn('renderHomeTvFeed').match(/results\.replaceChildren\(\s*\.\.\.homeTvFeedVideos\.map\([^]*?\n      \);/)[0], context);
  return { context, requests, likes, advance: ms => { now += ms; }, slides: () => slides, select(slide) {
    context.homeTvFeedActiveVideoId = slide.dataset.playbackId || slide.dataset.videoId;
    context.hydrateHomeTvFeedSlide(slide);
    slide.video.paused = false;
    scroll = slides.indexOf(slide) * 700;
    context.maintainHomeTvFeedWindow();
  } };
}

for (const count of [1, 2, 3, 8, 25]) test(`${count}-video feed cycles in order with fixed card/player counts and stable neighbors`, () => {
  const f = fixture(count); f.select(f.slides()[0]);
  const poolSize = f.slides().length, sequence = [];
  for (let step = 0; step < poolSize * 4; step++) {
    const active = f.context.homeTvFeedActiveSlide();
    sequence.push(active.dataset.videoId);
    const before = f.slides(), index = before.indexOf(active);
    const next = before[index + 1];
    assert.ok(next, 'there is always a next card');
    const buffered = before.slice(Math.max(0, index-1), index+4).filter(slide => slide !== next);
    f.select(next);
    assert.equal(f.context.homeTvFeedActiveSlide(), next, 'autoplay follows the exact card, including the original after a wrap');
    assert.equal(next.getBoundingClientRect().top, 0, 'recycling does not move the viewed card');
    assert.equal(f.slides().length, poolSize, 'repeating does not append another library');
    assert.ok(f.slides().filter(slide => slide.video).length <= 9);
    assert.ok(buffered.every(slide => f.slides().includes(slide)), 'nearby cards keep their elements');
  }
  assert.deepEqual(sequence, Array.from({ length: poolSize * 4 }, (_, i) => String(i % count)));
  for (let step = 0; step < count * 2; step++) {
    const active = f.context.homeTvFeedActiveSlide(), index = f.slides().indexOf(active);
    const previous = f.slides()[index - 1]; assert.ok(previous);
    f.select(previous); assert.equal(previous.getBoundingClientRect().top, 0);
  }
});

test('one next-page request survives rapid swipes, skips duplicate/empty pages, and appends before repeating', async () => {
  const f = fixture(8, 'page-2');
  const pending = f.context.loadNextHomeTvFeedPage();
  await f.context.loadNextHomeTvFeedPage(); assert.equal(f.requests.length, 1);
  f.select(f.slides()[7]); assert.equal(f.requests.length, 1);
  assert.ok(f.context.homeTvFeedActiveSlide().nextSibling, 'swiping can continue while waiting for the next page');
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

test('a slow page grows a two-clip loop around its playing copy and the new clips join in order', async () => {
  const f = fixture(2, 'page-2');
  const pending = f.context.loadNextHomeTvFeedPage();
  f.select(f.slides()[0]);
  const next = () => f.select(f.context.homeTvFeedActiveSlide().nextSibling);
  for (let step = 0; step < 11; step++) next();
  const current = f.context.homeTvFeedActiveSlide(), player = current.video;
  assert.equal(current.dataset.videoId, '1');
  assert.notEqual(current.dataset.playbackId, '1');
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ ok: true, videos: [clip(2), clip(3), clip(4)], nextCursor: null });
  await pending;
  assert.equal(f.context.homeTvFeedActiveSlide(), current);
  assert.equal(current.video, player);
  assert.equal(current.getBoundingClientRect().top, 0);
  assert.equal(f.slides().length, 10);
  assert.equal(new Set(f.slides().map(s => s.dataset.playbackId)).size, 10);
  for (let step = 0; step < 30; step++) {
    next();
    assert.equal(f.context.homeTvFeedActiveSlide().dataset.videoId, String((2 + step) % 5));
  }
});

test('failed pages preserve the current feed and cursor; retry recovers without duplicate requests', async () => {
  const f = fixture(8, 'page-2');
  const pending = f.context.loadNextHomeTvFeedPage();
  f.requests[0].reject(new Error('offline')); await pending;
  assert.equal(f.context.homeTvFeedVideos.length, 8);
  assert.equal(f.context.homeTvFeedNextCursor, 'page-2');
  assert.ok(f.slides().some(slide => slide.dataset.tvPageRetry));
  f.select(f.context.homeTvFeedActiveSlide());
  for (let step = 0; step < 20; step++) {
    const next = f.context.homeTvFeedActiveSlide().nextSibling;
    assert.equal(next.dataset.videoId, String((step + 1) % 8));
    f.select(next);
  }
  await f.context.loadNextHomeTvFeedPage(); assert.equal(f.requests.length, 1);
  f.advance(30000);
  f.context.maintainHomeTvFeedWindow();
  assert.equal(f.requests.length, 2, 'continued viewing retries a transient failure');
  f.requests[1].resolve({ ok: true, videos: [clip(8)], nextCursor: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.context.homeTvFeedVideos.length, 9); assert.equal(f.context.homeTvFeedPageRetryAt, 0);
});

test('obsolete or aborted page results cannot change another TV scope', async () => {
  for (const abort of [true, false]) {
    const f = fixture(8, 'page-2'), pending = f.context.loadNextHomeTvFeedPage();
    if (abort) f.context.homeTvFeedPageAbort.abort(); else f.context.homeTvFeedRequest++;
    f.requests[0].resolve({ ok: true, videos: [clip(8)], nextCursor: null }); await pending;
    assert.equal(f.context.homeTvFeedVideos.length, 8); assert.equal(f.context.homeTvFeedNextCursor, 'page-2');
  }
});
