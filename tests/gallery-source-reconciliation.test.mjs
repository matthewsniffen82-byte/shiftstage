import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceReconciliationOptions, reconcileGallerySources } from "../scripts/lib/gallery-source-reconciliation.mjs";

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = uuid(1), profileId = uuid(2), recordId = uuid(3), photoId = uuid(4);
const now = Date.parse("2026-09-09T00:00:00Z"), old = "2020-01-01T00:00:00.000001Z";
const prefix = `${owner}/${profileId}/`;
const temp = `${prefix}1600000000000-${uuid(5)}.jpg`;
const review = temp.replace(prefix, `${prefix}review-`);
const published = `${prefix}${uuid(6)}.webp`;
const tempBucket = "dancr-image-moderation-temp", reviewBucket = "dancr-image-moderation-review";
const key = (bucket, path) => `${bucket}:${path}`;

function fixture() {
  const record = { id: recordId, user_id: owner, image_id: photoId, decision: "approved", status: "approved",
    upload_context: "profile_gallery:2", temporary_storage_path: review, final_storage_path: published, updated_at: old, completed_at: old };
  const tables = {
    image_moderation_records: [record],
    dancer_profiles: [{ id: profileId, user_id: owner, avatar_storage_path: null }],
    dancer_photos: [{ id: photoId, dancer_id: profileId, storage_path: published, review_status: "approved" }],
  };
  const files = new Map([
    [tempBucket, temp], [reviewBucket, review], ["dancer-photos", published], ["dancr-media-originals", `dancer-photos/${published}`],
  ].map(([bucket, path], index) => [key(bucket, path), { id: uuid(20 + index), version: `version-${index}`,
    bucketId: bucket, name: path, createdAt: old, lastModified: old, size: 2048 }]));
  const calls = [], removals = [], queryLimits = [];
  const fixture = { tables, files, record, calls, removals, queryLimits, beforeRead() {}, beforeInfo() {}, afterRemove() {}, failedTable: "", failedObject: "", removeFailure: "", publicBucket: "", missingBucket: "" };
  const client = {
    from(table) {
      let columns, limit = Infinity, single = false, order;
      const filters = [];
      const query = {
        select(value) { columns = value; return this; },
        eq(field, value) { filters.push(row => row[field] === value); return this; },
        neq(field, value) { filters.push(row => row[field] !== value); return this; },
        in(field, values) { filters.push(row => values.includes(row[field])); return this; },
        lt(field, value) { filters.push(row => row[field] < value); return this; },
        gt(field, value) { filters.push(row => row[field] > value); return this; },
        limit(value) { limit = value; queryLimits.push({ table, limit: value }); return this; },
        order(value) { order = value; return this; },
        maybeSingle() { single = true; return this; },
        async then(resolve, reject) {
          try {
            calls.push({ table, columns, single });
            fixture.beforeRead({ table, columns, single });
            if (fixture.failedTable === table) return resolve({ data: null, error: { message: "secret provider URL" } });
            let rows = tables[table].filter(row => filters.every(filter => filter(row)));
            if (order) rows = rows.toSorted((a, b) => a[order].localeCompare(b[order]));
            rows = rows.slice(0, limit).map(row => Object.fromEntries(columns.split(",").map(column => [column, row[column]])));
            resolve({ data: structuredClone(single ? rows[0] || null : rows), error: null });
          } catch (error) { reject(error); }
        },
      };
      return query;
    },
    storage: {
      async getBucket(bucket) { return { data: fixture.missingBucket === bucket ? null : { id: bucket, public: fixture.publicBucket === bucket }, error: null }; },
      from(bucket) {
        return {
          async info(path) {
            fixture.beforeInfo(bucket, path);
            if (fixture.failedObject === key(bucket, path)) return { data: null, error: { status: 500, message: "secret signed URL" } };
            return files.has(key(bucket, path)) ? { data: structuredClone(files.get(key(bucket, path))), error: null }
              : { data: null, error: { statusCode: "404" } };
          },
          async remove(paths) {
            assert.ok([tempBucket, reviewBucket].includes(bucket), "never remove approved media or its original");
            assert.equal(paths.length, 1);
            removals.push({ bucket, paths });
            if (fixture.removeFailure !== "before") paths.forEach(path => files.delete(key(bucket, path)));
            fixture.afterRemove(bucket, paths);
            if (fixture.removeFailure) return { data: null, error: { message: "secret storage error" } };
            return { data: paths.map(path => ({ name: path })), error: null };
          },
        };
      },
    },
  };
  fixture.run = options => reconcileGallerySources(client, options || { recordId }, { now });
  fixture.apply = expectedPlan => fixture.run({ recordId, apply: true, expectedPlan });
  return fixture;
}

test("default maintenance options are bounded and read-only", () => {
  assert.deepEqual(parseSourceReconciliationOptions([]), { apply: false, limit: 5 });
  assert.deepEqual(parseSourceReconciliationOptions(["--limit=20", `--after=${recordId}`]), { apply: false, limit: 20, afterId: recordId });
});

