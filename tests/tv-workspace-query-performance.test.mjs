import assert from "node:assert/strict";
import test from "node:test";
import { tvWorkspace, workspaceFixture } from "./helpers/tv-workspace-fixture.mjs";

test("owner video workspace batches signing and preserves query scope, order and metrics", async () => {
  const f = workspaceFixture(50);
  const workspace = await tvWorkspace.getDancerMyDancrTvWorkspace(f.client, "owner");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].paths.length, 50);
  assert.equal(f.calls[0].bucket, "mydancr-tv-videos");
  assert.equal(f.calls[0].expiresIn, 3600);
  assert.deepEqual(Array.from(workspace.videos, video => video.id), f.rows.map(row => row.id));
  workspace.videos.forEach((video, index) => assert.ok(video.videoUrl.endsWith(f.rows[index].storage_path)));
  assert.equal(workspace.videos[0].metrics.impression, 1);
  assert.equal(workspace.remainingVideoSlots, 0);
  assert.ok(f.queries[0].operations.some(([method, field, value]) => method === "eq" && field === "user_id" && value === "owner"));
  assert.ok(f.queries[1].operations.some(([method, field, value]) => method === "eq" && field === "dancer_id" && value === "dancer"));
  assert.ok(f.queries[1].operations.some(([method, field, value]) => method === "eq" && field === "distribution_scope" && value === "profile_and_feed"));
});

test("admin review queue signs 100 authorized rows in one request and retains status/limit", async () => {
  const f = workspaceFixture(100);
  const videos = await tvWorkspace.getAdminMyDancrTvVideos(f.client, "unexpected");
  assert.equal(videos.length, 100);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].paths.length, 100);
  assert.ok(f.queries[0].operations.some(([method, field, value]) => method === "eq" && field === "status" && value === "submitted"));
  assert.ok(f.queries[0].operations.some(([method, value]) => method === "limit" && value === 100));
});

test("failed paths remain unavailable without changing other rows or borrowing another URL", async () => {
  const f = workspaceFixture(3, { failedPaths: ["owner/dancer/video-1.mp4"] });
  const videos = await tvWorkspace.getAdminMyDancrTvVideos(f.client);
  assert.ok(videos[0].videoUrl.endsWith("video-0.mp4"));
  assert.equal(videos[1].videoUrl, "");
  assert.ok(videos[2].videoUrl.endsWith("video-2.mp4"));
  const failed = workspaceFixture(3, { storageError: true });
  assert.ok((await tvWorkspace.getAdminMyDancrTvVideos(failed.client)).every(video => video.videoUrl === ""));
});

test("empty or rejected owner queries never sign media", async () => {
  const empty = workspaceFixture(0);
  assert.equal((await tvWorkspace.getDancerMyDancrTvWorkspace(empty.client, "owner")).videos.length, 0);
  assert.equal(empty.calls.length, 0);
  for (const options of [{ missingDancer: true }, { queryError: "dancer_profiles" }, { queryError: "mydancr_tv_videos" }]) {
    const f = workspaceFixture(2, options);
    await assert.rejects(tvWorkspace.getDancerMyDancrTvWorkspace(f.client, "owner"));
    assert.equal(f.calls.length, 0);
  }
});

test("historical rows use bounded batches and duplicate paths are signed once", async () => {
  const f = workspaceFixture(251);
  f.rows[250].storage_path = f.rows[0].storage_path;
  const result = await tvWorkspace.getDancerMyDancrTvWorkspace(f.client, "owner");
  assert.deepEqual(f.calls.map(call => call.paths.length), [100, 100, 50]);
  assert.equal(result.videos.length, 251);
  assert.equal(result.videos[250].videoUrl, result.videos[0].videoUrl);
});

test("signing and analytics begin independently after the owner video query", async () => {
  let release;
  const metricsGate = new Promise(resolve => { release = resolve; });
  const f = workspaceFixture(2, { metricsGate });
  const pending = tvWorkspace.getDancerMyDancrTvWorkspace(f.client, "owner");
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 1);
  } finally { release(); }
  assert.equal((await pending).videos[0].metrics.impression, 1);
});
