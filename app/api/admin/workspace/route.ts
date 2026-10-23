import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { STAFF_WORKSPACES, staffRole } from "@/src/lib/dancr/admin-workspace-policy";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const role = await requireAdmin(client, user.id, "workspace");
    const db = createAdminSupabaseClient() as any;
    const { data: venues, error } = await db.from("venues").select("id,name,city,state,is_active,page_review_status,published_at").order("name");
    if (error) throw error;
    let staff: unknown[] = [];
    if (role === "owner") {
      const result = await db.from("app_users").select("id,email,display_name,admin_workspace_role,account_state").eq("role", "admin").order("created_at");
      if (result.error) throw result.error;
      staff = result.data || [];
    }
    return NextResponse.json({ ok: true, userId: user.id, role, workspaces: STAFF_WORKSPACES[role], venues, staff, session });
  } catch (error) { return apiError(error, "Unable to load your admin workspace."); }
}
export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await readBoundedJsonObject(request, { maxBytes: 2048, invalidMessage: "Invalid staff permissions.", tooLargeMessage: "Request too large." });
    if (!staffRole(body.role) || typeof body.id !== "string" || body.id === user.id) throw new PublicApiError("INVALID_REQUEST", "Choose another staff account and a valid role.", 400);
    const { error } = await (createAdminSupabaseClient() as any).rpc("set_admin_workspace_role", { p_actor: user.id, p_target: body.id, p_role: body.role });
    if (error) throw error;
    return NextResponse.json({ ok: true, session });
  } catch (error) { return apiError(error, "Unable to save staff permissions."); }
}
