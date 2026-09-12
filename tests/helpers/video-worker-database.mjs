import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError } from "../../src/lib/api-error-policy.ts";
import { createSlotDatabase, addSlots, slotSchema, slotId } from "./profile-video-slot-database.mjs";
import { demoVideoAutoApprovalValues } from "../../src/lib/dancr/video-moderation-mode.ts";

export const workerVideoId = slotId(100);
export const workerUserId = slotId(1);
export const workerVideoPath = `${workerUserId}/${workerUserId}/${workerVideoId}.mp4`;
export const workerInstant = Date.parse("2026-09-12T12:00:00.000Z");
const columns = new Set(slotSchema.columns.map(column => column.column_name));
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const source = process.env.VIDEO_WORKER_BASELINE === "1"
  ? execFileSync("git", ["show", "8e01369bda91831d0f3952062082b21f67899a0d:src/lib/dancr/tv.ts"], { encoding: "utf8", windowsHide: true })
  : readFileSync(new URL("../../src/lib/dancr/tv.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const lifecycleSource = readFileSync(new URL("../../supabase/migrations/20260912140704_preserve_owned_dmca_lifecycle_states.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const ownershipSchema = lifecycleSource.slice(lifecycleSource.indexOf("create table public.dmca_enforcement_states"), lifecycleSource.indexOf("create trigger invalidate_dmca_account_enforcement"));
const ownershipTrigger = lifecycleSource.match(/create trigger invalidate_dmca_video_enforcement[\s\S]*?for each row execute function public\.invalidate_dmca_enforcement_state\(\);/)?.[0];
assert.ok(ownershipSchema.startsWith("create table public.dmca_enforcement_states"));
assert.ok(ownershipTrigger);
export async function createWorkerDatabase() {
  const db = await createSlotDatabase();
  try { await db.exec(ownershipSchema + ownershipTrigger); return db; }
  catch (error) { await db.close(); throw error; }
}
export async function seedWorker(db, overrides = {}) {
  // Include the real ownership table in TRUNCATE because it references app_users.
  await db.exec("reset role;truncate public.dmca_enforcement_states,public.mydancr_tv_videos,public.shifts,public.dancer_profiles,public.venues,public.app_users,public.notifications,public.admin_actions");
  await db.query("insert into public.app_users values($1),($2)", [slotId(1), slotId(2)]);
  await db.query("insert into public.dancer_profiles values($1),($2)", [slotId(1), slotId(2)]);
  await db.query("insert into public.venues values($1)", [slotId(3)]);
  await db.query("insert into public.shifts values($1,$2,$3,'club_confirmed')", [slotId(4), slotId(1), slotId(3)]);
  await db.exec("set role service_role");
  await addSlots(db, { status: "moderating" });
  const values = {
    storage_path: workerVideoPath, moderation_attempt_count: 0,
    moderation_started_at: new Date(workerInstant).toISOString(), moderation_details: {},
    submitted_at: new Date(workerInstant).toISOString(), moderation_reason_codes: [], ...overrides,
  };
  await patchWorker(db, values);
  await db.query("insert into public.dmca_enforcement_states(target_type,target_id,uploader_id,previous_state,applied_state) values('tv_video',$1,$2,'{}','{}')", [workerVideoId, workerUserId]);
}
export async function patchWorker(db, values) {
  for (const key of Object.keys(values)) assert.ok(columns.has(key), key);
  await db.query(`update public.mydancr_tv_videos v set ${Object.keys(values).map(key => `${quote(key)}=p.${quote(key)}`).join(",")}
    from jsonb_populate_record(null::public.mydancr_tv_videos,$1::jsonb) p where v.id=$2`, [JSON.stringify(values), workerVideoId]);
}
export async function workerSnapshot(db) {
  const row = (await db.query("select to_jsonb(v) record from public.mydancr_tv_videos v where id=$1", [workerVideoId])).rows[0]?.record;
  const notifications = (await db.query("select count(*)::int n from public.notifications")).rows[0].n;
  const enforcement = (await db.query("select to_jsonb(e) record from public.dmca_enforcement_states e where target_type='tv_video' and target_id=$1", [workerVideoId])).rows[0]?.record;
  return { row, notifications, enforcement };
}
export const workerDecision = (decision = "approved") => ({
  decision, reasonCodes: [], categoryScores: {}, providerFlagged: false,
  frameCount: 1, moderationModel: "synthetic-worker-only", details: { synthetic: true },
});
export const captureWorker = pending => pending.then(value => ({ value }), error => ({ error }));

export function videoWorkerHarness(db, options = {}) {
  let instant = workerInstant, releaseReads, released = false;
  const readBarrier = new Promise(resolve => { releaseReads = resolve; });
  const calls = [], providers = [], watermarks = [], pending = [];
  let reads = 0, claimAttempts = 0;
  class ControlledDate extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  const profile = { id: workerUserId, stage_name: "Synthetic", city: "Las Vegas", status: "approved", verification_status: "approved",
    photo_review_status: "approved", approved_at: new Date(workerInstant - 86400000).toISOString(), disabled_at: null,
    venue_approved_at: new Date(workerInstant - 86400000).toISOString(), is_public: true, avatar_storage_path: "synthetic-avatar" };
  const client = options.client || {
    from(table) {
      assert.equal(table, "mydancr_tv_videos");
      const filters = []; let update = null, selection = "*";
      const query = {
        select(value) { selection = value; return query; },
        update(value) { update = structuredClone(value); return query; },
        eq(key, value) { filters.push([key, "=", value]); return query; },
        is(key, value) { assert.equal(value, null); filters.push([key, "is null", null]); return query; },
        lt(key, value) { filters.push([key, "<", value]); return query; },
        lte(key, value) { filters.push([key, "<=", value]); return query; },
        maybeSingle: () => execute(false), single: () => execute(true),
        then(resolve, reject) { return execute(false).then(resolve, reject); },
      };
      function columnExpression(key) {
        if (key === "moderation_details->>workerId") return "v.moderation_details->>'workerId'";
        assert.ok(columns.has(key), "Unsupported native fixture column: " + key);
        return "v." + quote(key);
      }
      async function execute(requireOne) {
        const parameters = update ? [JSON.stringify(update)] : [];
        const where = filters.map(([key, operator, value]) => {
          const name = columnExpression(key);
          if (operator === "is null") return `${name} is null`;
          parameters.push(value); return `${name} ${operator} $${parameters.length}`;
        }).join(" and ");
        assert.ok(where);
        let sql;
        if (update) {
          for (const key of Object.keys(update)) assert.ok(columns.has(key), key);
          sql = `with changed as (update public.mydancr_tv_videos v set ${Object.keys(update).map(key => `${quote(key)}=p.${quote(key)}`).join(",")}
            from jsonb_populate_record(null::public.mydancr_tv_videos,$1::jsonb) p where ${where} returning v.*)
            select to_jsonb(changed) record from changed`;
        } else sql = `select to_jsonb(v) record from public.mydancr_tv_videos v where ${where}`;
        const mutationKind = update && update.status !== "approved" && update.status !== "rejected" && update.status !== "submitted"
          ? "claim" : update ? "result" : "read";
        calls.push({ kind: mutationKind, filters: structuredClone(filters), update });
        if (update && options.writeError) return { data: null, error: options.writeError };
        const result = await db.query(sql, parameters);
        let row = result.rows[0]?.record || null;
        // Preserve PostgreSQL timestamp precision through JSON, as PostgREST does.
        if (row && selection !== "*") {
          const selected = {};
          for (const key of selection.replace(/dancer_profiles\([^)]*\)/g, "").split(",").map(key => key.trim()).filter(Boolean)) {
            assert.ok(columns.has(key), "Unsupported native fixture selection: " + key); selected[key] = row[key];
          }
          if (selection.includes("dancer_profiles(")) selected.dancer_profiles = profile;
          row = selected;
        }
        if (!update && options.synchronizeInitialReads && reads < options.synchronizeInitialReads) {
          reads++; if (reads === options.synchronizeInitialReads) releaseReads(); await readBarrier;
        }
        if (mutationKind === "claim") {
          claimAttempts++;
          if (row && options.claimReceipt) row = options.claimReceipt(structuredClone(row));
        }
        if (requireOne && !row) return { data: null, error: { code: "PGRST116", message: "Synthetic missing row" } };
        return { data: row, error: null };
      }
      return query;
    },
    storage: { from(bucket) {
      assert.equal(bucket, "mydancr-tv-videos");
      return { async list() { return { data: [{ name: workerVideoId + ".mp4", metadata: { size: 1024, mimetype: "video/mp4" } }], error: null }; },
        async remove() { assert.fail("Worker uncertainty must not delete stored files"); } };
    } },
  };
  const tv = {};
  vm.runInNewContext(compiled, { exports: tv, Error, Date: ControlledDate, crypto: webcrypto, console: { info() {}, warn() {}, error() {} },
    require(name) {
      if (name === "../api-error-policy") return { PublicApiError };
      if (name === "./video-moderation") return { async moderateStoredMyDancrTvVideo(_client, input) {
        providers.push(input);
        if (!options.holdProviders || released) {
          if (options.providerError) throw options.providerError;
          return workerDecision(options.decision);
        }
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      } };
      if (name === "./video-moderation-mode") return { isVideoDemoAutoApproveMode: () => options.demo === true, demoVideoAutoApprovalValues };
      if (name === "./media-watermark") return { async watermarkStoredVideo(_client, input) {
        watermarks.push(input); await options.beforeWatermarkReturns?.(); return { posterStoragePath: "synthetic-poster" };
      } };
      if (name === "./media-identity") return { DancerIdentityReferenceRequiredError: class extends Error {}, isDancerIdentityReferenceRequiredError: error => error?.identityMissing === true };
      if (name === "./video-upload-validation") return { async inspectStoredMyDancrTvVideo() { return { durationSeconds: 10, fileSizeBytes: 1024, width: 720, height: 1280 }; } };
      if (name === "../security/safe-error-metadata") return { safeErrorMetadata: () => ({ code: "SYNTHETIC" }) };
      if (name === "./media-limits") return { MAX_DANCER_PROFILE_VIDEOS: 50 };
      return {};
    },
  });
  return { calls, providers, watermarks, client,
    advance(milliseconds) { instant += milliseconds; },
    retry: () => tv.retryMyDancrTvAutomatedModeration(client, workerVideoId),
    submit: (deferModeration = false) => tv.submitMyDancrTvUpload(client, workerUserId, workerVideoId, { deferModeration }),
    retrySubmitted: () => tv.retrySubmittedMyDancrTvAutomatedModeration(client, slotId(2), workerVideoId),
    demoPending: () => tv.autoApprovePendingMyDancrTvDemoVideo(client, workerVideoId),
    finish(index, outcome = workerDecision()) { const job = pending[index]; assert.ok(job); if (outcome instanceof Error) job.reject(outcome); else job.resolve(outcome); },
    releaseAll() { released = true; for (const job of pending) job.resolve(workerDecision()); },
    async waitFor(predicate) {
      const until = performance.now() + 2000;
      while (!predicate({ providerCount: providers.length, claimAttempts })) {
        assert.ok(performance.now() < until, "Native worker fixture did not reach its expected barrier");
        await new Promise(resolve => setTimeout(resolve, 2));
      }
    },
  };
}
