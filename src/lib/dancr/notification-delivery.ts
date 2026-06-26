import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json, NotificationType } from "./types";

type DancrClient = SupabaseClient;

export type NotificationDeliveryRow = {
  recipient_id: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  payload?: Json;
};

type Recipient = {
  id: string;
  email: string | null;
};

export async function deliverNotificationRows(client: DancrClient, rows: NotificationDeliveryRow[]) {
  if (!rows.length) return { push: 0, email: 0 };

  const recipients = await getRecipients(client, rows.map((row) => row.recipient_id));
  const push = await deliverPushNotifications(rows);
  const email = await deliverEmailNotifications(rows, recipients);

  return { push, email };
}

async function getRecipients(client: DancrClient, recipientIds: string[]): Promise<Recipient[]> {
  const ids = Array.from(new Set(recipientIds));
  if (!ids.length) return [];

  const { data, error } = await (client as any)
    .from("app_users")
    .select("id, email")
    .in("id", ids)
    .eq("account_state", "active");

  if (error) throw error;
  return data || [];
}

async function deliverPushNotifications(rows: NotificationDeliveryRow[]) {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return 0;

  let delivered = 0;
  for (const row of rows) {
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: appId,
        include_external_user_ids: [row.recipient_id],
        channel_for_external_user_ids: "push",
        headings: { en: row.title },
        contents: { en: row.body },
        data: row.payload || {},
      }),
    });

    if (!response.ok) {
      console.warn("OneSignal delivery failed", await response.text().catch(() => response.statusText));
      continue;
    }
    delivered += 1;
  }
  return delivered;
}

async function deliverEmailNotifications(rows: NotificationDeliveryRow[], recipients: Recipient[]) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return 0;

  const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  let delivered = 0;

  for (const row of rows) {
    const email = recipientById.get(row.recipient_id)?.email;
    if (!email) continue;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: row.title,
        text: row.body,
      }),
    });

    if (!response.ok) {
      console.warn("Resend delivery failed", await response.text().catch(() => response.statusText));
      continue;
    }
    delivered += 1;
  }

  return delivered;
}
