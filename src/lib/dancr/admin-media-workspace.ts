import "server-only";
import { PublicApiError } from "../api-error-policy";
import { withSignedThumbnail } from "./image-review";

export const ADMIN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function signedMediaPreview(db: any, row: any) {
  if (row.kind === "photo") return (await withSignedThumbnail(db, row)).thumbnailUrl;
  if (!row.storage_path) return "";
  const { data } = await db.storage.from("mydancr-tv-videos").createSignedUrl(row.storage_path, 600);
  return data?.signedUrl || "";
}

export async function getAdminMediaDancers(db: any, actor: string, params: URLSearchParams) {
  const venueId = params.get("venueId");
  const stage = ["staff", "club", "processing", "history"].includes(params.get("stage") || "") ? params.get("stage")! : "staff";
  const kind = ["photo", "video"].includes(params.get("kind") || "") ? params.get("kind")! : "all";
  const { data, error } = await db.rpc("get_admin_media_dancers", {
    p_actor: actor, p_stage: stage, p_kind: kind,
    p_venue_id: venueId && ADMIN_UUID.test(venueId) ? venueId : null,
    p_search: (params.get("q") || "").replace(/[^\p{L}\p{N} @._-]/gu, "").trim().slice(0, 80),
    p_hours: Math.min(8760, Math.max(0, Math.trunc(Number(params.get("hours")) || 0))),
    p_offset: Math.min(100000, Math.max(0, Math.trunc(Number(params.get("offset")) || 0))),
    p_counts_only: params.get("countsOnly") === "1",
  });
  if (error) throw error;
  const dancers = await Promise.all((data.dancers || []).map(async (row: any) => ({
    id: row.review_group, stageName: row.dancer_name, count: row.count,
    photoCount: row.photo_count, videoCount: row.video_count,
    previewKind: row.preview?.kind, previewUrl: row.preview ? await signedMediaPreview(db, row.preview) : "",
  })));
  return { dancers, dancerCount: data.dancerCount, total: data.total, counts: data.counts };
}
export async function claimAdminMedia(db: any, actor: string, kind: string, id: string, version: unknown, release = false) {
  if (!["photo", "video"].includes(kind) || !ADMIN_UUID.test(id) || typeof version !== "string" || !Number.isFinite(Date.parse(version))) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a current upload to review.", 400);
  }
  const { data, error } = await db.rpc("claim_admin_media", { p_actor: actor, p_kind: kind, p_id: id, p_version: version, p_release: release });
  if (error?.code === "40001") throw new PublicApiError("CONFLICT", "This upload changed or another reviewer has claimed it. Refresh to continue.", 409);
  if (error) throw error;
  return data;
}

export async function getAdminMediaWorkspace(db: any, params: URLSearchParams) {
  const stage = ["staff", "club", "processing", "history"].includes(params.get("stage") || "") ? params.get("stage")! : "staff";
  const kind = params.get("kind");
  const venueId = params.get("venueId");
  const search = (params.get("q") || "").replace(/[^\p{L}\p{N} @._-]/gu, "").trim().slice(0, 80);
  const hours = Math.min(8760, Math.max(0, Number(params.get("hours")) || 0));
  const group = params.get("group");
  const [groupKind, groupId] = group?.split(":") || [];
  if (group && (!/^(dancer|user|upload):[0-9a-fA-F-]{36}$/.test(group) || !ADMIN_UUID.test(groupId))) {
    throw new PublicApiError("INVALID_REQUEST", "Choose a valid dancer review.", 400);
  }
  const filter = (query: any) => {
    query = query.eq("stage", stage);
    if (kind === "photo" || kind === "video") query = query.eq("kind", kind);
    if (venueId && ADMIN_UUID.test(venueId)) query = query.eq("venue_id", venueId);
    if (search) query = query.or(`dancer_name.ilike.%${search}%,venue_name.ilike.%${search}%`);
    if (hours) query = query.lte("created_at", new Date(Date.now() - hours * 3600000).toISOString());
    if (groupKind === "dancer") query = query.eq("dancer_id", groupId);
    if (groupKind === "user") query = query.is("dancer_id", null).eq("user_id", groupId);
    if (groupKind === "upload") query = query.is("dancer_id", null).is("user_id", null).eq("id", groupId);
    return query;
  };
  let itemsQuery = filter(db.from("admin_media_workspace").select("*")).order("created_at").order("queue_key").limit(31);
  const cursor = params.get("cursor");
  if (cursor) {
    const [date, key] = cursor.split("|");
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(date) || !Number.isFinite(Date.parse(date)) || !/^(photo|video):[0-9a-f-]{36}$/i.test(key || "")) throw new PublicApiError("INVALID_REQUEST", "Invalid review page.", 400);
    // Preserve Postgres microseconds: Date.toISOString() would lose cursor precision.
    itemsQuery = itemsQuery.or(`created_at.gt.${date},and(created_at.eq.${date},queue_key.gt.${key})`);
  }
  const results = await Promise.all([
    params.get("countsOnly") === "1" ? Promise.resolve({ data: [], error: null }) : itemsQuery,
    filter(db.from("admin_media_workspace").select("id", { count: "exact", head: true })),
    ...["staff", "club", "processing"].map(s => {
      let q = db.from("admin_media_workspace").select("id", { count: "exact", head: true }).eq("stage", s);
      if (venueId && ADMIN_UUID.test(venueId)) q = q.eq("venue_id", venueId);
      return q;
    }),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const rows = results[0].data || [];
  const more = rows.length > 30;
  const items = await Promise.all(rows.slice(0, 30).map(async (row: any) => {
    const previewUrl = await signedMediaPreview(db, row);
    const { temporary_storage_path: _temporary, final_storage_path: _final, storage_path: _storage, ...item } = row;
    return { ...item, previewUrl };
  }));
  const last = items.at(-1);
  return { items, total: results[1].count || 0, counts: { staff: results[2].count || 0, club: results[3].count || 0, processing: results[4].count || 0 },
    nextCursor: more && last ? `${last.created_at}|${last.queue_key}` : null };
}
