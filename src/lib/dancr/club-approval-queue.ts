import type { SupabaseClient } from "@supabase/supabase-js";
import { mainPhotoPreviews } from "./media-review-main-photo";

type Profile = { user_id: string; stage_name: string; city: string };
type Join = { dancer_id: string; status: "pending" | "rejected"; requested_at: string; revision: string; dancer_profiles: Profile | Profile[] };
type Batch = { dancer_id: string; stage_name: string; item_count: number; created_at: string };
type Entry = { dancerId: string; stageName: string; mediaCount: number; date: string; join?: Join };

// Group before paging, including when a dancer submitted several batches.
function groupReviews(joins: Join[], batches: Batch[]) {
  const byDancer = new Map<string, Entry>();
  for (const join of joins) {
    const dancer = Array.isArray(join.dancer_profiles) ? join.dancer_profiles[0] : join.dancer_profiles;
    byDancer.set(join.dancer_id, { dancerId: join.dancer_id, stageName: dancer.stage_name, mediaCount: 0, date: join.requested_at, join });
  }
  for (const batch of batches) {
    const entry = byDancer.get(batch.dancer_id) || { dancerId: batch.dancer_id, stageName: batch.stage_name, mediaCount: 0, date: batch.created_at };
    if (entry.join?.status === "rejected") continue;
    entry.mediaCount += batch.item_count;
    if (batch.created_at < entry.date) entry.date = batch.created_at;
    byDancer.set(entry.dancerId, entry);
  }
  return [...byDancer.values()];
}

async function clubBatches(db: SupabaseClient, actor: string, venue: string): Promise<Batch[]> {
  // This authorized read also attaches newly submitted media to its club.
  const { data, error } = await db.rpc("get_media_batches", { p_actor: actor, p_role: "venue", p_venue: venue, p_dancer: null });
  if (error) throw error;
  if (data.batches.length < 100) return data.batches;
  // The batch picker returns at most 100. Read all pending club batches when
  // that limit is reached so badges and cards include the entire queue.
  const batches: Batch[] = [];
  let lastId: string | undefined;
  while (true) {
    const query = db.from("dancer_media_batches").select("id, dancer_id, created_at, items, dancer_profiles!inner(stage_name)")
      .eq("venue_id", venue).eq("state", "club").order("id");
    if (lastId) query.gt("id", lastId);
    const page = await query.limit(100);
    if (page.error) throw page.error;
    for (const row of page.data) {
      const profile = Array.isArray(row.dancer_profiles) ? row.dancer_profiles[0] : row.dancer_profiles;
      batches.push({ dancer_id: row.dancer_id, stage_name: profile.stage_name, created_at: row.created_at, item_count: row.items.length });
    }
    if (page.data.length < 100) return batches;
    lastId = page.data[page.data.length - 1].id;
  }
}

async function clubJoins(db: SupabaseClient, venue: string) {
  const joins: Join[] = [];
  let lastDancer: string | undefined;
  while (true) {
    const query = db.from("club_dancer_approvals")
      .select("dancer_id,status,requested_at,revision,dancer_profiles!inner(user_id,stage_name,city)")
      .eq("venue_id", venue).in("status", ["pending", "rejected"])
      .is("dancer_profiles.disabled_at", null).in("dancer_profiles.status", ["pending_review", "approved"])
      .order("dancer_id");
    if (lastDancer) query.gt("dancer_id", lastDancer);
    const { data, error } = await query.limit(250);
    if (error) throw error;
    joins.push(...data as Join[]);
    if (data.length < 250) return joins;
    lastDancer = data[data.length - 1].dancer_id;
  }
}

export async function clubApprovalQueue(db: SupabaseClient, actor: string, venue: string, offset: number, countOnly: boolean) {
  const [joins, batches] = await Promise.all([clubJoins(db, venue), clubBatches(db, actor, venue)]);
  const queue = groupReviews(joins, batches);
  const count = queue.filter(row => row.join?.status === "pending" || row.mediaCount > 0).length;
  if (countOnly) return { count };
  const priority = (entry: Entry) => entry.join?.status === "pending" ? 0 : entry.mediaCount > 0 ? 1 : 2;
  queue.sort((a, b) => priority(a) - priority(b) || a.date.localeCompare(b.date) || a.dancerId.localeCompare(b.dancerId));
  const page = queue.slice(offset, offset + 25);
  const rows = await Promise.all(page.map(async ({ dancerId, stageName, mediaCount, join }) => {
    const dancer = Array.isArray(join?.dancer_profiles) ? join.dancer_profiles[0] : join?.dancer_profiles;
    let expired = false;
    if (dancer) {
      const { data, error } = await db.from("dancer_nfc_enrollments").select("expires_at,nfc_tags(status)")
        .eq("venue_id", venue).eq("dancer_user_id", dancer.user_id).eq("status", "pending").maybeSingle();
      if (error) throw error;
      const tag = Array.isArray(data?.nfc_tags) ? data.nfc_tags[0] : data?.nfc_tags;
      expired = !data || tag?.status !== "active" || Date.parse(data.expires_at) <= Date.now();
    }
    return { dancerId, stageName, mediaCount, city: dancer?.city || "", status: join?.status ?? "media",
      revision: join?.revision ?? null, expired };
  }));
  const previews = await mainPhotoPreviews(db, rows.filter(row => !row.expired).map(row => row.dancerId));
  return { count, hasMore: offset + 25 < queue.length, requests: rows.map(row => ({ ...row, avatarUrl: previews.get(row.dancerId) || null })) };
}
