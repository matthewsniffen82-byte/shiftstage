import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const load = (path, require = () => ({})) => {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require, Error });
  return exports;
};
const { pinOwnDancerMedia } = load("src/lib/dancr/media-pins.ts");
const ownId = "11111111-1111-4111-8111-111111111111";
const foreignId = "22222222-2222-4222-8222-222222222222";

function database() {
  const tables = {
    dancer_profiles: [{ id: "dancer-a", user_id: "user-a" }, { id: "dancer-b", user_id: "user-b" }],
    dancer_photos: [
      { id: ownId, dancer_id: "dancer-a", review_status: "approved", is_pinned: false, is_primary: true, sort_order: 0 },
      { id: foreignId, dancer_id: "dancer-b", review_status: "approved", is_pinned: false },
    ],
    mydancr_tv_videos: [
      { id: ownId, dancer_id: "dancer-a", status: "approved", distribution_scope: "profile_and_feed", is_pinned: false },
      { id: foreignId, dancer_id: "dancer-b", status: "approved", distribution_scope: "profile_and_feed", is_pinned: false },
    ],
  };
  const client = { from(table) {
    let update;
    const filters = [];
    const query = {
      select() { return query; },
      update(value) { update = value; return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      async maybeSingle() {
        const row = tables[table].find(candidate => filters.every(([key, value]) => candidate[key] === value));
        if (row && update) Object.assign(row, update);
        return { data: row || null, error: null };
      },
    };
    return query;
  } };
  return { client, tables };
}

for (const mediaType of ["photo", "video"]) {
  test(`${mediaType} pins persist idempotently and unpin without changing media or another dancer`, async () => {
    const { client, tables } = database();
    const table = mediaType === "photo" ? "dancer_photos" : "mydancr_tv_videos";
    const before = { ...tables[table][0] };
    const input = { mediaType, mediaId: ownId, pinned: true };
    await pinOwnDancerMedia(client, "user-a", input);
    await pinOwnDancerMedia(client, "user-a", input);
    assert.equal(tables[table][0].is_pinned, true);
    assert.equal(tables[table][1].is_pinned, false);
    await pinOwnDancerMedia(client, "user-a", { ...input, pinned: false });
    assert.deepEqual(tables[table][0], before);
    await assert.rejects(pinOwnDancerMedia(client, "user-a", { ...input, mediaId: foreignId }), /Approved media not found/);
    assert.equal(tables[table][1].is_pinned, false);
    await assert.rejects(pinOwnDancerMedia(client, "non-dancer", input), /Dancer profile required/);
  });
  test(`${mediaType} pins cannot change moderation or make unapproved media public`, async () => {
    const { client, tables } = database();
    const table = mediaType === "photo" ? "dancer_photos" : "mydancr_tv_videos";
    const status = mediaType === "photo" ? "review_status" : "status";
    for (const value of ["pending", "rejected", "hidden"]) {
      tables[table][0][status] = value;
      await assert.rejects(pinOwnDancerMedia(client, "user-a", { mediaType, mediaId: ownId, pinned: true }), /Approved media not found/);
      assert.equal(tables[table][0].is_pinned, false);
    }
  });
}

test("a dancer cannot pin a feed-only video into their profile", async () => {
  const { client, tables } = database();
  tables.mydancr_tv_videos[0].distribution_scope = "feed_only";
  await assert.rejects(pinOwnDancerMedia(client, "user-a", { mediaType: "video", mediaId: ownId, pinned: true }), /Approved media not found/);
});

test("public video pin ordering is applied only to a dancer gallery before its limit", () => {
  const source = readFileSync(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8");
  const part = source.slice(source.indexOf("  const profileOrdered ="), source.indexOf("  const activeVenueIds ="));
  const videos = [
    { id: "new", isPinned: false, publishedAt: "2026-09-07" },
    { id: "old-pin", isPinned: true, publishedAt: "2026-09-01" },
    { id: "new-pin", isPinned: true, publishedAt: "2026-09-05" },
  ];
  const order = (dancerId, selectedVideoId = "") => vm.runInNewContext(`${part}\ndeduped.map(video => video.id)`, {
    venuePrioritized: videos, options: { dancerId, limit: 2 }, selectedVideoId, MYDANCR_TV_PROFILE_VIDEO_LIMIT: 50,
  }).join(",");
  assert.equal(order("dancer"), "new-pin,old-pin");
  assert.equal(order(undefined), "new,old-pin");
  assert.equal(order("dancer", "new"), "new,new-pin");
  videos[1].isPinned = false; videos[2].isPinned = false;
  assert.equal(order("dancer"), "new,new-pin");
});

test("public photo pins precede legacy slot ordering without bypassing moderation", () => {
  const source = readFileSync(new URL("../src/lib/dancr/public.ts", import.meta.url), "utf8");
  const part = source.slice(source.indexOf("function approvedDancerPhotoSources"), source.indexOf("function toDancerPhotoUrl"));
  const compiled = ts.transpileModule(part, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({ responsivePublicImage: (_db, _bucket, path) => ({ imageUrl: path }), safeMetricCount: Number });
  vm.runInContext(compiled, context);
  const rows = [
    { id: "primary", storage_path: "first", is_primary: true, sort_order: 0, review_status: "approved" },
    { id: "pin", storage_path: "second", is_pinned: true, sort_order: 2, review_status: "approved" },
    { id: "rejected", storage_path: "hidden", is_pinned: true, sort_order: 1, review_status: "rejected" },
  ];
  assert.equal(context.approvedDancerPhotoSources({}, { dancer_photos: rows }).map(photo => photo.id).join(","), "pin,primary");
  rows[1].is_pinned = false;
  assert.equal(context.approvedDancerPhotoSources({}, { dancer_photos: rows }).map(photo => photo.id).join(","), "primary,pin");
});

test("pin API validates the media kind, ID, and explicit boolean before writing", async () => {
  let writes = 0;
  const route = load("app/api/dancer/media/pin/route.ts", name => {
    if (name === "next/server") return { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } };
    if (name.endsWith("/api")) return { apiError: () => ({ status: 400 }) };
    if (name.endsWith("bounded-json-body")) return { readBoundedJsonObject: request => request.json() };
    if (name.endsWith("media-pins")) return { pinOwnDancerMedia: (_db, _user, input) => { writes++; return { id: input.mediaId, isPinned: input.pinned }; } };
    if (name.endsWith("supabase/admin")) return { createAdminSupabaseClient: () => ({}) };
    if (name.endsWith("supabase/request")) return { createRequestSupabaseContext: () => ({ user: { id: "user-a" } }) };
    throw new Error(name);
  });
  for (const body of [{}, { mediaType: "avatar", mediaId: ownId, pinned: true }, { mediaType: "photo", mediaId: "bad", pinned: true }, { mediaType: "video", mediaId: ownId, pinned: "false" }]) {
    assert.equal((await route.PATCH({ json: async () => body })).status, 400);
  }
  assert.equal(writes, 0);
  assert.equal((await route.PATCH({ json: async () => ({ mediaType: "photo", mediaId: ownId, pinned: false }) })).status, 200);
  assert.equal(writes, 1);
});
