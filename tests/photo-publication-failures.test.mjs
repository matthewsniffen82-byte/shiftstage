import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const requireTest = createRequire(import.meta.url);
const librarySource = readFileSync(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8");
const adminSource = readFileSync(new URL("../app/api/admin/image-moderation/route.ts", import.meta.url), "utf8");
const recenterSource = readFileSync(new URL("../app/api/admin/avatars/recenter/route.ts", import.meta.url), "utf8");
const oldPath = "user/dancer/old.jpg";
const newPath = "user/dancer/new.jpg";

function load(source, name, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(`${source}\nexports.testSubject = ${name};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Buffer, setTimeout, clearTimeout,
    console: { log() {}, info() {}, warn() {}, error() {} },
    require(name) {
      if (name in dependencies) return dependencies[name];
      if (name === "crypto") return requireTest(name);
      return {};
    },
  });
  return exports;
}

function harness({ avatar = false, primary = false, failure = "", concurrentAvatar = false } = {}) {
  const files = new Set([oldPath, newPath, "temporary"]);
  const archived = new Set([oldPath, newPath]);
  const tables = {
    dancer_profiles: [{ id: "dancer", user_id: "user", slug: "test-dancer", avatar_storage_path: avatar ? oldPath : null }],
    dancer_photos: avatar ? [] : [{ id: "old", dancer_id: "dancer", storage_path: oldPath, is_primary: primary, sort_order: primary ? 0 : 1, review_status: "approved" }],
    image_moderation_records: [{ id: "record", user_id: "user", temporary_storage_path: "temporary", upload_context: avatar ? "profile_avatar" : "profile_gallery:1", decision: "review", status: "moderating" }],
    admin_actions: [],
  };
  const events = [];
  let injected = false;
  const fault = new Error("Synthetic database failure");
  const client = {
    from(table) {
      let operation = "select", payload, columns = "*";
      const filters = [];
      const query = {
        select(value) { columns = value; return this; },
        insert(value) { operation = "insert"; payload = value; return this; },
        update(value) { operation = "update"; payload = value; return this; },
        delete() { operation = "delete"; return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        is(key, value) { filters.push(row => row[key] === value); return this; },
        neq(key, value) { filters.push(row => row[key] !== value); return this; },
        in(key, values) { filters.push(row => values.includes(row[key])); return this; },
        order() { return this; },
        limit() { return this; },
        single() { return execute(true); },
        maybeSingle() { return execute(true); },
        then(resolve, reject) { return execute(false).then(resolve, reject); },
      };
      async function execute(single) {
        events.push(`${table}:${operation}`);
        const approvalWrite = table === "image_moderation_records" && operation === "update" && payload.decision === "approved";
        const photoInsert = table === "dancer_photos" && operation === "insert";
        const avatarWrite = table === "dancer_profiles" && operation === "update" && payload.avatar_storage_path === newPath;
        const shouldFail = !injected && (
          (failure.startsWith("approval") && approvalWrite) ||
          (failure.startsWith("diagnostic") && table === "image_moderation_records" && operation === "select" && columns === "status") ||
          (failure === "insert_ack" && photoInsert) ||
          (failure === "avatar_ack" && avatarWrite) ||
          (failure === "retire" && table === "dancer_photos" && operation === "delete") ||
          (failure === "slot_read" && table === "dancer_photos" && operation === "select")
        );
        const afterCommit = ["approval_ack", "insert_ack", "avatar_ack"].includes(failure);
        if (shouldFail) injected = true;
        if (shouldFail && failure === "diagnostic_throw") throw fault;
        if (shouldFail && !afterCommit) {
          if (concurrentAvatar) {
            files.add("user/dancer/newer.jpg");
            tables.dancer_profiles[0].avatar_storage_path = "user/dancer/newer.jpg";
          }
          return { data: null, error: fault };
        }
        let rows = tables[table].filter(row => filters.every(filter => filter(row)));
        if (operation === "insert") {
          rows = [{ id: "new", ...payload }]; tables[table].push(...rows);
        } else if (operation === "update") rows.forEach(row => Object.assign(row, payload));
        else if (operation === "delete") tables[table] = tables[table].filter(row => !rows.includes(row));
        if (shouldFail) return { data: null, error: fault };
        const selected = rows.map(row => ({ ...row }));
        return { data: single ? selected[0] ?? null : selected, error: null };
      }
      return query;
    },
    storage: { from() { return {
      download: async () => ({ data: {}, error: null }),
      remove: async paths => { paths.forEach(path => files.delete(path)); return { error: null }; },
      getPublicUrl: path => ({ data: { publicUrl: `https://example.test/${path}` } }),
    }; } },
  };
  const responsive = {
    uploadResponsiveImage: async () => ({ storagePath: newPath, focalX: 50, focalY: 50 }),
    removeResponsiveImage: async (_client, _bucket, path) => { events.push(`remove:${path}`); files.delete(path); },
    responsiveImageStoragePaths: path => [path],
    responsivePublicImage: () => ({ imageUrl: "https://example.test/avatar.jpg" }),
  };
  const watermark = { removeArchivedOriginalMedia: async (_client, _bucket, path) => { archived.delete(path); } };
  const slots = {
    isProfileAvatarUploadContext: context => context === "profile_avatar",
    profilePhotoSlotFromUploadContext: () => ({ isPrimary: primary, sortOrder: primary ? 0 : 1 }),
  };
  const library = load(librarySource, "approveModeratedUpload", {
    "./responsive-image": responsive, "./media-watermark": watermark,
    "../security/safe-error-metadata": { safeErrorMetadata: () => ({ code: "synthetic" }) },
    "../api-error-policy": requireTest("../src/lib/api-error-policy.ts"),
  });
  const admin = load(adminSource, "approveReviewRecord", {
    "@/src/lib/dancr/image-moderation": library,
    "@/src/lib/dancr/responsive-image": responsive,
    "@/src/lib/dancr/media-watermark": watermark,
    "@/src/lib/dancr/photo-slot": slots,
    "@/src/lib/dancr/image-validation": { validateAndPrepareDancrImage: async () => ({}) },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({ code: "synthetic" }) },
  });
  const recenter = load(recenterSource, "POST", {
    "next/server": { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    "@/src/lib/api": { apiError: () => ({ status: 500 }), PublicApiError: Error },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: async () => ({ dancerSlug: "test-dancer" }) },
    "@/src/lib/dancr/admin": { requireAdmin: async () => {} },
    "@/src/lib/dancr/avatar-face": { prepareFaceCenteredAvatar: async image => image, isAvatarFaceRequiredError: () => false, isAvatarFaceDetectionUnavailableError: () => false },
    "@/src/lib/dancr/image-validation": { validateAndPrepareDancrImage: async () => ({ width: 100, height: 100 }) },
    "@/src/lib/dancr/image-moderation": library,
    "@/src/lib/dancr/responsive-image": responsive,
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => client },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => ({ client, user: { id: "reviewer" } }) },
    "@/src/lib/server-env": { getOptionalServerEnv: () => "s".repeat(32) },
  });
  return { files, archived, tables, events, fault,
    recenter: () => recenter.testSubject({ headers: { get: () => "s".repeat(32) } }),
    run: mode => mode === "admin"
      ? admin.testSubject(client, { ...tables.image_moderation_records[0] }, "reviewer", "")
      : library.testSubject(client, { recordId: "record", profileId: "dancer", userId: "user", image: {},
        tempPath: "temporary", uploadContext: avatar ? "profile_avatar" : "profile_gallery:1",
        isAvatar: avatar, isPrimary: primary, sortOrder: primary ? 0 : 1, altText: null,
        evaluation: { decision: "approved", reasonCodes: [], categoryScores: {}, providerFlagged: false }, categoryFlags: {},
      }),
    assertReferencedFilesExist() {
      for (const photo of tables.dancer_photos) assert.ok(files.has(photo.storage_path), `Missing published photo ${photo.id}`);
      for (const profile of tables.dancer_profiles) if (profile.avatar_storage_path) assert.ok(files.has(profile.avatar_storage_path), "Missing published avatar");
    },
  };
}

