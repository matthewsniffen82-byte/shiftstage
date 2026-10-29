import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash, randomUUID } from "node:crypto";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { PublicApiError } from "../src/lib/api-error-policy.ts";
import { timeMediaStage } from "../src/lib/dancr/media-processing-timing.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const stranger = "22222222-2222-4222-8222-222222222222";
function load(path, require, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../" + path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require, File, Blob, FormData, Buffer, URL, DOMException, AbortController, Date, console, ...globals });
  return exports;
}
const service = load("src/lib/dancr/photo-upload-reservation.ts", name => {
  if (name === "crypto") return { createHash, randomUUID };
  if (name === "../api-error-policy") return { PublicApiError };
  if (name === "./image-validation") return { MAX_DANCR_RAW_UPLOAD_BYTES: 26214400 };
  if (name === "./media-processing-timing") return { timeMediaStage };
  return {};
});
function fixture() {
  const rows = [], objects = new Map(), calls = [];
  let removeError = null;
  const admin = {
    from(table) {
      assert.equal(table, "photo_upload_reservations");
      let operation = "select", values;
      const filters = [];
      const q = {
        select() { return q; }, order() { return q; }, limit() { return q; },
        eq(k, v) { filters.push(r => r[k] === v); return q; },
        gt(k, v) { filters.push(r => r[k] > v); return q; },
        lt(k, v) { filters.push(r => r[k] < v); return q; },
        in(k, v) { filters.push(r => v.includes(r[k])); return q; },
        insert(v) { operation = "insert"; values = structuredClone(v); return q; },
        update(v) { operation = "update"; values = structuredClone(v); return q; },
        delete() { operation = "delete"; return q; },
        async single() { return execute(true); }, async maybeSingle() { return execute(true); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
      };
      function execute(single) {
        let selected = rows.filter(r => filters.every(f => f(r)));
        if (operation === "insert") { rows.push(values); selected = [values]; }
        if (operation === "update") selected.forEach(r => Object.assign(r, values));
        if (operation === "delete") selected.forEach(r => rows.splice(rows.indexOf(r), 1));
        return { data: structuredClone(single ? selected[0] || null : selected), error: null };
      }
      return q;
    },
    storage: { from(bucket) {
      assert.equal(bucket, "dancer-photo-uploads");
      return {
        async list(dir) { return { data: [...objects].filter(([p]) => p.startsWith(dir + "/")).map(([p, b]) => ({ name: p.split("/").at(-1), metadata: { size: b.size } })), error: null }; },
        async createSignedUploadUrl(path, options) { assert.equal(options.upsert, false); calls.push("sign"); return { data: { path, signedUrl: "https://test.supabase.co/storage/v1/object/upload/sign/dancer-photo-uploads/" + path + "?token=synthetic" }, error: null }; },
        async download(path) { calls.push("download"); return { data: objects.get(path), error: null }; },
        async remove(paths) { calls.push("remove"); if (removeError) return { error: removeError }; paths.forEach(p => objects.delete(p)); return { data: paths.map(name => ({ name })), error: null }; },
      };
    } },
  };
  return { admin, rows, objects, calls, failRemove(error) { removeError = error; } };
}
const input = { bytes: 5, mime: "image/jpeg", uploadKey: "synthetic-upload", isPrimary: false, sortOrder: 1 };

test("direct photo reservation binds account, size and publication intent, and retries reuse stored bytes", async () => {
  const f = fixture();
  const a = await service.reservePhotoUpload(f.admin, owner, input);
  assert.equal(a.uploadComplete, false);
  const path = owner + "/" + a.id;
  f.objects.set(path, new Blob(["photo"], { type: "image/jpeg" }));
  const retry = await service.reservePhotoUpload(f.admin, owner, input);
  assert.equal(retry.id, a.id);
  assert.equal(retry.uploadComplete, true);
  assert.equal(f.calls.filter(c => c === "sign").length, 1);
  for (const changes of [{ bytes: 6 }, { sortOrder: 2 }, { isPrimary: true }, { replaceExisting: true }]) {
    await assert.rejects(service.reservePhotoUpload(f.admin, owner, { ...input, ...changes }), /Invalid photo upload/);
  }
  await assert.rejects(service.readReservedPhotoUpload(f.admin, stranger, a.id), /Invalid photo upload/);
  assert.equal(f.calls.includes("download"), false);
  const finalized = await service.readReservedPhotoUpload(f.admin, owner, a.id);
  assert.equal(await finalized.file.text(), "photo");
  assert.equal(finalized.userId, owner);
  assert.equal(finalized.idempotencyKey, "direct:" + a.id);
  assert.equal(finalized.sortOrder, 1);
  assert.equal(finalized.uploadContext, "profile_gallery");
});

test("oversize, unsupported and substituted photo uploads are rejected before moderation", async () => {
  const f = fixture();
  for (const change of [{ bytes: 26214401 }, { bytes: 0 }, { mime: "text/html" }, { sortOrder: -1 }, { replacementPhotoId: "../foreign" }]) {
    await assert.rejects(service.reservePhotoUpload(f.admin, owner, { ...input, ...change }), /Invalid photo upload/);
  }
  const a = await service.reservePhotoUpload(f.admin, owner, input);
  f.objects.set(owner + "/" + a.id, new Blob(["different length"]));
  await assert.rejects(service.readReservedPhotoUpload(f.admin, owner, a.id), /Invalid photo upload/);
});

test("expired photos cannot renew or finalize; failed cleanup retains the retry record", async () => {
  const f = fixture();
  const a = await service.reservePhotoUpload(f.admin, owner, input);
  const path = owner + "/" + a.id;
  f.objects.set(path, new Blob(["photo"]));
  f.rows[0].expires_at = new Date(Date.now() - 3600000).toISOString();
  await assert.rejects(service.reservePhotoUpload(f.admin, owner, input), /expired/);
  await assert.rejects(service.readReservedPhotoUpload(f.admin, owner, a.id), /expired/);
  f.failRemove(new Error("storage unavailable"));
  await assert.rejects(service.cleanExpiredPhotoUploads(f.admin), /storage unavailable/);
  assert.equal(f.rows.length, 1);
  f.failRemove(null);
  assert.equal(await service.cleanExpiredPhotoUploads(f.admin), 1);
  assert.equal(f.rows.length, 0);
  assert.equal(f.objects.size, 0);
});

for (const [mime, transferMime] of [["image/jpeg", "image/jpeg"], ["image/heic-sequence", "application/octet-stream"], ["", "application/octet-stream"]]) test("direct photo transfer binds MIME type, preserves progress and sends only an ID: " + mime, async () => {
  const listeners = new Map(), requests = [], transfers = [], progress = [];
  let account = owner;
  const id = randomUUID();
  class Xhr {
    upload = {};
    open(method, url) { transfers.push({ method, url }); }
    setRequestHeader(key, value) { assert.equal(key, "content-type"); assert.equal(value, transferMime); }
    send(file) { assert.equal(file.size, 5); this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 5 }); this.status = 200; this.onload(); }
    abort() {}
  }
  const browser = load("app/dashboard/direct-photo-upload.ts", name => {
    if (name.endsWith("/env")) return { getPublicEnv: () => ({ supabaseUrl: "https://test.supabase.co" }) };
    return { DASHBOARD_SESSION_KEY: "session", readSession: () => ({ account: { id: account, role: "dancer" } }) };
  }, { XMLHttpRequest: Xhr, window: { addEventListener: (k, v) => listeners.set(k, v), removeEventListener: k => listeners.delete(k) } });
  assert.equal(browser.photoUploadMime(new File(["heic"], "photo.heic", { type: "image/heic-sequence" })), "application/octet-stream");
  assert.equal(browser.photoUploadMime(new File(["heic"], "photo.heic")), "application/octet-stream");
  assert.equal(browser.photoUploadMime(new File(["photo"], "photo.jpg", { type: "image/jpeg" })), "image/jpeg");
  const signedUrl = "https://test.supabase.co/storage/v1/object/upload/sign/dancer-photo-uploads/" + owner + "/" + id + "?token=synthetic";
  for (const bad of [signedUrl.replace("test.supabase.co", "evil.invalid"), signedUrl.replace(owner, stranger), signedUrl.replace("/upload/sign/", "/public/")]) assert.throws(() => browser.checkedPhotoUploadUrl(bad, owner, id), /destination/);
  const body = new FormData();
  body.set("file", new File(["photo"], "photo.jpg", { type: mime }));
  body.set("idempotencyKey", "test"); body.set("sortOrder", "1");
  const request = async (path, options) => {
    requests.push([path, options]);
    if (path.endsWith("/uploads")) { assert.equal(JSON.parse(options.body).mime, transferMime); return { upload: { id, uploadComplete: false, signedUrl } }; }
    assert.deepEqual(JSON.parse(options.body), { uploadId: id });
    return { decision: "approved" };
  };
  const result = await browser.directPhotoUpload({ body, signal: new AbortController().signal, onUploadProgress: p => progress.push(p) }, request);
  assert.equal(result.decision, "approved"); assert.equal(requests.length, 2);
  assert.equal(transfers[0].method, "PUT"); assert.deepEqual(progress, [99, 100]); assert.equal(listeners.size, 0);
  requests.length = 0;
  await assert.rejects(browser.directPhotoUpload({ body }, async () => { account = stranger; return { upload: { id, uploadComplete: true } }; }), /canceled/);
  assert.equal(transfers.length, 1);
});

