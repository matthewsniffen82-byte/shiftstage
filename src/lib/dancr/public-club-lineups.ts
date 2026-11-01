import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDirectoryCandidates } from "./directory-candidates";
import { clubMediaPermissions } from "./club-media-permissions";
import { getPerformancePlacementScores } from "./performance-placement";
import { rankDiscovery } from "./discovery-ranking";
import { getLiveDancerDiscovery } from "./public";
import type { DancerCard } from "./types";

const PORTRAITS_PER_CLUB = 5;
const QUERY_BATCH = 100;

// Count lightweight eligible identities, then hydrate only the displayed portraits.
// Never cache visibility, presence, or club media permissions between requests.
export async function getPublicClubLineups(admin: SupabaseClient, city: string, venueIds: string[]) {
  const candidates = await getDirectoryCandidates(admin, city);
  const now = Date.now();
  const groups = new Map([...new Set(venueIds)].map(id => [id, {
    candidates: [] as typeof candidates,
    eligible: new Set<string>(), dancers: [] as DancerCard[], next: 0,
  }]));
  for (const row of candidates) if (row.venueId && Date.parse(row.availableUntil || "") > now) {
    groups.get(row.venueId)?.candidates.push(row);
  }
  const entries = [...groups];
  // Bound concurrency and request sizes, including the All cities directory.
  for (let start = 0; start < entries.length; start += 4) {
    await Promise.all(entries.slice(start, start + 4).map(async ([venueId, group]) => {
      for (let offset = 0; offset < group.candidates.length; offset += QUERY_BATCH) {
        const ids = group.candidates.slice(offset, offset + QUERY_BATCH).map(row => row.id);
        const permissions = await clubMediaPermissions(admin, venueId, ids);
        for (const id of ids) if (permissions.get(id)?.photoIds.size) group.eligible.add(id);
      }
    }));
  }
  const eligible = candidates.filter(row => row.venueId && groups.get(row.venueId)?.eligible.has(row.id));
  const scores = await getPerformancePlacementScores(admin, eligible, now);
  // Match the full roster's score order, stable ties and existing grid pin.
  const ordered = rankDiscovery(eligible.map((row, index) => ({ ...row, performanceScore: scores[index] })), { surface: "grid" });
  for (const group of groups.values()) group.candidates = [];
  for (const row of ordered) groups.get(row.venueId!)!.candidates.push(row);

  for (;;) {
    const pending: { id: string; venueId: string }[] = [];
    for (const [venueId, group] of groups) {
      const count = Math.min(PORTRAITS_PER_CLUB - group.dancers.length, group.candidates.length - group.next);
      for (const row of group.candidates.slice(group.next, group.next + count)) pending.push({ id: row.id, venueId });
      group.next += count;
    }
    if (!pending.length) break;
    for (let start = 0; start < pending.length; start += QUERY_BATCH) {
      const batch = pending.slice(start, start + QUERY_BATCH);
      // These normal public serializers recheck approval, presence and the exact
      // club-approved photo source immediately before any portrait is returned.
      const page = await getLiveDancerDiscovery(admin, city, null, batch.map(row => row.id));
      const current = new Map(page.tonightDancers.map(row => [row.id, row]));
      for (const row of batch) {
        const group = groups.get(row.venueId)!;
        const dancer = current.get(row.id);
        if (dancer?.venueId === row.venueId) group.dancers.push(dancer);
        else group.eligible.delete(row.id);
      }
    }
  }
  const nowByVenue: Record<string, number> = {};
  for (const row of candidates) if (Date.parse(row.availableUntil || "") > now && row.venueId) {
    nowByVenue[row.venueId] = (nowByVenue[row.venueId] || 0) + 1;
  }
  for (const [id, group] of groups) nowByVenue[id] = group.eligible.size;
  const dancers = [...groups.values()].flatMap(group => group.dancers);
  return { dancers, tonightDancers: dancers, statusCounts: {
    now: Object.values(nowByVenue).reduce((sum, count) => sum + count, 0),
    not_now: candidates.filter(row => !(Date.parse(row.availableUntil || "") > now)).length,
    nowByVenue,
  } };
}
