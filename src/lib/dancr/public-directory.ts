import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DISCOVERY_UUID, discoveryContext, discoverySnapshot, type DiscoveryPlacement } from "./discovery-service";
import { discoveryCursor } from "./discovery-pagination";
import { getLiveDancerDiscovery } from "./public";
import type { DancerCard } from "./types";

type DirectoryCard = DancerCard & { discovery: DiscoveryPlacement };
type DirectoryOptions = { city: string; cursor?: string; filter?: "all" | "now" | "not_now"; venueId?: string };

export async function getRankedDirectoryPage(admin: SupabaseClient, request: Request, options: DirectoryOptions) {
  const cookieSession = request.headers.get("cookie")?.match(/(?:^|;\s*)md_directory_placement=([^;]+)/)?.[1];
  const anonymousSession = cookieSession && DISCOVERY_UUID.test(cookieSession) ? cookieSession : randomUUID();
  const context = (await discoveryContext(admin, request, anonymousSession))!;
  const { snapshot, offset, statusCounts } = await discoverySnapshot(admin, context, {
    surface: "grid", directory: true, city: options.city, filter: options.filter || "all", venueId: options.venueId,
  }, options.cursor);
  const dancers: DirectoryCard[] = [], tonightDancers: DirectoryCard[] = [];
  // Fill the opening screen sooner, then load the remaining ranked cards in
  // larger pages. The snapshot still ranks every eligible dancer up front.
  const pageSize = offset === 0 ? 24 : 100;
  let next = offset;
  // Recheck visibility and presence now. Backfill removed profiles without
  // changing the saved score order or skipping another eligible dancer.
  while (dancers.length < pageSize && next < snapshot.ordered_ids.length) {
    const ids = snapshot.ordered_ids.slice(next, next + pageSize - dancers.length);
    const page = await getLiveDancerDiscovery(admin, options.city, null, ids);
    const byId = new Map(page.dancers.map(row => [row.id, row]));
    const tonightById = new Map(page.tonightDancers.map(row => [row.id, row]));
    for (const id of ids) {
      const discovery = { session: snapshot.id, position: next++ };
      const row = byId.get(id), tonight = tonightById.get(id);
      if (!row || options.venueId && row.venueId !== options.venueId
        || options.filter === "now" && !tonight || options.filter === "not_now" && tonight) continue;
      dancers.push({ ...row, discovery });
      if (tonight) tonightDancers.push({ ...tonight, discovery });
    }
  }
  const cookie = !request.headers.has("x-discovery-session") && !request.headers.has("x-discovery-visit")
    ? `md_directory_placement=${anonymousSession}; Path=/api/public; Max-Age=7200; HttpOnly; SameSite=Lax; Secure` : null;
  return { dancers, tonightDancers, cookie, statusCounts,
    nextCursor: next < snapshot.ordered_ids.length ? discoveryCursor(options.city, snapshot.id, next) : null };
}
