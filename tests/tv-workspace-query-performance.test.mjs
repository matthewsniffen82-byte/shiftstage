import assert from "node:assert/strict";
import test from "node:test";
import { tvWorkspace, workspaceFixture } from "./helpers/tv-workspace-fixture.mjs";

test("owner video workspace creates revocable URLs and preserves query scope, order and metrics", async () => {
  const f = workspaceFixture(50);
  const workspace = await tvWorkspace.getDancerMyDancrTvWorkspace(f.client, "owner");
  assert.equal(f.calls.length, 0);
  assert.deepEqual(Array.from(workspace.videos, video => video.id), f.rows.map(row => row.id));
  workspace.videos.forEach((video, index) => assert.ok(new URL(video.videoUrl).searchParams.get("id") === f.rows[index].id));
  assert.equal(workspace.videos[0].metrics.impression, 1);
  assert.equal(workspace.remainingVideoSlots, 0);
  assert.ok(f.queries[0].operations.some(([method, field, value]) => method === "eq" && field === "user_id" && value === "owner"));
  assert.ok(f.queries[1].operations.some(([method, field, value]) => method === "eq" && field === "dancer_id" && value === "dancer"));
  assert.ok(f.queries[1].operations.some(([method, field, value]) => method === "eq" && field === "distribution_scope" && value === "profile_and_feed"));
});

test("admin review queue prepares 100 authorized rows without a Storage token and retains status/limit", async () => {
  const f = workspaceFixture(100);
  const videos = await tvWorkspace.getAdminMyDancrTvVideos(f.client, "unexpected");
  assert.equal(videos.length, 100);
  assert.equal(f.calls.length, 0);
  assert.ok(f.queries[0].operations.some(([method, field, value]) => method === "eq" && field === "status" && value === "submitted"));
  assert.ok(f.queries[0].operations.some(([method, value]) => method === "limit" && value === 100));
});

test("workspace URLs remain bound to each authorized record and expose no storage paths", async () => {
  const f = workspaceFixture(3);
  const videos = await tvWorkspace.getAdminMyDancrTvVideos(f.client);
  for (let n = 0; n < videos.length; n++) {
    assert.equal(new URL(videos[n].videoUrl).searchParams.get('id'), f.rows[n].id);
    assert.ok(!videos[n].videoUrl.includes(f.rows[n].storage_path));
  }
  assert.equal(f.calls.length, 0);
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

test("historical rows remain isolated by record ID even when storage paths repeat", async () => {
  const f = workspaceFixture(251);
  f.rows[250].storage_path = f.rows[0].storage_path;
  const result = await tvWorkspace.getDancerMyDancrTvWorkspace(f.client, "owner");
  assert.equal(f.calls.length, 0);
  assert.equal(result.videos.length, 251);
  assert.notEqual(result.videos[250].videoUrl, result.videos[0].videoUrl);
});

test("playback URL preparation does not wait on Storage while analytics loads", async () => {
  let release;
  const metricsGate = new Promise(resolve => { release = resolve; });
  const f = workspaceFixture(2, { metricsGate });
  const pending = tvWorkspace.getDancerMyDancrTvWorkspace(f.client, "owner");
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 0);
  } finally { release(); }
  assert.equal((await pending).videos[0].metrics.impression, 1);
});