for (const mode of ["automatic", "admin"]) {
  for (const avatar of [false, true]) {
    const kind = avatar ? "avatar" : "photo";
    test(`${mode} ${kind}: successful approval retires the old file only after saving approval`, async () => {
      const state = harness({ avatar });
      await state.run(mode);
      state.assertReferencedFilesExist();
      assert.equal(state.files.has(oldPath), false);
      assert.equal(state.tables.image_moderation_records[0].decision, "approved");
    });
    for (const failure of ["approval", "approval_ack", avatar ? "avatar_ack" : "insert_ack"]) {
      test(`${mode} ${kind}: ${failure} preserves published files and the previous original`, async () => {
        const state = harness({ avatar, failure });
        await assert.rejects(state.run(mode), error => error === state.fault);
        state.assertReferencedFilesExist();
        assert.ok(state.files.has(oldPath), "Old image must survive incomplete approval");
        assert.ok(state.files.has(newPath), "Uncertain publication must not trigger storage deletion");
        assert.ok(state.archived.has(oldPath));
        if (failure === "approval_ack") assert.equal(state.tables.image_moderation_records[0].decision, "approved", "A lost response must not reverse a committed approval");
      });
    }
  }
  test(`${mode}: failed approval must not roll back a newer concurrent avatar`, async () => {
    const state = harness({ avatar: true, failure: "approval", concurrentAvatar: true });
    await assert.rejects(state.run(mode));
    assert.equal(state.tables.dancer_profiles[0].avatar_storage_path, "user/dancer/newer.jpg");
    state.assertReferencedFilesExist();
  });
  test(`${mode}: failed old-row removal retains both usable photos`, async () => {
    const state = harness({ failure: "retire" });
    await state.run(mode);
    state.assertReferencedFilesExist();
    assert.equal(state.tables.dancer_photos.length, 2);
    assert.ok(state.files.has(oldPath));
  });
  test(`${mode}: pre-publication read failure preserves the previous live photo`, async () => {
    const state = harness({ failure: "slot_read" });
    await assert.rejects(state.run(mode));
    state.assertReferencedFilesExist();
    assert.ok(state.files.has(oldPath));
  });
  test(`${mode}: legacy primary replacement retains both photos if approval fails`, async () => {
    const state = harness({ primary: true, failure: "approval" });
    await assert.rejects(state.run(mode));
    assert.equal(state.tables.dancer_photos.length, 2);
    assert.ok(state.files.has(oldPath));
    state.assertReferencedFilesExist();
  });
}

for (const avatar of [false, true]) {
  for (const failure of ["diagnostic", "diagnostic_throw"]) {
    test(`${failure} cannot reverse a committed ${avatar ? "avatar" : "photo"} approval`, async () => {
      const state = harness({ avatar, failure });
      const result = await state.run("automatic");
      assert.equal(result.decision, "approved");
      assert.equal(state.tables.image_moderation_records[0].decision, "approved");
      state.assertReferencedFilesExist();
    });
  }
}

test("avatar recentering preserves a committed image after a lost update acknowledgement", async () => {
  const state = harness({ avatar: true, failure: "avatar_ack" });
  const response = await state.recenter();
  assert.equal(response.status, 500);
  state.assertReferencedFilesExist();
  assert.ok(state.files.has(oldPath));
  assert.ok(state.files.has(newPath));
});

test("successful avatar recentering retains its audit and removes only the previous file", async () => {
  const state = harness({ avatar: true });
  const response = await state.recenter();
  assert.equal(response.status, 200);
  assert.equal(state.tables.admin_actions.length, 1);
  assert.equal(state.files.has(oldPath), false);
  state.assertReferencedFilesExist();
});
