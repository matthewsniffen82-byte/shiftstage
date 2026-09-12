import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { videoWorkerHarness, workerInstant, workerVideoId, workerUserId, workerVideoPath } from "./helpers/video-worker-database.mjs";

for (const queued of [true, false]) test(`the installed SDK encodes the ${queued ? "queued" : "stale"} worker claim and final ownership filters`, async () => {
  let row = {
    id: workerVideoId, submitted_by: workerUserId, storage_path: workerVideoPath, storage_mime: "video/mp4",
    caption: "Synthetic", duration_seconds: 10, width: 720, height: 1280, status: "moderating",
    submitted_at: new Date(workerInstant - 3600000).toISOString(),
    moderation_attempt_count: queued ? 0 : 1,
    moderation_started_at: new Date(workerInstant - (queued ? 0 : 3600000)).toISOString(),
    moderation_details: queued ? {} : { workerId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
    updated_at: new Date(workerInstant - 3600000).toISOString(), dancer_profiles: { avatar_storage_path: "synthetic-avatar" },
  };
  const requests = []; let workerId;
  const client = createClient("https://synthetic.invalid", "sb_publishable_synthetic_worker_query", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { async fetch(input, init) {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(url.origin, "https://synthetic.invalid"); assert.equal(url.pathname, "/rest/v1/mydancr_tv_videos");
      const method = init.method;
      requests.push({ method, query: url.searchParams });
      assert.equal(url.searchParams.get("id"), "eq." + row.id);
      assert.equal(url.searchParams.get("status"), "eq.moderating");
      if (requests.length === 1) {
        assert.equal(method, "GET"); assert.match(url.searchParams.get("select"), /updated_at/);
        assert.match(url.searchParams.get("select"), /moderation_details/);
        return Response.json([row]);
      }
      assert.equal(url.searchParams.get("updated_at"), "eq." + row.updated_at);
      assert.equal(url.searchParams.get("moderation_attempt_count"), "eq." + row.moderation_attempt_count);
      assert.equal(url.searchParams.get("moderation_started_at"), "eq." + row.moderation_started_at);
      assert.equal(url.searchParams.get("moderation_details->>workerId"), row.moderation_details.workerId ? "eq." + row.moderation_details.workerId : "is.null");
      for (const field of ["submitted_by", "storage_path", "storage_mime", "caption", "duration_seconds", "width", "height"]) {
        assert.equal(url.searchParams.get(field), "eq." + row[field]);
      }
      if (method === "GET") {
        assert.equal(url.searchParams.get("select"), "id"); return Response.json([{ id: row.id }]);
      }
      assert.equal(method, "PATCH");
      const update = JSON.parse(init.body);
      if (requests.length === 2) {
        workerId = update.moderation_details.workerId;
        assert.match(workerId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
        assert.notEqual(workerId, row.moderation_details.workerId);
        assert.equal(update.moderation_attempt_count, row.moderation_attempt_count + 1);
      } else {
        assert.equal(requests.length, 4); assert.equal(update.status, "approved");
        assert.equal(url.searchParams.get("moderation_details->>workerId"), "eq." + workerId);
      }
      row = { ...row, ...update, updated_at: new Date(Date.parse(row.updated_at) + 1).toISOString() };
      return Response.json(row);
    } },
  });
  const h = videoWorkerHarness(null, { client });
  assert.equal((await h.retry()).status, "approved");
  assert.deepEqual(requests.map(request => request.method), ["GET", "PATCH", "GET", "PATCH"]);
  assert.equal(h.providers.length, 1); assert.equal(h.watermarks.length, 1);
});
