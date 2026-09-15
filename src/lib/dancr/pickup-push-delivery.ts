import "server-only";
import { createAdminSupabaseClient } from "../supabase/admin";
import { deliverNotificationRows, type NotificationDeliveryRow } from "./notification-delivery";

// Call only after a pickup RPC has authorized and committed the action. The RPC
// chooses recipients and inserts private notices; clients cannot supply either.
export async function deliverPickupPush(requestId: string, since: string) {
  if (!process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) return;
  try {
    const client = createAdminSupabaseClient();
    const { data, error } = await client.from("notifications")
      .select("id,recipient_id,notification_type,title,body,payload")
      .eq("channel", "in_app").eq("payload->>kind", "club_pickup")
      .eq("payload->>pickupRequestId", requestId).gte("created_at", since)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    // A notice's stable UUID is also the provider idempotency key. Concurrent
    // actions cannot send duplicate alerts for the same in-app notice.
    await Promise.all((data || []).map((row: NotificationDeliveryRow & { id: string }) =>
      deliverNotificationRows(client, [{ ...row, deliveryId: row.id }], { email: false })));
  } catch { console.warn("PICKUP_PUSH_DELIVERY_UNAVAILABLE"); }
}
