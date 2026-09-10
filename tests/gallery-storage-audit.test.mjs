import assert from "node:assert/strict";
import test from "node:test";
import { auditGalleryStorage, galleryAuditFetch, parseGalleryStorageAuditOptions } from "../scripts/lib/gallery-storage-audit.mjs";

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const profileId = uuid(1), userId = uuid(2), prefix = `${userId}/${profileId}`;
const old = "2020-01-01T00:00:00Z", now = Date.parse("2026-09-09T12:00:00Z");
const name = `${uuid(3)}.r320-480.m600x800.f50x50.jpg`;
const path = `${prefix}/${name}`, originalPath = `dancer-photos/${path}`;
const publicBucket = "dancer-photos", originalBucket = "dancr-media-originals";
const objectKey = (bucket, value) => `${bucket}/${value}`;

function fixture() {
  const tables = {
    dancer_profiles: [{ id: profileId, user_id: userId, avatar_storage_path: null }],
    dancer_photos: [{ id: uuid(4), dancer_id: profileId, storage_path: path, review_status: "approved" }],
    image_moderation_records: [{ id: uuid(5), user_id: userId, final_storage_path: path, temporary_storage_path: "private-temp" }],
  };
  const row = (fileName, id = uuid(6)) => ({ name: fileName, id, metadata: { size: 2048 }, created_at: old, updated_at: old });
  const files = new Map([[publicBucket, path], [originalBucket, originalPath]].map(([bucket, value], i) => [objectKey(bucket, value), {
    name: value, id: uuid(20 + i), version: "version-private", bucketId: bucket, size: 2048, createdAt: old, lastModified: old,
  }]));
  const state = { tables, files, entries: [row(name), row(`${name}.w320.webp`, uuid(7))], row,
    queries: [], lists: [], infos: [], beforeQuery() {}, beforeInfo() {}, beforeList() {}, badBucket: "", badTable: "" };
  const client = {
    from(table) {
      let columns, limit, single = false;
      const filters = [];
      const query = {
        select(value) { columns = value; return this; },
        eq(column, value) { filters.push(row => row[column] === value); return this; },
        in(column, values) { filters.push(row => values.includes(row[column])); return this; },
        limit(value) { limit = value; return this; },
        maybeSingle() { single = true; return this; },
        async then(resolve, reject) {
          try {
            state.queries.push({ table, columns, limit, single });
            state.beforeQuery(table, columns);
            if (table === state.badTable) return resolve({ data: null, error: { message: "private provider credential" } });
            let rows = tables[table].filter(row => filters.every(filter => filter(row)));
            if (limit) rows = rows.slice(0, limit);
            rows = rows.map(row => Object.fromEntries(columns.split(",").map(column => [column, row[column]])));
            resolve({ data: structuredClone(single ? rows[0] ?? null : rows), error: null });
          } catch (error) { reject(error); }
        },
      };
      return query;
    },
    storage: {
      async getBucket(bucket) { return { data: { id: bucket, public: bucket === (state.badBucket || publicBucket) }, error: null }; },
      from(bucket) {
        return {
          async list(directory, options) {
            state.lists.push({ bucket, directory, options });
            state.beforeList();
            return { data: structuredClone(state.entries.slice(options.offset, options.offset + options.limit)), error: null };
          },
          async info(value) {
            state.infos.push({ bucket, path: value });
            state.beforeInfo(bucket, value);
            return files.has(objectKey(bucket, value)) ? { data: structuredClone(files.get(objectKey(bucket, value))), error: null }
              : { data: null, error: { statusCode: "404" } };
          },
          remove() { throw new Error("Audit must never delete storage."); },
          download() { throw new Error("Audit must never download image contents."); },
          upload() { throw new Error("Audit must never write storage."); },
        };
      },
    },
  };
  state.run = (options = {}) => auditGalleryStorage(client, { profileId, ...options }, { now });
  return state;
}

test("audit requires an explicit profile and has bounded metadata-only defaults", () => {
  assert.deepEqual(parseGalleryStorageAuditOptions([`--profile=${profileId}`]), { profileId, side: "public", limit: 10, offset: 0 });
  assert.deepEqual(parseGalleryStorageAuditOptions([`--profile=${profileId}`, "--side=originals", "--limit=20", "--offset=80"]), { profileId, side: "originals", limit: 20, offset: 80 });
});

for (const args of [[], ["--profile=../private"], [`--profile=${profileId}`, "--apply"], [`--profile=${profileId}`, "--limit=21"],
  [`--profile=${profileId}`, "--limit=0"], [`--profile=${profileId}`, "--offset=-1"], [`--profile=${profileId}`, "--offset=1000000"],
  [`--profile=${profileId}`, "--side=avatars"], [`--profile=${profileId}`, "--all"], [`--profile=${profileId}`, "--limit=10", "--limit=20"]]) {
  test(`invalid audit scope is rejected: ${args.join(" ")}`, () => assert.throws(() => parseGalleryStorageAuditOptions(args)));
}

