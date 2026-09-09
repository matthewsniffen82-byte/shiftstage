import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";
import { MAX_PROFILE_PHOTO_DELETIONS, validateProfilePhotoDeletionInput } from "../src/lib/dancr/profile-photo-input.ts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const invalidPayloads = [
  { deletedPhotoIds: Array(MAX_PROFILE_PHOTO_DELETIONS + 1).fill(id) },
  { deletedPhotoIds: Array(500).fill(id) },
  ...[null, {}, id, 1, true].map(deletedPhotoIds => ({ deletedPhotoIds })),
  ...[null, {}, 12, true, "", "not-a-uuid", id + ",id.not.is.null"].map(value => ({ deletedPhotoIds: [value] })),
  { deletedPhotoStoragePaths: Array(MAX_PROFILE_PHOTO_DELETIONS * 2 + 1).fill("owner/photo.jpg") },
  { deletedPhotoStoragePaths: "owner/photo.jpg" },
  { deletedPhotoStoragePaths: [null] },
  { deletedPhotoStoragePaths: [{}] },
  { deletedPhotoStoragePaths: [""] },
  { deletedPhotoStoragePaths: ["x".repeat(4_097)] },
];
for (const [index, payload] of invalidPayloads.entries()) test(`photo deletion validation rejects malformed or excessive collection ${index + 1}`, () => {
  assert.throws(() => validateProfilePhotoDeletionInput(payload), error => error.status === 400);
});
test("normal, pending and empty editor deletion batches remain valid", () => {
  for (const payload of [{}, { deletedPhotoIds: [], deletedPhotoStoragePaths: [] }, {
    deletedPhotoIds: Array(MAX_PROFILE_PHOTO_DELETIONS).fill(id.toUpperCase()),
    deletedPhotoStoragePaths: Array(MAX_PROFILE_PHOTO_DELETIONS * 2).fill("owner/profile/photo.jpg"),
  }]) assert.doesNotThrow(() => validateProfilePhotoDeletionInput(payload));
});

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [index, payload] of invalidPayloads.entries()) test(`profile PATCH rejects invalid deletion collection ${index + 1} before database work`, async () => {
  const calls = [], exports = {};
  const deniedWork = new Proxy({}, { get(_target, name) {
    if (name === "__esModule") return false;
    return class { constructor() { calls.push(String(name)); throw new Error("Unexpected downstream work"); } };
  } });
  vm.runInNewContext(code, { exports, Error, Request, Response, URL, console: { log() {}, warn() {}, error() {} }, require(name) {
    if (name === "next/server") return require(name);
    if (name === "@/src/lib/bounded-json-body") return { readBoundedJsonObject };
    if (name === "@/src/lib/dancr/profile-photo-input") return { validateProfilePhotoDeletionInput };
    if (name === "@/src/lib/api") return { PublicApiError, apiError(error, fallback) {
      const result = resolveApiError(error, fallback); return require("next/server").NextResponse.json(result.body, { status: result.status });
    } };
    if (name === "@/src/lib/supabase/request") return { createRequestSupabaseContext: async () => ({ user: { id }, client: {
      from() { calls.push("database"); throw new Error("Unexpected downstream work"); },
    } }) };
    if (name === "@/src/lib/security/safe-error-metadata") return { safeErrorMetadata: () => ({}) };
    return deniedWork;
  } });
  const request = new Request("https://www.mydancr.com/api/dancer/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ socials: [{ platform: "instagram", handle: "synthetic" }], ...payload }) });
  const response = await exports.PATCH(request);
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});
