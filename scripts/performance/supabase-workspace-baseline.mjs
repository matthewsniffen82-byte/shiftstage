// Executes the actual server loaders against an instrumented SDK fixture.
// Request counts are deterministic; this does not measure production database latency.
import { mkdir, writeFile } from "node:fs/promises";
import { tvWorkspace, workspaceFixture } from "../../tests/helpers/tv-workspace-fixture.mjs";
const output = process.env.PERF_OUTPUT || ".qa/supabase-workspace";
await mkdir(output, { recursive: true });
const results = [];
for (const [role, count] of [["dancer", 50], ["admin", 100], ["dancer", 0], ["admin", 0]]) {
  const fixture = workspaceFixture(count);
  const result = role === "dancer"
    ? await tvWorkspace.getDancerMyDancrTvWorkspace(fixture.client, "owner")
    : await tvWorkspace.getAdminMyDancrTvVideos(fixture.client, "submitted");
  const videos = Array.isArray(result) ? result : result.videos;
  results.push({ role, inputRows: count, returnedRows: videos.length, signedRows: videos.filter(row => row.videoUrl).length,
    storageRequests: fixture.calls.length, databaseQueries: fixture.queries.length, methods: [...new Set(fixture.calls.map(call => call.method))],
    maxPathsPerRequest: Math.max(0, ...fixture.calls.map(call => call.paths.length)), expirySeconds: [...new Set(fixture.calls.map(call => call.expiresIn))] });
}
await writeFile(`${output}/results.json`, JSON.stringify({ syntheticSdkFixture: true, productionLatencyMeasured: false, results }, null, 2));
console.log(JSON.stringify(results));
