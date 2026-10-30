import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadStableVideo } from './helpers/stable-video-component.mjs';

function fixture(initial = {}) {
  let state, dirty = true, tree;
  let props = { src: '/api/media/dancer-video?id=first&preview=initial', controls: true, playsInline: true, ...initial };
  // A source replacement resets native playback; ordinary rerenders do not.
  const player = { src: '', currentTime: 0, duration: 30, paused: true, resets: 0 };
  const Component = loadStableVideo({ useState(initial) {
    state ??= initial();
    return [state, value => { state = typeof value === 'function' ? value(state) : value; dirty = true; }];
  } }).default;
  function render() {
    while (dirty) { dirty = false; tree = Component(props); }
    if (player.src !== tree.props.src) { player.src = tree.props.src; player.currentTime = 0; player.resets++; }
    return tree;
  }
  render();
  return {
    player, get tree() { return render(); },
    update(next) { props = { ...props, ...next }; dirty = true; render(); },
    event(name) { render().props[name]?.({ currentTarget: player }); render(); },
    play() { player.paused = false; this.event('onPlay'); },
    pause() { player.paused = true; this.event('onPause'); },
  };
}

test('two-second onboarding polls cannot restart a full 30-second video', () => {
  const ui = fixture();
  ui.play();
  for (let second = 2; second <= 30; second += 2) {
    ui.player.currentTime += 2;
    ui.update({ src: `/api/media/dancer-video?id=first&preview=renewed-${second}` });
    assert.equal(ui.player.currentTime, second);
  }
  assert.equal(ui.player.currentTime, ui.player.duration);
  assert.equal(ui.player.resets, 1);
  ui.event('onEnded');
  assert.equal(ui.player.currentTime, 30, 'ending must not reload an autoplay video and start it again');
  assert.equal(ui.player.resets, 1);
});

test('autoplay keeps the initial loading request through polls before any play event', () => {
  const ui = fixture({ autoPlay: true });
  const first = ui.player.src;
  for (let second = 2; second <= 12; second += 2) {
    ui.update({ src: `/api/media/dancer-video?id=first&preview=renewed-${second}` });
    assert.equal(ui.player.src, first);
  }
  assert.equal(ui.player.resets, 1, 'a slow initial load must not be aborted at every poll');
  ui.play();
  ui.player.currentTime = 5;
  ui.update({ src: '/api/media/dancer-video?id=first&preview=playing' });
  assert.equal(ui.player.currentTime, 5);
});

test('an autoplay error can retry a fresh capability without repeated polling restarts', () => {
  const ui = fixture({ autoPlay: true });
  const retry = '/api/media/dancer-video?id=first&preview=retry';
  ui.update({ src: retry });
  ui.event('onError');
  assert.equal(ui.player.src, retry);
  ui.update({ src: '/api/media/dancer-video?id=first&preview=later' });
  assert.equal(ui.player.src, retry, 'the recovery load also stays intact until it can play');
});

test('pause and resume keep the same source and position despite renewed capabilities', () => {
  const ui = fixture({ src: '/api/internal/video/first?token=initial&revision=v1' });
  ui.play(); ui.player.currentTime = 18; ui.pause();
  ui.update({ src: '/api/internal/video/first?token=renewed&revision=v1' });
  assert.equal(ui.player.currentTime, 18);
  ui.play();
  assert.equal(ui.player.currentTime, 18);
  assert.equal(ui.player.resets, 1);
});

test('idle and failed players accept refreshed links, and reopening starts with the latest URL', () => {
  const ui = fixture();
  const latest = '/api/media/dancer-video?id=first&preview=latest';
  ui.update({ src: latest });
  assert.equal(ui.player.src, latest);
  ui.play();
  ui.update({ src: `${latest}-retry` });
  assert.equal(ui.player.src, latest);
  ui.event('onError');
  assert.equal(ui.player.src, `${latest}-retry`);
  assert.equal(fixture({ src: `${latest}-reopened` }).player.src, `${latest}-reopened`);
});

test('selecting another video or content revision replaces the old source immediately', () => {
  for (const next of ['/api/media/dancer-video?id=second&preview=next', '/api/internal/video/first?token=next&revision=v2', 'blob:other-upload']) {
    const ui = fixture(); ui.play(); ui.player.currentTime = 12;
    ui.update({ src: next });
    assert.equal(ui.player.src, next);
    assert.equal(ui.player.currentTime, 0);
    assert.equal(ui.player.resets, 2);
  }
});

test('native controls and caller events are preserved without a duration or seek restriction', () => {
  const events = [];
  const ui = fixture({ autoPlay: true, preload: 'metadata', poster: '/poster.jpg', 'aria-label': 'Full video',
    onPlay: () => events.push('play'), onPause: () => events.push('pause'),
    onEnded: () => events.push('ended'), onError: () => events.push('error') });
  assert.equal(ui.tree.type, 'video');
  for (const name of ['controls', 'playsInline', 'autoPlay']) assert.equal(ui.tree.props[name], true);
  assert.equal(ui.tree.props.preload, 'metadata');
  assert.equal(ui.tree.props.poster, '/poster.jpg');
  assert.equal(ui.tree.props['aria-label'], 'Full video');
  assert.equal(ui.tree.props.onTimeUpdate, undefined);
  assert.equal(ui.tree.props.onLoadedMetadata, undefined);
  ui.play(); ui.pause(); ui.event('onEnded'); ui.event('onError');
  assert.deepEqual(events, ['play', 'pause', 'ended', 'error']);
});

test('all dashboard playback surfaces use the stable player and only thumbnails seek a preview frame', () => {
  for (const file of ['dashboard/DancerMediaViewer', 'dashboard/DancerVideoPreviews', 'dashboard/DancerTvStudio',
    'dashboard/VenueMediaReviewPanel', 'admin/AdminMediaWorkbench', 'admin/AdminTvPanel', 'internal/InternalRoster']) {
    let source = readFileSync(`app/${file}.tsx`, 'utf8');
    if (file === 'dashboard/VenueMediaReviewPanel') {
      assert.match(source, /<MediaBatchReview\b/, file);
      source = readFileSync('app/components/MediaBatchReview.tsx', 'utf8');
    }
    assert.match(source, /<StableVideo\b/, file);
    assert.doesNotMatch(source, /<video\b|primeVideoPreviewFrame/, file);
  }
});