test("programmatic callers cannot enable apply or escape page bounds", async () => {
  for (const options of [{ apply: true }, { limit: 21 }, { offset: -1 }, { side: "other" }, { profileId: "../escape" }]) {
    const f = fixture();
    await assert.rejects(f.run(options));
    assert.equal(f.queries.length, 0);
  }
});

test("actual inventory groups master and derivatives with bounded reference reads and no sensitive output", async () => {
  const f = fixture(), report = await f.run();
  assert.equal(report.ok, true);
  assert.equal(report.mode, "read_only");
  assert.equal(report.deletionAuthorized, false);
  assert.equal(report.scanned, 2);
  assert.equal(report.observedBytes, 4096);
  assert.equal(report.byteCountComplete, true);
  assert.deepEqual(report.results.map(row => row.status), ["referenced", "referenced"]);
  assert.deepEqual(report.results[0].companions, { publicMaster: "present", original: "present" });
  assert.equal(f.queries.length, 5, "one profile read plus four reference existence checks per distinct master");
  assert.ok(f.queries.filter(query => !query.single).every(query => query.limit === 1 && query.columns === "id"));
  assert.equal(f.infos.length, 2);
  assert.equal(report.results[0].publicationKey, report.results[1].publicationKey);
  assert.equal(f.lists.length, 1);
  assert.deepEqual(f.lists[0], { bucket: publicBucket, directory: prefix, options: { limit: 10, offset: 0, sortBy: { column: "name", order: "asc" } } });
  for (const sensitive of [profileId, userId, name, path, old, "private", "version-"]) assert.equal(JSON.stringify(report).includes(sensitive), false);
});

test("references under other owners and statuses, including derivatives, keep a file referenced", async () => {
  const f = fixture();
  f.tables.dancer_photos = [];
  f.tables.dancer_profiles.push({ id: uuid(31), user_id: uuid(32), avatar_storage_path: `${path}.w480.webp` });
  const report = await f.run();
  assert.equal(report.results[0].references.avatar, true);
  assert.equal(report.results[0].status, "referenced");
  f.tables.dancer_profiles.pop();
  f.tables.dancer_photos.push({ id: uuid(33), dancer_id: uuid(34), storage_path: path, review_status: "rejected" });
  assert.equal((await f.run()).results[0].status, "referenced");
});

test("moderation history and unknown outcomes are retained even without a live gallery row", async () => {
  const f = fixture();
  f.tables.dancer_photos = [];
  f.tables.image_moderation_records[0].user_id = uuid(90);
  f.tables.image_moderation_records[0].status = "moderation_error";
  let report = await f.run();
  assert.equal(report.results[0].status, "moderation_record_only");
  f.tables.image_moderation_records[0].final_storage_path = null;
  f.tables.image_moderation_records[0].temporary_storage_path = `${path}.w320.webp`;
  report = await f.run();
  assert.equal(report.results[0].status, "moderation_record_only");
  assert.equal(report.results[0].references.moderationSource, true);
});

test("unreferenced recent and old files are observations, never authorized cleanup candidates", async () => {
  const f = fixture();
  f.tables.dancer_photos = [];
  f.tables.image_moderation_records = [];
  f.entries[1].updated_at = new Date(now).toISOString();
  const report = await f.run();
  assert.deepEqual(report.results.map(row => row.status), ["no_known_reference", "no_known_reference"]);
  assert.deepEqual(report.results.map(row => row.age), ["at_least_seven_days", "recent"]);
  assert.equal(report.deletionAuthorized, false);
});

test("originals are independently listed so an original without a public file is discoverable", async () => {
  const f = fixture();
  f.entries = [f.row(name)];
  f.files.delete(objectKey(publicBucket, path));
  const report = await f.run({ side: "originals" });
  assert.deepEqual(f.lists[0].directory, `dancer-photos/${prefix}`);
  assert.equal(f.lists[0].bucket, originalBucket);
  assert.equal(report.results[0].companions.publicMaster, "missing");
  assert.equal(report.results[0].companions.original, "present");
  assert.equal(report.results[0].status, "referenced");
});

test("a missing archive is reported even when the published gallery reference exists", async () => {
  const f = fixture();
  f.files.delete(objectKey(originalBucket, originalPath));
  assert.equal((await f.run()).results[0].companions.original, "missing");
});

test("publication keys correlate both storage sides without disclosing their path", async () => {
  const f = fixture(); f.entries = [f.row(name)];
  const publicReport = await f.run(), originalReport = await f.run({ side: "originals" });
  assert.equal(publicReport.results[0].publicationKey, originalReport.results[0].publicationKey);
  assert.notEqual(publicReport.results[0].objectKey, originalReport.results[0].objectKey);
});

test("byte-count overflow fails instead of reporting an inaccurate total", async () => {
  const f = fixture(); f.entries.forEach(row => { row.metadata.size = Number.MAX_SAFE_INTEGER; });
  await assert.rejects(f.run());
});

