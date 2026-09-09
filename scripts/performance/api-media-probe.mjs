// Bounded, read-only API and video-range observations. Never writes signed URLs to disk.
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.PERF_BASE_URL || "https://www.mydancr.com";
const output = process.env.PERF_OUTPUT || ".qa/performance";
const endpoints = ["/api/public/cities", "/api/public/discovery?city=Las%20Vegas", "/api/public/venues?city=Las%20Vegas", "/api/public/tv?city=Las%20Vegas"];
const api = [], media = [];
let videos = [];
for (const endpoint of endpoints) for (let run = 1; run <= 3; run++) {
  const started = performance.now();
  const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(30000) });
  const headersMs = performance.now() - started;
  const body = await response.text();
  api.push({ endpoint, run, status: response.status, headersMs, totalMs: performance.now() - started, decodedBytes: Buffer.byteLength(body), cacheControl: response.headers.get("cache-control"), serverTiming: response.headers.get("server-timing") });
  if (endpoint.startsWith("/api/public/tv?") && response.ok) videos = JSON.parse(body).videos || [];
}
for (const video of videos.slice(0, 3)) {
  const url = new URL(video.videoUrl);
  if (!url.hostname.endsWith(".supabase.co") || !url.pathname.startsWith("/storage/v1/")) continue;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const started = performance.now();
    const response = await fetch(url, { headers: { Range: "bytes=0-1048575" }, signal: controller.signal });
    const item = { id: video.id, width: video.width, height: video.height, durationSeconds: video.durationSeconds, status: response.status, range: response.headers.get("content-range"), acceptRanges: response.headers.get("accept-ranges"), cacheControl: response.headers.get("cache-control"), contentType: response.headers.get("content-type"), headersMs: performance.now() - started };
    if (response.status === 206) {
      const buffer = Buffer.from(await response.arrayBuffer());
      item.prefixBytes = buffer.length;
      item.totalMs = performance.now() - started;
      item.topLevelAtomsInPrefix = [];
      if (item.contentType?.includes("mp4")) for (let offset = 0; offset + 8 <= buffer.length;) {
        const size = buffer.readUInt32BE(offset), type = buffer.toString("ascii", offset + 4, offset + 8);
        item.topLevelAtomsInPrefix.push({ type, offset, size });
        if (size < 8) break;
        offset += size;
      }
    } else {
      await response.body?.cancel();
      item.note = "Range was not honored; stopped before downloading the full source.";
    }
    media.push(item);
  } finally { clearTimeout(timer); controller.abort(); }
}
await mkdir(output, { recursive: true });
const report = { measuredAt: new Date().toISOString(), base, note: "Unthrottled read-only probes; at most three 1 MiB video prefixes. Signed URL query strings are not retained. Results are not mobile startup measurements.", api, media };
await writeFile(output + "/api-media.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ apiSamples: api.length, apiFailures: api.filter(item => item.status !== 200).length, media }));
