// Shared by the classic shell and the routed profile player. The HLS engine is
// fetched only when a visible adaptive video needs Media Source Extensions.
const sessions = new WeakMap();
let enginePromise;
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
  if (session?.engine && !session.stopped) { session.engine.stopLoad(); session.stopped = true; }
}

/** @param {HTMLVideoElement} video
 * @param {string} manifestUrl
 * @param {string} fallbackUrl
 * @returns {Promise<boolean>}
 */
export function attachAdaptiveVideo(video, manifestUrl, fallbackUrl) {
  const current = sessions.get(video);
  if (current?.url === manifestUrl) return current.ready;
  releaseAdaptiveVideo(video);
  const session = { url: manifestUrl, engine: null, stopped: false, cleanup() {}, ready: null };
  sessions.set(video, session);
  const live = () => sessions.get(video) === session && video.isConnected;
  const resume = () => {
    if (!live() || document.visibilityState === 'hidden') return;
    if (session.engine && session.stopped) { session.engine.startLoad(-1); session.stopped = false; }
  };
  const pause = () => suspendAdaptiveVideo(video);
  const visibility = () => { if (document.visibilityState === 'hidden') pause(); else if (!video.paused) resume(); };
  video.addEventListener('play', resume);
  video.addEventListener('pause', pause);
  document.addEventListener('visibilitychange', visibility);
  session.cleanup = () => {
    video.removeEventListener('play', resume); video.removeEventListener('pause', pause);
    video.removeEventListener('error', fallback); document.removeEventListener('visibilitychange', visibility);
  };
  let fellBack = false;
  function fallback() {
    if (!live() || fellBack) return;
    fellBack = true;
    const position = video.currentTime || 0;
    const playing = !video.paused || video.autoplay;
    video.removeEventListener('error', fallback);
    session.engine?.destroy(); session.engine = null;
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
      engine.once(Hls.Events.MANIFEST_PARSED, () => {
        if (!live()) return;
        if (document.visibilityState === 'hidden' || video.paused) session.stopped = true;
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
