import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "../server-env";
import { getBearerToken } from "../supabase/request";
import { PublicApiError } from "../api-error-policy";
import { rankDiscovery, type RankingCandidate, type RankingSurface } from "./discovery-ranking";
import { isAllMyDancrCities } from "./markets";
import { enforcePublicRequestRateLimit } from "./public-request-rate-limit";

export const DISCOVERY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type DiscoveryContext = { viewerHash: string; userId: string | null; visitId: string; request: Request };
export type DiscoveryPlacement = { session: string; position: number };
type Scope = { surface: RankingSurface; city: string; venueId?: string; dancerIds?: string[]; filter?: string; selectedVideoId?: string };
type Snapshot = { id: string; ordered_ids: string[]; expires_at: string };
let lastPruned = 0;

export async function discoveryContext(admin: SupabaseClient, request: Request): Promise<DiscoveryContext | null> {
  const session = request.headers.get("x-discovery-session") || "";
  const visitId = request.headers.get("x-discovery-visit") || "";
  if (!session && !visitId) return null;
  if (!DISCOVERY_UUID.test(session) || !DISCOVERY_UUID.test(visitId)) throw new PublicApiError("INVALID_REQUEST", "Invalid discovery session.", 400);
  const token = getBearerToken(request);
  let userId: string | null = null;
  if (token) {
    const { data, error } = await admin.auth.getUser(token);
    // Public browsing must still work if a stored login has expired. Only a
    // verified token can select account preferences or count a follow action.
    if (!error && data.user) userId = data.user.id;
  }
  const viewerHash = createHmac("sha256", process.env.DANCR_PUBLIC_RATE_LIMIT_SECRET || getServerEnv("SUPABASE_SERVICE_ROLE_KEY"))
    .update(userId ? `user:${userId}` : `guest:${session}`).digest("hex");
  return { viewerHash, userId, visitId, request };
}

export function parseRankedCursor(value: string) {
  const parts = value.split(":");
  if (parts.length !== 3 || parts[0] !== "rank1" || !DISCOVERY_UUID.test(parts[1]) || !/^\d{1,4}$/.test(parts[2])) return null;
  const offset = Number(parts[2]);
  return offset <= 5000 ? { id: parts[1], offset } : null;
}