test("pagination honors an explicit offset without recursing into folders or scanning additional pages", async () => {
  const f = fixture();
  f.entries.unshift({ name: "avatar", id: null, metadata: null });
  const first = await f.run({ limit: 2 });
  assert.equal(first.results[0].status, "folder_not_scanned");
  assert.equal(first.nextOffset, 2);
  const second = await f.run({ limit: 2, offset: first.nextOffset });
  assert.equal(second.scanned, 1);
  assert.equal(second.nextOffset, null);
  assert.equal(f.lists.length, 2);
  assert.equal(second.results[0].objectKey === first.results[1].objectKey, false);
});

for (const fileName of ["legacy.jpg", "legacy.poster.webp", name.replace("r320-480", "r480-320"), name.replace("f50x50", "f101x50"),
  name.replace("r320-480", "r999"), `${name}.w999.webp`, "__originals", name.replace("m600", "m400")]) {
  test(`unrecognized name is retained without guessed reference checks: ${fileName}`, async () => {
    const f = fixture(); f.entries = [f.row(fileName)];
    const report = await f.run();
    assert.equal(report.results[0].status, "unrecognized");
    assert.equal(f.queries.length, 1);
    assert.equal(f.infos.length, 0);
  });
}

for (const badName of ["../escape", "folder/file", "folder\\file", ".", "..", "bad\nname", "a".repeat(513)]) {
  test("unsafe returned names abort before any object inspection", async () => {
    const f = fixture(); f.entries = [f.row(badName)];
    await assert.rejects(f.run());
    assert.equal(f.infos.length, 0);
  });
}

test("bucket privacy and missing ownership fail before listing storage", async () => {
  const f = fixture(); f.badBucket = originalBucket;
  await assert.rejects(f.run());
  assert.equal(f.lists.length, 0);
  f.badBucket = ""; f.tables.dancer_profiles = [];
  await assert.rejects(f.run());
  assert.equal(f.lists.length, 0);
});

for (const mutate of [f => { f.entries[0].metadata.size = "2048"; }, f => { f.entries[0].created_at = "invalid"; },
  f => { f.files.get(objectKey(publicBucket, path)).name = "foreign/path"; },
  f => { f.files.get(objectKey(originalBucket, originalPath)).version = null; },
  f => { f.badTable = "dancer_photos"; }, f => { f.beforeInfo = () => { throw new Error("private signed URL"); }; }]) {
  test("failed or malformed provider reads are never converted to a missing reference", async () => {
    const f = fixture(); mutate(f);
    const report = await f.run();
    assert.equal(report.ok, false);
    assert.equal(report.results[0].status, "verification_failed");
    assert.equal(report.deletionAuthorized, false);
    assert.doesNotMatch(JSON.stringify(report), /private|credential|signed/);
  });
}

test("a concurrent new reference is reflected on the next audit without deleting anything", async () => {
  const f = fixture(); f.tables.dancer_photos = []; f.tables.image_moderation_records = [];
  assert.equal((await f.run()).results[0].status, "no_known_reference");
  f.tables.dancer_photos.push({ id: uuid(70), storage_path: path });
  assert.equal((await f.run()).results[0].status, "referenced");
});

test("transport only permits the actual SDK metadata routes and blocks all mutation, RPC, image and foreign-origin requests", async () => {
  const origin = "https://example.supabase.co", calls = [];
  const guarded = galleryAuditFetch(origin, async (input, options) => { calls.push({ input, options }); return new Response("{}"); });
  for (const route of ["/rest/v1/dancer_profiles?select=id&limit=1", "/rest/v1/dancer_photos", "/rest/v1/image_moderation_records",
    "/storage/v1/bucket/dancer-photos", "/storage/v1/bucket/dancr-media-originals", `/storage/v1/object/info/dancer-photos/${path}`]) {
    await guarded(`${origin}${route}`);
  }
  await guarded(`${origin}/storage/v1/object/list/dancer-photos`, { method: "POST", body: "{}" });
  await guarded(new Request(`${origin}/storage/v1/object/list/dancr-media-originals`, { method: "POST", body: "{}" }));
  assert.equal(calls.length, 8);
  assert.ok(calls.every(call => call.options.redirect === "error" && call.options.signal instanceof AbortSignal));
  for (const [url, method] of [
    [`${origin}/rest/v1/dancer_photos`, "DELETE"], [`${origin}/rest/v1/dancer_profiles`, "PATCH"],
    [`${origin}/rest/v1/image_moderation_records`, "POST"], [`${origin}/rest/v1/rpc/publish_approved_dancer_gallery_photo`, "POST"],
    [`${origin}/rest/v1/rpc/unsafe`, "GET"], [`${origin}/storage/v1/object/dancer-photos`, "DELETE"],
    [`${origin}/storage/v1/object/dancer-photos/${path}`, "POST"], [`${origin}/storage/v1/object/public/dancer-photos/${path}`, "GET"],
    [`${origin}/storage/v1/object/sign/dancer-photos/${path}`, "POST"], [`${origin}/storage/v1/object/list/private`, "POST"],
    ["https://evil.example/rest/v1/dancer_profiles", "GET"], ["https://user:password@example.supabase.co/rest/v1/dancer_profiles", "GET"],
  ]) assert.throws(() => guarded(url, { method }));
  assert.equal(calls.length, 8, "blocked requests never reach the network");
});
