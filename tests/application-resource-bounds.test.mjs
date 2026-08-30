import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicData = readFileSync(
  new URL("../src/lib/dancr/public.ts", import.meta.url),
  "utf8",
);
const moderationRoute = readFileSync(
  new URL("../app/api/admin/image-moderation/route.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../supabase/migrations/202608300005_bound_public_metric_aggregation.sql", import.meta.url),
  "utf8",
);

test("public discovery aggregates metrics without unbounded application paging", () => {
  assert.doesNotMatch(publicData, /fetchAllMetricRows/);
  assert.doesNotMatch(publicData, /for \(let from = 0; ; from \+= pageSize\)/);
  assert.match(publicData, /\.rpc\("get_public_dancer_metric_counts"/);
  assert.match(publicData, /\.rpc\("get_public_venue_metric_counts"/);
  assert.match(publicData, /Number\.isSafeInteger\(count\) && count >= 0/);
});

test("metric aggregates are indexed and callable only by the trusted server role", () => {
  assert.match(migration, /create index if not exists follows_dancer_idx[\s\S]*?public\.follows \(dancer_id\)/i);
  assert.match(migration, /create index if not exists venue_follows_venue_idx[\s\S]*?public\.venue_follows \(venue_id\)/i);
  assert.match(migration, /create index if not exists direction_requests_venue_requested_idx[\s\S]*?venue_id, requested_at desc/i);
  assert.match(migration, /get_public_dancer_metric_counts[\s\S]*?returns table\(metric text, entity_id uuid, total bigint\)/i);
  assert.match(migration, /get_public_venue_metric_counts[\s\S]*?returns table\(metric text, entity_id uuid, total bigint\)/i);
  assert.match(migration, /revoke execute[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute[\s\S]*?to service_role/i);
});

test("image moderation offsets have a finite server-side bound", () => {
  assert.match(moderationRoute, /const MAX_IMAGE_REVIEW_PAGE = 1_000/);
  assert.match(
    moderationRoute,
    /const page = Math\.min\([\s\S]*?MAX_IMAGE_REVIEW_PAGE,[\s\S]*?Math\.max\(0,/,
  );
});
