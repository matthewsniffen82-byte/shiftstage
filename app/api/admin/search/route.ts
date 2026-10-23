import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const role = await requireAdmin(client, user.id, "workspace");
    if (role !== "owner" && role !== "support") throw new PublicApiError("FORBIDDEN", "Your staff role does not allow account searches.", 403);
    const q = (new URL(request.url).searchParams.get("q") || "").replace(/[^\p{L}\p{N} @._-]/gu, "").trim().slice(0, 80);
    if (q.length < 2) return NextResponse.json({ ok: true, results: [], session });
    const db = createAdminSupabaseClient() as any;
    const results = await Promise.all([
      db.from("dancer_profiles").select("id,stage_name,city,status").ilike("stage_name", `%${q}%`).order("stage_name").limit(10),
      db.from("venues").select("id,name,city").or(`name.ilike.%${q}%,city.ilike.%${q}%`).order("name").limit(10),
      db.from("app_users").select("id,email,display_name,role,account_state").or(`email.ilike.%${q}%,display_name.ilike.%${q}%`).order("email").limit(10),
      role === "owner" ? db.from("internal_roster_links").select("id,label,venue_id,venues(name)").eq("kind", "table").ilike("label", `%${q}%`).order("label").limit(10) : Promise.resolve({ data: [] }),
    ]);
    for (const result of results) if (result.error) throw result.error;
    return NextResponse.json({ ok: true, session, results: [
      ...results[0].data.map((r: any) => ({ type: "dancer", id: r.id, label: r.stage_name, detail: `${r.city} · ${r.status}` })),
      ...results[1].data.map((r: any) => ({ type: "club", id: r.id, label: r.name, detail: r.city, venueId: r.id })),
      ...results[2].data.map((r: any) => ({ type: "account", id: r.id, label: r.display_name || r.email, detail: `${r.email} · ${r.role} · ${r.account_state}` })),
      ...results[3].data.map((r: any) => ({ type: "table", id: r.id, label: r.label, detail: r.venues?.name || "Club table", venueId: r.venue_id })),
    ] });
  } catch (error) { return apiError(error, "Search is temporarily unavailable."); }
}
