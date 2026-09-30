import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverNotificationRows, type NotificationDeliveryRow } from "./notification-delivery";

export async function deliverInternalCancellationPush(client: SupabaseClient, requestId: string) {
  const { data: request, error } = await client.from("internal_roster_requests")
    .select("id,venue_id,link_id,dancer_id,status").eq("id", requestId).maybeSingle();
  if (error) throw error;
  if (request?.status !== "cancelled") return;
  const results = await Promise.all([
    client.from("venues").select("owner_user_id").eq("id", request.venue_id).eq("is_active", true).maybeSingle(),
    client.from("internal_roster_links").select("label").eq("id", request.link_id).eq("venue_id", request.venue_id).maybeSingle(),
    client.from("dancer_profiles").select("stage_name").eq("id", request.dancer_id).maybeSingle(),
    client.from("venue_team_members").select("user_id").eq("venue_id", request.venue_id).eq("status", "active").in("role", ["manager", "staff"]),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const [venue, link, dancer, team] = results;
  if (!venue.data || !link.data || !dancer.data) return;
  const recipients = [...new Set([venue.data.owner_user_id, ...(team.data || []).map(row => row.user_id)])];
  for (const recipient of recipients) {
    const access = await client.rpc("internal_roster_access", { p_actor: recipient, p_venue: request.venue_id });
    if (access.error) throw access.error;
    if (!access.data) continue;
    // Stable notification and push IDs keep repeated cancellation receipts from
    // creating duplicate inbox entries or resending to already notified devices.
    const digest = createHash("sha256").update(`internal-cancel:${request.id}:${recipient}`).digest("hex");
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const row: NotificationDeliveryRow = {
      recipient_id: recipient, notification_type: "support_message", title: "Table request cancelled",
      body: `${link.data.label} cancelled the request for ${dancer.data.stage_name}.`,
      payload: { kind: "internal_table_request", event: "cancelled" },
    };
    const saved = await client.from("notifications").upsert({ id, ...row }, { onConflict: "id", ignoreDuplicates: true });
    if (saved.error) throw saved.error;
    // Uses existing club table-request preferences, device receipts and deadlines.
    await deliverNotificationRows(client, [{ ...row, deliveryId: id }], { email: false });
  }
}