test("migration keeps raw photo storage and reservations inaccessible to browser roles", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects(bucket_id text); alter table storage.objects enable row level security; grant usage on schema storage to anon, authenticated; grant select, insert on storage.objects to anon, authenticated; create policy permissive on storage.objects for all to anon, authenticated using(true) with check(true); create table public.mydancr_tv_videos(status text);");
    await db.exec(readFileSync(new URL("../supabase/migrations/20261016220736_faster_private_media_uploads.sql", import.meta.url), "utf8"));
    await db.exec("insert into storage.objects values ('dancer-photo-uploads'); set role anon;");
    assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
    await assert.rejects(db.query("select * from public.photo_upload_reservations"), /permission denied/);
    await assert.rejects(db.exec("insert into storage.objects values ('dancer-photo-uploads')"), /row-level security/);
    await db.exec("reset role; set role authenticated;");
    assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
    await assert.rejects(db.query("select * from public.photo_upload_reservations"), /permission denied/);
    await db.exec("reset role;");
    await assert.rejects(db.exec("insert into public.mydancr_tv_videos values ('approved', true)"), /tv_validated_before_approval/);
  } finally { await db.close(); }
});

test('a reserved club upload cannot be reused for another club',async()=>{
 const f=fixture();const input={bytes:123,mime:'image/jpeg',uploadKey:'club-draft',isPrimary:false,sortOrder:1,editorVenueId:owner};
 await service.reservePhotoUpload(f.admin,owner,input);
 await assert.rejects(service.reservePhotoUpload(f.admin,owner,{...input,editorVenueId:stranger}),/Invalid photo upload/);
});
