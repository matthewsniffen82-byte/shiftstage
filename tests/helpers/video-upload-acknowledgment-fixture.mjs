import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { resolveApiError } from "../../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../../src/lib/bounded-json-body.ts";
export const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const dancerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const videoId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const videoInput = { uploadId: videoId, mimeType: "video/mp4", fileSize: 1024, durationSeconds: 10, width: 720, height: 1280, consentConfirmed: true, rightsConfirmed: true };
export const storagePath = userId + "/" + dancerId + "/" + videoId + ".mp4";
const loadSource = path => process.env.VIDEO_UPLOAD_BASELINE === "1"
  ? execFileSync("git", ["show", "HEAD:" + path], { encoding: "utf8", windowsHide: true })
  : readFileSync(new URL("../../" + path, import.meta.url), "utf8");
function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(loadSource(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Error, Date, crypto: webcrypto, console: { warn() {}, error() {} }, require: name => dependencies(name) });
  return exports;
}
export function videoUploadHarness(options = {}) {
  const rows = new Map(), calls = [];
  const client = {
    from(table) {
      let mutation = null, value, count = false;
      const filters = [];
      const q = {
        select(_columns, settings) { count = settings?.head === true; return q; },
        eq(key, expected) { filters.push(row => row[key] === expected); return q; },
        in(key, expected) { filters.push(row => expected.includes(row[key])); return q; },
        insert(input) { mutation = "insert"; value = input; return q; },
        delete() { mutation = "delete"; return q; },
        maybeSingle: execute, single: execute,
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      async function execute() {
        if (table === "dancer_profiles") return { data: { id: dancerId, user_id: userId, stage_name: "Synthetic", city: "Las Vegas", status: "approved", avatar_storage_path: "synthetic-avatar" }, error: null };
        assert.equal(table, "mydancr_tv_videos");
        if (mutation === "insert") {
          calls.push("insert");
          if (options.insertError) return { data: null, error: options.insertError };
          if (rows.has(value.id)) return { data: null, error: { code: "23505" } };
          rows.set(value.id, structuredClone(value));
          if (options.afterInsertError) return { data: null, error: options.afterInsertError };
          return { data: "insertResponse" in options ? options.insertResponse : { id: value.id, storage_path: value.storage_path }, error: null };
        }
        const selected = [...rows.values()].filter(row => filters.every(filter => filter(row)));
        if (mutation === "delete") {
          calls.push("delete");
          for (const row of selected) rows.delete(row.id);
          return { data: null, error: null };
        }
        if (count) return { count: selected.length, error: null };
        return { data: selected[0] ? structuredClone(selected[0]) : null, error: null };
      }
      return q;
    },
    storage: { from(bucket) {
      assert.equal(bucket, "mydancr-tv-videos");
      return {
        async createSignedUploadUrl(path) {
          calls.push("sign");
          await options.beforeSign?.(rows);
          if (options.signThrow) throw options.signThrow;
          if (options.signError) return { data: null, error: options.signError };
          return { data: "signedResponse" in options ? options.signedResponse : { token: "synthetic-token", path, signedUrl: "https://example.invalid/upload" }, error: null };
        },
        async list(directory, { search }) {
          calls.push("list");
          assert.equal(directory + "/" + search, storagePath);
          if (options.listError) return { data: null, error: options.listError };
          return { data: "listResponse" in options ? options.listResponse : [], error: null };
        },
      };
    } },
  };
  const tv = load("src/lib/dancr/tv.ts", () => ({ MAX_DANCER_PROFILE_VIDEOS: 50, DancerIdentityReferenceRequiredError: class extends Error {} }));
  const run = (input = videoInput, actor = userId) => tv.createMyDancrTvUpload(client, actor, input);
  async function post() {
    const route = load("app/api/dancer/tv/videos/route.ts", name => {
      if (name === "next/server") return { NextResponse: { json: Response.json } };
      if (name === "@/src/lib/api") return { apiError(error, fallback, status) { const result = resolveApiError(error, fallback, status); return Response.json(result.body, { status: result.status }); } };
      if (name === "@/src/lib/bounded-json-body") return { readBoundedJsonObject };
      if (name === "@/src/lib/dancr/tv") return tv;
      if (name === "@/src/lib/dancr/media-request-rate-limit") return { DancerMediaRateLimitError: class extends Error {}, enforceDancerMediaRequestRateLimit: async () => {} };
      if (name === "@/src/lib/supabase/admin") return { createAdminSupabaseClient: () => client };
      if (name === "@/src/lib/supabase/request") return { createRequestSupabaseContext: async (_request, access) => { assert.equal(access.role, "dancer"); return { user: { id: userId } }; } };
      throw new Error("Unexpected dependency: " + name);
    });
    return route.POST(new Request("https://www.mydancr.com/api/dancer/tv/videos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(videoInput) }));
  }
  return { run, post, rows, calls, options };
}