for (const args of [["--apply"], ["--apply", `--record=${recordId}`], ["--limit=21"], ["--limit=0"], ["--limit=-1"], ["--limit=1e1"], ["--limit=1", "--limit=2"], ["--all"], ["--apply=false"], ["--record=bad"], ["--after=bad"], [`--record=${recordId}`, `--after=${recordId}`], [`--expected-plan=${"a".repeat(64)}`]]) {
  test(`unsafe or ambiguous options fail before any provider call: ${args.join(" ")}`, () => assert.throws(() => parseSourceReconciliationOptions(args)));
}

test("dry run identifies both retained immutable copies without paths, account data or writes", async () => {
  const f = fixture(), report = await f.run();
  assert.equal(report.ok, true);
  assert.equal(report.mode, "dry_run");
  assert.equal(report.results[0].status, "eligible");
  assert.equal(report.results[0].sourceCount, 2);
  assert.equal(report.results[0].sourceBytes, 4096);
  assert.match(report.results[0].expectedPlan, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(`${owner}|${profileId}|${published}|version-`));
  assert.deepEqual(f.removals, []);
  assert.ok(f.calls.every(call => call.columns !== "*"));
});

test("an exact reviewed plan removes only old private copies and supports a harmless repeat", async () => {
  const f = fixture(), token = (await f.run()).results[0].expectedPlan;
  const applied = await f.apply(token);
  assert.equal(applied.ok, true);
  assert.equal(applied.results[0].status, "cleaned");
  assert.equal(applied.results[0].confirmedRemoved, 2);
  assert.deepEqual(f.removals, [{ bucket: tempBucket, paths: [temp] }, { bucket: reviewBucket, paths: [review] }]);
  assert.ok(f.files.has(key("dancer-photos", published)));
  assert.ok(f.files.has(key("dancr-media-originals", `dancer-photos/${published}`)));
  assert.equal((await f.apply(token)).results[0].status, "already_clean");
  assert.equal(f.removals.length, 2);
});

test("cursor pagination does not loop forever on already-clean records", async () => {
  const f = fixture();
  f.tables.image_moderation_records.push({ ...f.record, id: uuid(7) }, { ...f.record, id: uuid(8) });
  const first = await f.run({ limit: 2 });
  assert.equal(first.scanned, 2);
  assert.equal(first.nextCursor, uuid(7));
  const second = await f.run({ limit: 2, afterId: first.nextCursor });
  assert.deepEqual(second.results.map(row => row.recordId), [uuid(8)]);
  assert.equal(second.nextCursor, null);
  assert.ok(f.queryLimits.every(entry => entry.limit <= 2));
});

for (const [label, change, reason] of [
  ["pending review", f => { f.record.decision = "review"; }, "approval_unconfirmed"],
  ["inconsistent terminal state", f => { f.record.status = "moderating"; }, "approval_unconfirmed"],
  ["avatar workflow", f => { f.record.upload_context = "profile_avatar"; }, "approval_unconfirmed"],
  ["recent approval", f => { f.record.updated_at = new Date(now).toISOString(); }, "approval_too_recent"],
  ["missing completion", f => { f.record.completed_at = null; }, "approval_too_recent"],
  ["invalid timestamp", f => { f.record.updated_at = "invalid"; }, "approval_too_recent"],
  ["cross-profile photo", f => { f.tables.dancer_photos[0].dancer_id = uuid(9); }, "publication_mismatch"],
  ["removed approved photo", f => { f.tables.dancer_photos = []; }, "published_photo_missing"],
  ["unpublished photo", f => { f.tables.dancer_photos[0].review_status = "rejected"; }, "publication_mismatch"],
  ["foreign source", f => { f.record.temporary_storage_path = `${uuid(9)}/${profileId}/1600000000000-${uuid(5)}.jpg`; }, "unrecognized_source_path"],
  ["traversal source", f => { f.record.temporary_storage_path = `${prefix}../${uuid(5)}.jpg`; }, "unrecognized_source_path"],
  ["encoded source", f => { f.record.temporary_storage_path = `${prefix}%2f${uuid(5)}.jpg`; }, "unrecognized_source_path"],
  ["legacy arbitrary name", f => { f.record.temporary_storage_path = `${prefix}old.jpg`; }, "unrecognized_source_path"],
  ["recent source object", f => { f.files.get(key(tempBucket, temp)).lastModified = new Date(now).toISOString(); }, "storage_metadata_unconfirmed"],
  ["missing object version", f => { delete f.files.get(key(tempBucket, temp)).version; }, "storage_metadata_unconfirmed"],
  ["empty source bytes", f => { f.files.get(key(tempBucket, temp)).size = 0; }, "storage_metadata_unconfirmed"],
]) {
  test(`${label} retains all bytes: ${reason}`, async () => {
    const f = fixture(); change(f);
    const result = (await f.run()).results[0];
    assert.equal(result.status, "retained");
    assert.equal(result.reason, reason);
    assert.deepEqual(f.removals, []);
  });
}

