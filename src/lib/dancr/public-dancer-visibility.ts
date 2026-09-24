import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

// Use an anonymous client: ownership must never make an incognito dancer
// appear public. Return only currently public IDs, without private state.
export async function publicDancerVisibility(request: Request, client: SupabaseClient) {
  const ids = (new URL(request.url).searchParams.get("ids") || "").split(",");
  if (ids.length > 200 || ids.some(id => !UUID.test(id))) {
    return Response.json({ ok: false }, { status: 400, headers: HEADERS });
  }
  try {
    const { data, error } = await client.from("dancer_profiles").select("id")
      .in("id", [...new Set(ids.map(id => id.toLowerCase()))])
      .eq("is_public", true).abortSignal(request.signal);
    if (error || !Array.isArray(data) || request.signal.aborted) throw new Error("Unavailable");
    return Response.json({ ok: true, visibleIds: data.map(row => row.id) }, { headers: HEADERS });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: HEADERS });
  }
}
