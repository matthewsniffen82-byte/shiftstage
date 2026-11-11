import { headers } from "next/headers";
import { internalScope } from "@/src/lib/dancr/internal-roster";
import { getVenueGuestColors } from "@/src/lib/dancr/venue-guest-colors";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { InternalRoster } from "../../InternalRoster";

async function getLoadingAccent(token: string, cookie: string | null) {
  if (!cookie) return null;
  try {
    const request = new Request("https://www.mydancr.com/internal", { headers: { cookie } });
    const admin = createAdminSupabaseClient();
    const scope = await internalScope(admin, request, token);
    return (await getVenueGuestColors(admin, scope.venueId)).internalAccent;
  } catch {
    // The roster handles expired links and read failures through its normal response.
    return null;
  }
}

export default async function Page({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const [{ token }, query, requestHeaders] = await Promise.all([params, searchParams, headers()]);
  const initialInternalAccent = await getLoadingAccent(token, requestHeaders.get("cookie"));
  return <InternalRoster token={token} initialInternalAccent={initialInternalAccent} fromClubDashboard={query.from === "club-dashboard"} />;
}
