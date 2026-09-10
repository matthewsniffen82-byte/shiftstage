import { createHash } from "node:crypto";

const PUBLIC_BUCKET = "dancer-photos", ORIGINAL_BUCKET = "dancr-media-originals";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WIDTHS = [320, 480, 640, 1280, 2048];
const WEEK = 7 * 24 * 60 * 60 * 1000;
const fingerprint = value => createHash("sha256").update(value).digest("hex");
const validDate = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const dataOrThrow = response => {
  if (!response || response.error || response.data == null) throw new Error("Gallery audit verification failed.");
  return response.data;
};

export function parseGalleryStorageAuditOptions(args) {
  const options = { side: "public", limit: 10, offset: 0 }, seen = new Set();
  for (const argument of args) {
    const [name, value, extra] = argument.split("=");
    if (seen.has(name) || extra !== undefined) throw new Error("Invalid audit option.");
    seen.add(name);
    if (name === "--profile" && UUID.test(value)) options.profileId = value.toLowerCase();
    else if (name === "--side" && ["public", "originals"].includes(value)) options.side = value;
    else if (name === "--limit" && /^(?:[1-9]|1[0-9]|20)$/.test(value)) options.limit = Number(value);
    else if (name === "--offset" && /^(?:0|[1-9][0-9]{0,5})$/.test(value)) options.offset = Number(value);
    else throw new Error("Use --profile=UUID, --side=public|originals, --limit=1..20 and --offset=0..999999. This command has no apply mode.");
  }
  if (!options.profileId) throw new Error("One explicit profile is required.");
  return options;
}

