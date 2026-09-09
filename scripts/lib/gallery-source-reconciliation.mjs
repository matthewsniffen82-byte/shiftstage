import { createHash } from "node:crypto";

export const MAX_SOURCE_RECONCILIATION_RECORDS = 20;
export const SOURCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECORD_COLUMNS = "id,user_id,image_id,decision,status,upload_context,temporary_storage_path,final_storage_path,updated_at,completed_at";
const TEMP_BUCKET = "dancr-image-moderation-temp";
const REVIEW_BUCKET = "dancr-image-moderation-review";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const oldEnough = (value, now) => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now - SOURCE_RETENTION_MS;

class RetainSource extends Error {}
const retain = reason => { throw new RetainSource(reason); };
const dataOrThrow = result => {
  if (result.error) throw new Error("Provider request failed.");
  if (result.data == null) throw new Error("Provider returned no result.");
  return result.data;
};

export function parseSourceReconciliationOptions(args) {
  const options = { apply: false, limit: 5 };
  const seen = new Set();
  for (const argument of args) {
    const [name, ...parts] = argument.split("=");
    const value = parts.join("=");
    if (seen.has(name)) throw new Error("Duplicate maintenance option.");
    seen.add(name);
    if (name === "--apply" && !parts.length) options.apply = true;
    else if (name === "--record" && UUID.test(value)) options.recordId = value;
    else if (name === "--after" && UUID.test(value)) options.afterId = value;
    else if (name === "--limit" && /^[1-9]\d*$/.test(value) && Number(value) <= MAX_SOURCE_RECONCILIATION_RECORDS) options.limit = Number(value);
    else if (name === "--expected-plan" && /^[a-f0-9]{64}$/.test(value)) options.expectedPlan = value;
    else throw new Error("Invalid maintenance option. Use --record=UUID, --after=UUID, --limit=1..20, or --apply --record=UUID --expected-plan=SHA256.");
  }
  if (options.recordId && options.afterId) throw new Error("Choose a record or a page cursor, not both.");
  if (options.apply && (!options.recordId || !options.expectedPlan)) throw new Error("Apply requires one explicit record and the expected plan from its dry run.");
  if (!options.apply && options.expectedPlan) throw new Error("An expected plan is only used with --apply.");
  return options;
}

function sourceLocations(record, profileId) {
  const prefix = `${record.user_id}/${profileId}/`;
  const path = record.temporary_storage_path;
  if (typeof path !== "string" || !path.startsWith(prefix)) retain("unrecognized_source_path");
  const match = path.slice(prefix.length).match(/^(?:review-)?(\d{13}-([0-9a-f-]{36})\.(?:jpg|jpeg|png|webp))$/i);
  if (!match || !UUID.test(match[2])) retain("unrecognized_source_path");
  // These are the two immutable, server-generated copies of this upload.
  return [
    { bucket: TEMP_BUCKET, path: `${prefix}${match[1]}` },
    { bucket: REVIEW_BUCKET, path: `${prefix}review-${match[1]}` },
  ];
}

async function objectInfo(client, bucket, path, now, optional = false) {
  const response = await client.storage.from(bucket).info(path);
  if (optional && response.error && String(response.error.statusCode ?? response.error.status) === "404") return null;
  const info = dataOrThrow(response);
  if (!info.id || !info.version || info.name !== path || info.bucketId !== bucket
    || !oldEnough(info.createdAt, now) || !oldEnough(info.lastModified ?? info.updatedAt, now)
    || !Number.isSafeInteger(info.size) || info.size <= 0) retain("storage_metadata_unconfirmed");
  return { bucket, path, id: info.id, version: info.version, createdAt: info.createdAt,
    modifiedAt: info.lastModified ?? info.updatedAt, size: info.size };
}

async function inspectRecord(client, recordId, now) {
  const recordResult = await client.from("image_moderation_records").select(RECORD_COLUMNS).eq("id", recordId).maybeSingle();
  if (!recordResult.error && !recordResult.data) retain("record_missing");
  const record = dataOrThrow(recordResult);
  if (record.id !== recordId || !UUID.test(record.user_id) || !UUID.test(record.image_id)
    || record.decision !== "approved" || record.status !== "approved"
    || !/^profile_(?:main(?::\d+)?|gallery(?::\d+)?)$/.test(record.upload_context || "")) retain("approval_unconfirmed");
  if (!oldEnough(record.updated_at, now) || !oldEnough(record.completed_at, now)) retain("approval_too_recent");
  const [profileResult, photoResult] = await Promise.all([
    client.from("dancer_profiles").select("id,user_id").eq("user_id", record.user_id).maybeSingle(),
    client.from("dancer_photos").select("id,dancer_id,storage_path,review_status").eq("id", record.image_id).maybeSingle(),
  ]);
  if ((!profileResult.error && !profileResult.data) || (!photoResult.error && !photoResult.data)) retain("published_photo_missing");
  const profile = dataOrThrow(profileResult), photo = dataOrThrow(photoResult);
  if (!UUID.test(profile.id) || profile.user_id !== record.user_id || photo.id !== record.image_id
    || photo.dancer_id !== profile.id || photo.review_status !== "approved" || photo.storage_path !== record.final_storage_path) retain("publication_mismatch");
  const prefix = `${record.user_id}/${profile.id}/`;
  const finalPath = record.final_storage_path;
  if (typeof finalPath !== "string" || !finalPath.startsWith(prefix) || !/^[a-zA-Z0-9._/-]+$/.test(finalPath)
    || finalPath.includes("..") || finalPath.includes("//")) retain("unrecognized_publication_path");
  const locations = sourceLocations(record, profile.id);
  const paths = locations.map(location => location.path);
  const referenceResults = await Promise.all([
    client.from("image_moderation_records").select("id").neq("id", record.id).in("temporary_storage_path", paths).limit(1),
    client.from("image_moderation_records").select("id").in("final_storage_path", paths).limit(1),
    client.from("dancer_photos").select("id").in("storage_path", paths).limit(1),
    client.from("dancer_profiles").select("id").in("avatar_storage_path", paths).limit(1),
  ]);
  if (referenceResults.some(result => !Array.isArray(dataOrThrow(result)))) throw new Error("Invalid reference response.");
  if (referenceResults.some(result => result.data.length)) retain("shared_source_reference");
  const [published, original, ...sources] = await Promise.all([
    objectInfo(client, "dancer-photos", finalPath, now),
    objectInfo(client, "dancr-media-originals", `dancer-photos/${finalPath}`, now),
    ...locations.map(location => objectInfo(client, location.bucket, location.path, now, true)),
  ]);
  return { record, profile, photo, published, original, sources: sources.filter(Boolean) };
}

