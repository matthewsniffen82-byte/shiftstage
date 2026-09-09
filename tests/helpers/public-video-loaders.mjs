import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../../outputs/index.html", import.meta.url), "utf8");
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
export function publicVideoLoaders() {
  const requests = [], renders = [];
  const context = vm.createContext({ AbortController, URLSearchParams, console,
    LIVE_JSON_REQUEST_TIMEOUT_MS: 10000, PUBLIC_DISCOVERY_REQUEST_RETRIES: 1,
    window: { setTimeout, clearTimeout },
    homeTvFeedAbort: null, homeTvFeedRequest: 0, homeTvFeedCity: "Vegas", homeTvFeedVenueId: "", homeTvFeedSelectedVideoId: "",
    homeTvFeedStatus: "loading", homeTvFeedVideos: [], activeTab: "tv", citySelect: { value: "Vegas" },
    homeTvFeedObserver: null, homeTvFeedEngagedTimers: new Map(),
    document: { documentElement: { classList: { remove() {} } }, getElementById: () => null },
    results: { classList: { remove() {} }, dataset: {}, querySelectorAll: () => [] },
    homeTvFeedFullscreenElement: () => null, setHomeTvFeedFallbackFullscreen() {}, releaseDeferredVideoSource() {},
    renderHomeTvFeed: city => renders.push(city),
    fetch: (url, options) => new Promise((resolve, reject) => {
      const request = { url, signal: options.signal, resolve: videos => resolve({ ok: true, json: async () => ({ ok: true, videos }) }) };
      requests.push(request);
      options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })), { once: true });
    }),
  });
  vm.runInContext([
    extract("    async function fetchJson(", "    function dancerSignupCityOptionsMarkup("),
    extract("    function deactivateHomeTvFeed(", "    function returnToHomeDiscoveryMain("),
    extract("    async function loadHomeTvFeed(", "    function resolveVenueByName("),
  ].join("\n"), context);
  return { context, requests, renders };
}
