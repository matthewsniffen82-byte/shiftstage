import { readFile, writeFile } from "node:fs/promises";

const inputs = process.argv.slice(2);
if (!inputs.length) throw new Error("Pass one or more mobile-baseline results.json files.");
const sources = await Promise.all(inputs.map(async file => JSON.parse(await readFile(file, "utf8"))));
const results = sources.flatMap(source => source.results);
const median = values => {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return Math.round((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) * 1000) / 1000;
};
const groups = new Map();
for (const result of results) {
  const key = `${result.profile} ${result.route}${result.customerFixture ? " [synthetic customer data]" : ""}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(result);
}
const pages = [...groups].map(([name, samples]) => {
  const requests = samples.flatMap(sample => sample.requests);
  const apiPaths = [...new Set(requests.filter(request => request.url.includes("/api/") && !request.url.endsWith("/events")).map(request => request.url))];
  const api = apiPaths.map(url => ({ url, medianMs: median(requests.filter(request => request.url === url).map(request => request.durationMs)), samples: requests.filter(request => request.url === url).length }));
  return {
    name, samples: samples.length,
    hostCpuBusyPercent: median(samples.map(s => s.hostCpuBusyPercent)),
    lcpMs: median(samples.map(s => s.initial.lcp?.ms)), fcpMs: median(samples.map(s => s.initial.fcpMs)),
    ttfbMs: median(samples.map(s => s.initial.ttfbMs)), cls: median(samples.map(s => s.initial.cls)),
    interactionProxyMs: median(samples.map(s => s.final.interactionMax)),
    initialJsTransferBytes: median(samples.map(s => s.initialJsTransferBytes)),
    initialTransferBytes: median(samples.map(s => s.initialTransferBytes)), initialRequests: median(samples.map(s => s.initialRequestCount)),
    domNodes: median(samples.map(s => s.initial.domNodes)),
    longestTaskMs: median(samples.map(s => Math.max(0, ...s.final.longTasks.map(t => t.duration)))),
    scrollFramesOver50msPercent: median(samples.map(s => 100 * s.final.frames.filter(ms => ms > 50).length / s.final.frames.length)),
    heapBefore: median(samples.map(s => s.memory.heapBefore)), heapAfter: median(samples.map(s => s.memory.heapAfter)),
    videoFirstLoadToPlayMs: median(samples.map(s => s.final.videos.find(v => v.firstPlay !== null)).filter(Boolean).map(v => v.firstPlay - v.firstLoad)),
    videoPlayFromNavigationMs: median(samples.map(s => s.final.videos.find(v => v.firstPlay !== null)?.firstPlay)),
    videoWaitingEvents: median(samples.map(s => s.final.videos.reduce((n, v) => n + v.waiting, 0))),
    droppedFrames: median(samples.map(s => s.final.quality.reduce((n, v) => n + (v.dropped || 0), 0))),
    errors: [...new Set(samples.flatMap(s => s.errors))],
    criticalFailures: [...new Set(requests.filter(r => (r.status >= 400 || r.failure) && ["Document", "Script", "Fetch", "XHR"].includes(r.type)).map(r => `${r.status || r.failure}: ${r.url}`))],
    api,
    shellVersions: [...new Set(requests.map(r => r.shellVersion).filter(Boolean))],
  };
});
const summary = { generatedAt: new Date().toISOString(), environment: "Chromium mobile lab; cold cache; synthetic throttling; API writes suppressed; not physical iPhone/Android or field Core Web Vitals", metricCaveats: "INP column is a sampled interaction proxy, not field INP. Video waiting includes initial buffering. Heap growth over a five-second scroll is not proof of a leak. Redirected routes report final-document paint timings and whole-journey request bytes. Null means not measured, never zero.", pages };
await writeFile(process.env.PERF_SUMMARY || ".qa/performance-summary.json", JSON.stringify(summary, null, 2));
for (const page of pages) console.log(JSON.stringify({ name: page.name, samples: page.samples, lcpMs: page.lcpMs, js: page.initialJsTransferBytes, bytes: page.initialTransferBytes, videoMs: page.videoFirstLoadToPlayMs, errors: page.errors.length }));