/** Maintenance only: never imported by an API, browser bundle or scheduled worker. */
export async function reconcileGallerySources(client, options, { now = Date.now() } = {}) {
  // Validate programmatic calls with the same bounds as the command line.
  const normalized = parseSourceReconciliationOptions([
    `--limit=${options.limit ?? 5}`,
    ...(options.recordId ? [`--record=${options.recordId}`] : []),
    ...(options.afterId ? [`--after=${options.afterId}`] : []),
    ...(options.apply ? ["--apply"] : []),
    ...(options.expectedPlan ? [`--expected-plan=${options.expectedPlan}`] : []),
  ]);
  if (!Number.isSafeInteger(now) || now < SOURCE_RETENTION_MS) throw new Error("Invalid maintenance clock.");
  for (const bucket of [TEMP_BUCKET, REVIEW_BUCKET, "dancr-media-originals"]) {
    const value = dataOrThrow(await client.storage.getBucket(bucket));
    if (value.id !== bucket || value.public !== false) throw new Error("Private storage configuration is unconfirmed.");
  }
  let query = client.from("image_moderation_records").select("id").order("id", { ascending: true }).limit(normalized.recordId ? 1 : normalized.limit);
  if (normalized.recordId) query = query.eq("id", normalized.recordId);
  else {
    query = query.eq("decision", "approved").eq("status", "approved").lt("updated_at", new Date(now - SOURCE_RETENTION_MS).toISOString());
    if (normalized.afterId) query = query.gt("id", normalized.afterId);
  }
  const records = dataOrThrow(await query);
  if (!Array.isArray(records) || records.length > (normalized.recordId ? 1 : normalized.limit)
    || records.some(record => !UUID.test(record.id) || (normalized.recordId && record.id !== normalized.recordId))
    || new Set(records.map(record => record.id)).size !== records.length) throw new Error("Invalid candidate response.");
  const results = [];
  for (const { id } of records) {
    const result = { recordId: id, status: "retained", confirmedRemoved: 0 };
    try {
      const plan = await inspectRecord(client, id, now);
      if (!plan.sources.length) {
        result.status = "already_clean";
      } else {
        result.expectedPlan = hash(plan);
        result.sourceCount = plan.sources.length;
        result.sourceBytes = plan.sources.reduce((sum, source) => sum + source.size, 0);
        result.status = "eligible";
        if (normalized.apply) {
          if (normalized.expectedPlan !== result.expectedPlan) retain("plan_changed");
          for (const source of plan.sources) {
            // Re-read the approval, ownership, all references and object versions
            // immediately before each delete. A prior acknowledged removal is
            // the only difference allowed from the reviewed dry-run plan.
            const current = await inspectRecord(client, id, now);
            const remaining = { ...plan, sources: plan.sources.slice(result.confirmedRemoved) };
            if (hash(current) !== hash(remaining)) retain("plan_changed");
            result.status = "removal_unconfirmed";
            const response = await client.storage.from(source.bucket).remove([source.path]);
            if (response.error) throw new Error("Storage removal could not be confirmed.");
            if (!Array.isArray(response.data) || response.data.length !== 1 || response.data[0].name !== source.path) throw new Error("Storage removal could not be confirmed.");
            result.confirmedRemoved += 1;
          }
          result.status = "cleaned";
        }
      }
    } catch (error) {
      if (error instanceof RetainSource) { result.status = "retained"; result.reason = error.message; }
      else if (result.status !== "removal_unconfirmed") { result.status = "failed"; result.reason = "verification_failed"; }
    }
    results.push(result);
  }
  return { mode: normalized.apply ? "apply" : "dry_run", retentionDays: 7, scanned: records.length,
    nextCursor: !normalized.recordId && records.length === normalized.limit ? records.at(-1).id : null,
    results, ok: (!normalized.apply || (results.length === 1 && ["cleaned", "already_clean"].includes(results[0].status)))
      && results.every(result => !["failed", "removal_unconfirmed"].includes(result.status)) };
}