export async function discoverySnapshot(admin: SupabaseClient, context: DiscoveryContext, scope: Scope, cursor = "") {
  const scopeHash = createHash("sha256").update(JSON.stringify([scope.surface, scope.city.toLowerCase(), scope.venueId || "", scope.filter || "for-you", scope.selectedVideoId || ""])).digest("hex");
  const parsed = cursor ? parseRankedCursor(cursor) : null;
  if (cursor && !parsed) throw new PublicApiError("INVALID_REQUEST", "Invalid discovery cursor.", 400);
  let query = admin.from("discovery_sessions").select("id,ordered_ids,expires_at")
    .eq("viewer_hash", context.viewerHash).eq("scope_hash", scopeHash).eq("visit_id", context.visitId);
  if (parsed) query = query.eq("id", parsed.id);
  const existing = await query.maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data && Date.parse(existing.data.expires_at) > Date.now()) {
    return { snapshot: existing.data as Snapshot, offset: parsed?.offset || 0 };
  }
  if (parsed) throw new PublicApiError("INVALID_REQUEST", "This feed has expired. Refresh to discover more videos.", 409);
  await enforcePublicRequestRateLimit(admin,{namespace:"discovery_snapshot",request:context.request,subject:context.viewerHash,
    windowSeconds:60,ipLimit:90,subjectLimit:30});
  const [candidateResult, history, dancerFollows, venueFollows] = await Promise.all([
    admin.rpc("get_discovery_candidates", { p_surface: scope.surface, p_city: isAllMyDancrCities(scope.city) ? "" : scope.city,
      p_venue: scope.venueId || null, p_dancer_ids: scope.dancerIds || null, p_seed: `${context.viewerHash.slice(0,24)}:${context.visitId}`,
      p_selected_video: scope.selectedVideoId || null }),
    admin.from("discovery_events").select("entity_id,dancer_id,event_type,occurred_at")
      .eq("viewer_hash", context.viewerHash).gte("occurred_at", new Date(Date.now()-30*86400000).toISOString())
      .in("event_type", ["completed","engaged","show_less"]).order("occurred_at", { ascending: false }).limit(5000),
    context.userId ? admin.from("follows").select("dancer_id").eq("customer_id",context.userId).limit(1000) : Promise.resolve({ data: [], error: null }),
    context.userId ? admin.from("venue_follows").select("venue_id").eq("customer_id",context.userId).limit(1000) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [candidateResult,history,dancerFollows,venueFollows]) if (result.error) throw result.error;
  const candidates = readRankingCandidates(candidateResult.data);
  const hidden = new Set((history.data || []).filter(row=>row.event_type === "show_less").map(row=>row.dancer_id));
  const watched = new Map<string,string>();
  for (const row of history.data || []) if (row.event_type !== "show_less" && !watched.has(row.entity_id)) watched.set(row.entity_id,row.occurred_at);
  const followingDancers = (dancerFollows.data || []).map(row=>row.dancer_id);
  const now = Date.now();
  const eligible = candidates.filter(row => scope.filter !== "following" || followingDancers.includes(row.dancerId))
    .filter(row => scope.filter !== "tonight" || Date.parse(row.availableUntil || "") > now
      || (Date.parse(row.nextShiftEndsAt || "") > now && Date.parse(row.nextShiftAt || "") <= now + 86400000))
    .map(row=>({ ...row, hidden: hidden.has(row.dancerId) && row.id !== scope.selectedVideoId, seenAt: watched.get(row.id) || null }));
  const ranked = rankDiscovery(eligible, { surface: scope.surface, now, seed: context.visitId, selectedId: scope.selectedVideoId,
    followingDancers, followingVenues: (venueFollows.data || []).map(row=>row.venue_id) });
  let orderedIds = ranked.map(row=>row.id);
  // Explicit newest sorting and direct links retain their meaning.
  if (scope.filter === "new") orderedIds = [...ranked].sort((a,b)=>Date.parse(b.freshAt || "1970-01-01")-Date.parse(a.freshAt || "1970-01-01")).map(row=>row.id);
  if (scope.filter === "new" && scope.selectedVideoId && orderedIds.includes(scope.selectedVideoId)) orderedIds = [scope.selectedVideoId,...orderedIds.filter(id=>id!==scope.selectedVideoId)];
  const expiresAt = new Date(now + 2*3600000).toISOString();
  // Concurrent preloads share the first committed snapshot rather than replace it.
  if (existing.data) {
    const deleted = await admin.from("discovery_sessions").delete().eq("id",existing.data.id).lte("expires_at",new Date(now).toISOString());
    if (deleted.error) throw deleted.error;
  }
  const inserted = await admin.from("discovery_sessions").upsert({ viewer_hash: context.viewerHash, visit_id: context.visitId,
    scope_hash: scopeHash, surface: scope.surface, ordered_ids: orderedIds, expires_at: expiresAt },
    { onConflict: "viewer_hash,visit_id,scope_hash", ignoreDuplicates: true });
  if (inserted.error) throw inserted.error;
  const saved = await admin.from("discovery_sessions").select("id,ordered_ids,expires_at")
    .eq("viewer_hash",context.viewerHash).eq("visit_id",context.visitId).eq("scope_hash",scopeHash).single();
  if (saved.error) throw saved.error;
  if (lastPruned < now - 86400000) {
    const pruned = await admin.rpc("prune_discovery_history");
    if (!pruned.error) lastPruned = now;
  }
  return { snapshot: saved.data as Snapshot, offset: 0 };
}

export function readRankingCandidates(value: unknown): RankingCandidate[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error("Discovery ranking could not be confirmed.");
  return value.map(row => {
    if (!row || !DISCOVERY_UUID.test(row.id) || !DISCOVERY_UUID.test(row.dancerId) || typeof row.city !== "string"
      || !Array.isArray(row.buckets) || row.buckets.length !== 3 || row.buckets.some((bucket: Record<string,unknown>) =>
        !bucket || ["impressions","actions","engaged","completed"].some(key=>typeof bucket[key] !== "number" || !Number.isFinite(bucket[key]) || (bucket[key] as number)<0))) {
      throw new Error("Discovery ranking could not be confirmed.");
    }
    return row as RankingCandidate;
  });
}

export async function rankPublicGrid<T extends { id: string }>(admin: SupabaseClient, context: DiscoveryContext, city: string, rows: T[]) {
  const { snapshot } = await discoverySnapshot(admin,context,{surface:"grid",city,dancerIds:rows.map(row=>row.id)});
  const hidden = await hiddenDiscoveryDancers(admin,context);
  const byId = new Map(rows.map(row=>[row.id,row]));
  const ordered = snapshot.ordered_ids.flatMap((id,position)=>{
    const row=byId.get(id); return row && !hidden.has(id) ? [{...row,discovery:{session:snapshot.id,position}}] : [];
  });
  // New approvals enter on the next visit; never append excluded preferences.
  return ordered;
}

export async function hiddenDiscoveryDancers(admin: SupabaseClient, context: DiscoveryContext) {
  const result = await admin.from("discovery_events").select("dancer_id").eq("viewer_hash",context.viewerHash)
    .eq("event_type","show_less").gte("occurred_at",new Date(Date.now()-30*86400000).toISOString()).limit(5000);
  if (result.error) throw result.error;
  return new Set<string>((result.data || []).map(row=>row.dancer_id));
}
