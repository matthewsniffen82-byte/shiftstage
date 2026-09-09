import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkStorageBucketSecurity, STORAGE_BUCKET_REQUIREMENTS } from "../src/lib/security/storage-bucket-policy.mjs";

const buckets = JSON.parse(readFileSync(new URL("../docs/supabase-reliability/step-01-inventory.json", import.meta.url), "utf8")).catalog.buckets;
const safe = value => checkStorageBucketSecurity(value).every(check => check.ok);

test("storage readiness accepts the audited configuration and stronger restrictions", () => {
  assert.equal(safe(buckets), true);
  assert.equal(safe(buckets.map(bucket => ({ ...bucket, public: false, file_size_limit: 1024, allowed_mime_types: bucket.allowed_mime_types.slice(0, 1) }))), true);
});

for (const expected of STORAGE_BUCKET_REQUIREMENTS.filter(b => b.private)) {
  test(`storage readiness fails if ${expected.id} becomes public`, () => {
    assert.equal(safe(buckets.map(b => b.id === expected.id ? { ...b, public: true } : b)), false);
  });
}

test("storage readiness rejects missing, ambiguous or malformed provider metadata", () => {
  for (const input of [undefined, null, {}, [], buckets.slice(1), [...buckets, buckets[0]], [...buckets, { id: "unreviewed", public: true }]]) assert.equal(safe(input), false);
  for (const publicValue of [undefined, null, "false", 0]) assert.equal(safe(buckets.map(b => ({ ...b, public: publicValue }))), false);
});

test("storage readiness rejects unbounded sizes and unsafe content-type expansion", () => {
  for (const limit of [null, 0, -1, "10485760", Infinity, 80 * 1024 * 1024]) {
    assert.equal(safe(buckets.map(b => ({ ...b, file_size_limit: limit }))), false);
  }
  for (const types of [null, [], ["*"], ["image/*"], ["image/svg+xml"], ["text/html"], ["application/octet-stream"]]) {
    assert.equal(safe(buckets.map(b => ({ ...b, allowed_mime_types: types }))), false);
  }
});

test("storage readiness output cannot disclose object paths or arbitrary provider data", () => {
  const result = checkStorageBucketSecurity(buckets.map(b => ({ ...b, private_notes: "fixture-private-value", name: "untrusted\nlog" })));
  assert.ok(result.every(r => Object.keys(r).join(",") === "name,ok"));
  assert.doesNotMatch(JSON.stringify(result), /fixture-private-value|untrusted/);
});
