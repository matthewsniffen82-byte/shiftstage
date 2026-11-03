import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const revision = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export async function GET(request: Request) {
  try {
    const { user } = await createRequestSupabaseContext(request, { role: "dancer" });
    const admin = createAdminSupabaseClient();
    const profile = await admin.from("dancer_profiles").select("id,updated_at,status,verification_status")
      .eq("user_id", user.id).single();
    if (profile.error) throw profile.error;
    const dancerId = profile.data.id;
    // A latest modification plus exact count detects updates, arrivals and
    // deletions without signing previews or returning media/account details.
    const latest = (table: string, owner: string, value: string, column: string) => admin.from(table)
      .select(`id,${column}`, { count: "exact" }).eq(owner, value)
      .order(column, { ascending: false }).order("id", { ascending: false }).limit(1);
    const [photos, images, videos] = await Promise.all([
      latest("dancer_photos", "dancer_id", dancerId, "created_at"),
      latest("image_moderation_records", "user_id", user.id, "updated_at"),
      latest("mydancr_tv_videos", "dancer_id", dancerId, "updated_at"),
    ]);
    for (const result of [photos, images, videos]) if (result.error) throw result.error;
    const batches: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await admin.from("dancer_media_batches").select("id,revision,state")
        .eq("dancer_id", dancerId).neq("state", "completed").order("id").range(offset, offset + 999);
      if (result.error) throw result.error;
      batches.push(...(result.data || []));
      if ((result.data?.length || 0) < 1000) break;
    }
    const value = (result: typeof photos) => [result.data, result.count];
    return NextResponse.json({ ok: true,
      profile: revision(profile.data, value(photos), value(images), batches),
      videos: revision(value(videos), batches),
      batch: revision(value(photos), value(images), value(videos), batches),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error, "Unable to check media status."); }
}
