import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../src/lib/dancr/tv.ts", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: () => ({ MAX_DANCER_PROFILE_VIDEOS: 50, isPublicDancerProfileEligible: () => true }) });
export const tvWorkspace = exports;

export function workspaceFixture(count, options = {}) {
  const calls = [], queries = [], timeline = [];
  const rows = Array.from({ length: count }, (_, index) => ({ id: `video-${index}`, storage_path: `owner/dancer/video-${index}.mp4`, caption: `Clip ${index}`, status: "approved", distribution_scope: "profile_and_feed" }));
  const resultForPath = path => options.failedPaths?.includes(path)
    ? { path, signedUrl: null, error: "Object unavailable" }
    : { path, signedUrl: `https://storage.example.test/signed/${path}`, error: null };
  const client = {
    from(table) {
      const queryRecord = { table, operations: [] };
      queries.push(queryRecord);
      const query = new Proxy({ then: async resolve => {
        timeline.push(table);
        if (options.queryError === table) return resolve({ data: null, error: new Error("Query rejected") });
        if (table === "dancer_profiles") return resolve({ data: options.missingDancer ? null : { id: "dancer", user_id: "owner", stage_name: "Fixture", slug: "fixture", is_public: true } });
        if (table === "mydancr_tv_videos") return resolve({ data: rows });
        if (options.metricsGate) await options.metricsGate;
        return resolve({ data: rows.length ? [{ video_id: rows[0].id, event_type: "impression" }] : [] });
      } }, { get: (target, key) => target[key] || ((...args) => { queryRecord.operations.push([key, ...args]); return query; }) });
      return query;
    },
    storage: { from: bucket => ({
      async createSignedUrl(path, expiresIn) {
        calls.push({ bucket, paths: [path], expiresIn, method: "single" }); timeline.push("sign");
        return options.storageError ? { data: null, error: new Error("Storage unavailable") } : { data: resultForPath(path) };
      },
      async createSignedUrls(paths, expiresIn) {
        calls.push({ bucket, paths: [...paths], expiresIn, method: "batch" }); timeline.push("sign");
        return options.storageError ? { data: null, error: new Error("Storage unavailable") } : { data: [...paths].reverse().map(resultForPath) };
      },
    }) },
  };
  return { client, rows, calls, queries, timeline };
}