/** Defense in depth for the maintenance CLI: storage listing uses a read-only POST. */
export function galleryAuditFetch(baseUrl, fetchImpl = globalThis.fetch) {
  const origin = new URL(baseUrl).origin;
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const read = method === "GET" && (
      /^\/rest\/v1\/(?:dancer_profiles|dancer_photos|image_moderation_records)$/.test(url.pathname)
      || /^\/storage\/v1\/bucket\/(?:dancer-photos|dancr-media-originals)$/.test(url.pathname)
      || /^\/storage\/v1\/object\/info\/(?:dancer-photos|dancr-media-originals)\//.test(url.pathname));
    const list = method === "POST" && /^\/storage\/v1\/object\/list\/(?:dancer-photos|dancr-media-originals)$/.test(url.pathname);
    if (url.origin !== origin || url.username || url.password || (!read && !list)) throw new Error("The gallery audit permits metadata reads only.");
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return fetchImpl(input, { ...init, redirect: "error", signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
  };
}

function manifest(name, side) {
  // Only recognize this uploader's root gallery names. Legacy files and folders
  // remain visible as unclassified entries; never guess a target from a prefix.
  const match = name.match(/^([0-9a-f-]{36})\.r(0|[1-9]\d*(?:-[1-9]\d*)*)\.m([1-9]\d*)x([1-9]\d*)\.f(\d{1,3})x(\d{1,3})\.(jpg|jpeg|png|webp)(?:\.w([1-9]\d*)\.webp)?$/i);
  if (!match || !UUID.test(match[1]) || Number(match[5]) > 100 || Number(match[6]) > 100) return null;
  const widths = match[2] === "0" ? [] : match[2].split("-").map(Number);
  if (widths.some((width, i) => !WIDTHS.includes(width) || width >= Number(match[3]) || (i > 0 && width <= widths[i - 1]))
    || (match[8] && (side === "originals" || !widths.includes(Number(match[8]))))) return null;
  const master = match[8] ? name.slice(0, -`.w${match[8]}.webp`.length) : name;
  return { master, names: [master, ...widths.map(width => `${master}.w${width}.webp`)] };
}

async function present(client, table, column, paths) {
  const data = dataOrThrow(await client.from(table).select("id").in(column, paths).limit(1));
  if (!Array.isArray(data) || data.length > 1 || data.some(row => !UUID.test(row?.id))) throw new Error("Invalid reference response.");
  return data.length > 0;
}

async function companion(client, bucket, path) {
  const response = await client.storage.from(bucket).info(path);
  if (response?.error && String(response.error.statusCode ?? response.error.status) === "404") return "missing";
  const data = dataOrThrow(response);
  if (!data.id || !data.version || data.bucketId !== bucket || data.name !== path
    || !Number.isSafeInteger(data.size) || data.size <= 0 || !validDate(data.createdAt)
    || !validDate(data.lastModified ?? data.updatedAt)) throw new Error("Invalid companion metadata.");
  return "present";
}

async function inspectGroup(client, prefix, parsed) {
  const paths = parsed.names.map(name => `${prefix}/${name}`);
  // Check across owners and review states, including direct derivative references.
  const [gallery, avatar, moderationFinal, moderationSource, publicMaster, original] = await Promise.all([
    present(client, "dancer_photos", "storage_path", paths),
    present(client, "dancer_profiles", "avatar_storage_path", paths),
    present(client, "image_moderation_records", "final_storage_path", paths),
    present(client, "image_moderation_records", "temporary_storage_path", paths),
    companion(client, PUBLIC_BUCKET, paths[0]),
    companion(client, ORIGINAL_BUCKET, `${PUBLIC_BUCKET}/${paths[0]}`),
  ]);
  return { status: gallery || avatar ? "referenced" : moderationFinal || moderationSource ? "moderation_record_only" : "no_known_reference",
    references: { gallery, avatar, moderationFinal, moderationSource }, companions: { publicMaster, original } };
}

/** Bounded metadata inventory only. A missing reference is NEVER a deletion plan. */
export async function auditGalleryStorage(client, options, { now = Date.now() } = {}) {
  if (!options || Object.keys(options).some(key => !["profileId", "side", "limit", "offset"].includes(key))
    || !Number.isFinite(now)) throw new Error("Invalid audit options.");
  const normalized = parseGalleryStorageAuditOptions([`--profile=${options.profileId}`, `--side=${options.side ?? "public"}`,
    `--limit=${options.limit ?? 10}`, `--offset=${options.offset ?? 0}`]);
  const profile = dataOrThrow(await client.from("dancer_profiles").select("id,user_id").eq("id", normalized.profileId).maybeSingle());
  if (profile.id !== normalized.profileId || !UUID.test(profile.user_id)) throw new Error("Profile ownership could not be verified.");
  const [publicBucket, originalBucket] = await Promise.all([client.storage.getBucket(PUBLIC_BUCKET), client.storage.getBucket(ORIGINAL_BUCKET)]);
  if (dataOrThrow(publicBucket).id !== PUBLIC_BUCKET || publicBucket.data.public !== true
    || dataOrThrow(originalBucket).id !== ORIGINAL_BUCKET || originalBucket.data.public !== false) throw new Error("Storage bucket privacy could not be verified.");
  const prefix = `${profile.user_id}/${profile.id}`;
  const bucket = normalized.side === "public" ? PUBLIC_BUCKET : ORIGINAL_BUCKET;
  const directory = normalized.side === "public" ? prefix : `${PUBLIC_BUCKET}/${prefix}`;
  const entries = dataOrThrow(await client.storage.from(bucket).list(directory, {
    limit: normalized.limit, offset: normalized.offset, sortBy: { column: "name", order: "asc" },
  }));
  if (!Array.isArray(entries) || entries.length > normalized.limit || entries.some(entry => !entry
    || typeof entry.name !== "string" || !entry.name || entry.name.length > 512 || /[\\/\x00-\x1f\x7f]/.test(entry.name)
    || entry.name === "." || entry.name === "..") || new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error("Invalid storage listing.");
  const groups = new Map(), results = [];
  for (const entry of entries) {
    const result = { objectKey: fingerprint(`${bucket}/${directory}/${entry.name}`), status: "unrecognized", bytes: null };
    if (entry.id === null && entry.metadata === null) {
      result.status = "folder_not_scanned";
    } else if (!UUID.test(entry.id) || !Number.isSafeInteger(entry.metadata?.size) || entry.metadata.size < 0
      || !validDate(entry.created_at) || !validDate(entry.updated_at)) {
      result.status = "verification_failed";
    } else {
      result.bytes = entry.metadata.size;
      result.age = Math.max(Date.parse(entry.created_at), Date.parse(entry.updated_at)) <= now - WEEK ? "at_least_seven_days" : "recent";
      const parsed = manifest(entry.name, normalized.side);
      if (parsed) {
        if (!groups.has(parsed.master)) {
          try { groups.set(parsed.master, await inspectGroup(client, prefix, parsed)); }
          catch { groups.set(parsed.master, { status: "verification_failed" }); }
        }
        Object.assign(result, { publicationKey: fingerprint(`${prefix}/${parsed.master}`) }, groups.get(parsed.master));
      }
    }
    results.push(result);
  }
  const observedBytes = results.reduce((sum, result) => sum + (result.bytes ?? 0), 0);
  if (!Number.isSafeInteger(observedBytes)) throw new Error("Storage byte count could not be verified.");
  const nextOffset = normalized.offset + entries.length;
  return { mode: "read_only", side: normalized.side, profileKey: fingerprint(prefix), offset: normalized.offset,
    scanned: entries.length, nextOffset: entries.length === normalized.limit && nextOffset <= 999999 ? nextOffset : null,
    pageLimitReached: entries.length === normalized.limit && nextOffset > 999999, observedBytes,
    byteCountComplete: results.every(result => result.bytes !== null || result.status === "folder_not_scanned"),
    deletionAuthorized: false, results, ok: results.every(result => result.status !== "verification_failed") };
}
