// Shared by the classic shell and the routed profile player. The HLS engine is
// fetched only when a visible adaptive video needs Media Source Extensions.
const sessions = new WeakMap();
let enginePromise;
let warmQueue = Promise.resolve();
const loadEngine = () => enginePromise ||= import(/* webpackIgnore: true */ '/hls-engine.js?v=1.7.3')
  .then(module => module.default).catch(error => { enginePromise = null; throw error; });

export function releaseAdaptiveVideo(video) {
  const session = sessions.get(video);
  if (!session) return;
  sessions.delete(video);
  session.cleanup();
  session.engine?.destroy();
  video.pause();
  video.preload = 'none';
  if (video.hasAttribute('src')) { video.removeAttribute('src'); video.load(); }
}

export function suspendAdaptiveVideo(video) {
  const session = sessions.get(video);
  video.preload = 'none';
  if (session) session.warmAllowed = false;
  session?.finishWarm?.();
  if (session?.engine && !session.stopped) { session.engine.stopLoad(); session.stopped = true; }
}

// Only one paused neighbor fetches media at a time. One complete low-rung
// segment gives the incoming card a starting frame without autoplay.
export function warmAdaptiveVideo(video) {
  const session = sessions.get(video);
  if (!session || session.fellBack || !video.paused || session.warmed || document.visibilityState === 'hidden') return Promise.resolve();
  session.warmAllowed = true;
  if (session.warmPromise) return session.warmPromise;
  session.warmPromise = warmQueue = warmQueue.then(() => new Promise(resolve => {
    if (sessions.get(video) !== session || !session.warmAllowed || !video.isConnected || !video.paused || document.visibilityState === 'hidden') { session.warmPromise = null; resolve(); return; }
    if (video.readyState >= 2 && video.buffered.length) { session.warmed = true; session.warmPromise = null; resolve(); return; }
    session.warming = true;
    const finish = session.finishWarm = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', nativeReady);
      session.warmed = video.buffered.length > 0;
      session.warming = false;
      session.finishWarm = null;
      session.warmPromise = null;
      if (video.paused) {
        video.preload = 'none';
        session.engine?.stopLoad();
        session.stopped = true;
      }
      resolve();
    };
    const nativeReady = () => { if (!session.engine) finish(); };
    const timer = setTimeout(finish, 8000);
    if (session.engine) {
      session.engine.config.maxBufferLength = 2;
      session.engine.config.maxMaxBufferLength = 2;
      if (session.manifestParsed) { session.engine.startLoad(0); session.stopped = false; }
    } else {
      // Safari owns native HLS buffering. Hint only this adjacent paused player;
      // restore preload=none as soon as its first decoded frame is available.
      video.addEventListener('loadeddata', nativeReady);
      video.preload = 'auto';
    }
  })).catch(() => undefined);
  return session.warmPromise;
}

/** @param {HTMLVideoElement} video
 * @param {string} manifestUrl
 * @param {string} fallbackUrl
 * @returns {Promise<boolean>}
 */
export function attachAdaptiveVideo(video, manifestUrl, fallbackUrl) {
  const current = sessions.get(video);
  if (current?.url === manifestUrl) {
    if (current.native && video.paused && !video.autoplay && !current.warming) video.preload = 'none';
    return current.ready;
  }
  releaseAdaptiveVideo(video);
  const session = { url: manifestUrl, engine: null, native: false, stopped: false, manifestParsed: false, warming: false,
    warmed: false, warmAllowed: false, warmPromise: null, finishWarm: null, fellBack: false, cleanup() {}, ready: null };
  sessions.set(video, session);
  let wantsPlayback = video.autoplay;
  const live = () => sessions.get(video) === session && video.isConnected;
  const resume = () => {
    wantsPlayback = true;
    if (!live() || document.visibilityState === 'hidden') return;
    video.preload = 'auto';
    session.finishWarm?.();
    if (session.engine) {
      session.engine.config.maxBufferLength = 6;
      session.engine.config.maxMaxBufferLength = 12;
    }
    if (session.engine && session.stopped) { session.engine.startLoad(-1); session.stopped = false; }
  };
  const pause = () => { wantsPlayback = false; suspendAdaptiveVideo(video); };
  const visibility = () => { if (document.visibilityState === 'hidden') pause(); else if (!video.paused) resume(); };
  video.addEventListener('play', resume);
  video.addEventListener('pause', pause);
  document.addEventListener('visibilitychange', visibility);
  session.cleanup = () => {
    session.finishWarm?.();
    video.removeEventListener('play', resume); video.removeEventListener('pause', pause);
    video.removeEventListener('error', fallback); document.removeEventListener('visibilitychange', visibility);
  };
  let fellBack = false;
  function fallback() {
    if (!live() || fellBack) return;
    fellBack = true;
    session.fellBack = true;
    session.finishWarm?.();
    const position = video.currentTime || 0;
    const playing = !video.paused || wantsPlayback;
    video.removeEventListener('error', fallback);
    session.engine?.destroy(); session.engine = null;
    if (!playing) video.autoplay = false;
    video.src = fallbackUrl;
    if (position > 0) video.addEventListener('loadedmetadata', () => {
      if (live()) video.currentTime = Math.min(position, video.duration || position);
    }, { once: true });
    if (playing && document.visibilityState !== 'hidden') void video.play().catch(() => undefined);
  }
  session.ready = (async () => {
    const userAgent = navigator.userAgent;
    const nativeSafari = /iP(hone|ad|od)/.test(userAgent) || (/Safari/.test(userAgent) && !/Chrome|Chromium|Edg|OPR|Android/.test(userAgent));
    if (nativeSafari && video.canPlayType('application/vnd.apple.mpegurl')) {
      session.native = true;
      if (video.paused && !video.autoplay) video.preload = 'none';
      video.addEventListener('error', fallback);
      video.src = manifestUrl;
      return true;
    }
    try {
      const Hls = await loadEngine();
      if (!live()) return false;
      if (!Hls.isSupported()) { fallback(); return true; }
      const engine = session.engine = new Hls({
        // Small VOD buffers keep memory/network bounded on mobile. Resolution
        // stays uncapped: ABR can select the full-resolution rung when affordable.
        maxBufferLength: 6, maxMaxBufferLength: 12, backBufferLength: 4,
        maxBufferSize: 12 * 1024 * 1024, abrEwmaDefaultEstimate: 2_000_000,
        // Start with playable media instead of a throwaway bandwidth-test
        // fragment. Subsequent fragments remain under automatic ABR control.
        startLevel: 0, enableWorker: true, autoStartLoad: false,
      });
      engine.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fallback(); });
      engine.on(Hls.Events.FRAG_BUFFERED, () => {
        if (session.warming) session.finishWarm?.();
        // MSE appends do not consistently produce native network progress events.
        video.dispatchEvent(new Event('mydancrvideobufferchange'));
      });
      engine.once(Hls.Events.MANIFEST_PARSED, () => {
        if (!live()) return;
        session.manifestParsed = true;
        if (session.warming && document.visibilityState !== 'hidden') { engine.startLoad(0); session.stopped = false; }
        else if (document.visibilityState === 'hidden' || video.paused) session.stopped = true;
        else engine.startLoad(-1);
      });
      engine.loadSource(manifestUrl);
      engine.attachMedia(video);
      return true;
    } catch {
      if (!live()) return false;
      fallback(); return true;
    }
  })();
  return session.ready;
}