for (const [table, row] of [
  ["image_moderation_records", { id: uuid(9), user_id: uuid(10), temporary_storage_path: temp, decision: "review" }],
  ["image_moderation_records", { id: uuid(9), final_storage_path: review, decision: "approved" }],
  ["dancer_photos", { id: uuid(9), storage_path: temp }],
  ["dancer_profiles", { id: uuid(9), avatar_storage_path: review }],
]) {
  test(`any remaining ${table} source reference blocks cleanup across owners and statuses`, async () => {
    const f = fixture(); f.tables[table].push(row);
    assert.equal((await f.run()).results[0].reason, "shared_source_reference");
    assert.deepEqual(f.removals, []);
  });
}

for (const bucket of [tempBucket, reviewBucket, "dancr-media-originals"]) {
  test(`unexpected public or unreadable ${bucket} fails closed`, async () => {
    const f = fixture(); f.publicBucket = bucket;
    await assert.rejects(f.run(), /Private storage configuration/);
    f.publicBucket = ""; f.missingBucket = bucket;
    await assert.rejects(f.run(), /no result/);
    assert.deepEqual(f.removals, []);
  });
}

for (const [bucket, path] of [["dancer-photos", published], ["dancr-media-originals", `dancer-photos/${published}`]]) {
  test(`missing ${bucket} replacement prevents deletion of its recovery copies`, async () => {
    const f = fixture(); f.files.delete(key(bucket, path));
    const report = await f.run();
    assert.equal(report.ok, false);
    assert.equal(report.results[0].reason, "verification_failed");
    assert.deepEqual(f.removals, []);
  });
}

test("missing private source is harmless, while storage or reference query failures remain failures", async () => {
  const f = fixture(); f.files.delete(key(tempBucket, temp));
  assert.equal((await f.run()).results[0].sourceCount, 1);
  f.failedObject = key(reviewBucket, review);
  assert.equal((await f.run()).ok, false);
  f.failedObject = ""; f.failedTable = "dancer_photos";
  const report = await f.run();
  assert.equal(report.ok, false);
  assert.doesNotMatch(JSON.stringify(report), /secret|provider URL/);
  assert.deepEqual(f.removals, []);
});

test("changed object identity or approval version invalidates an earlier dry-run fingerprint", async () => {
  for (const change of [f => { f.record.updated_at = "2020-01-02T00:00:00Z"; }, f => { f.files.get(key(tempBucket, temp)).version = "new-version"; }]) {
    const f = fixture(), token = (await f.run()).results[0].expectedPlan; change(f);
    const report = await f.apply(token);
    assert.equal(report.ok, false);
    assert.equal(report.results[0].reason, "plan_changed");
    assert.deepEqual(f.removals, []);
  }
});

test("a reference appearing during final verification prevents the first removal", async () => {
  const f = fixture(), token = (await f.run()).results[0].expectedPlan;
  let reads = 0;
  f.beforeRead = ({ table, single }) => {
    if (table === "image_moderation_records" && single && ++reads === 2) f.tables.dancer_photos.push({ id: uuid(9), storage_path: temp });
  };
  const report = await f.apply(token);
  assert.equal(report.results[0].reason, "shared_source_reference");
  assert.equal(report.ok, false);
  assert.deepEqual(f.removals, []);
});

test("a changed review between buckets stops the second removal and reports the acknowledged first", async () => {
  const f = fixture(), token = (await f.run()).results[0].expectedPlan;
  f.afterRemove = () => { f.record.updated_at = "2020-01-02T00:00:00Z"; };
  const report = await f.apply(token);
  assert.equal(report.results[0].reason, "plan_changed");
  assert.equal(report.results[0].confirmedRemoved, 1);
  assert.equal(report.ok, false);
  assert.ok(f.files.has(key(reviewBucket, review)));
});

for (const failure of ["before", "after"]) {
  test(`storage failure ${failure} deletion never claims success or blindly retries`, async () => {
    const f = fixture(), token = (await f.run()).results[0].expectedPlan;
    f.removeFailure = failure;
    const report = await f.apply(token);
    assert.equal(report.ok, false);
    assert.equal(report.results[0].status, "removal_unconfirmed");
    assert.equal(report.results[0].confirmedRemoved, 0);
    assert.equal(f.removals.length, 1);
    assert.ok(f.files.has(key(reviewBucket, review)));
    assert.doesNotMatch(JSON.stringify(report), /secret/);
  });
}

test("invalid programmatic bounds and applying a missing record fail without storage removal", async () => {
  const f = fixture();
  await assert.rejects(f.run({ limit: 100 }), /Invalid maintenance option/);
  const report = await f.run({ recordId: uuid(99), apply: true, expectedPlan: "a".repeat(64) });
  assert.equal(report.ok, false);
  assert.deepEqual(f.removals, []);
});
