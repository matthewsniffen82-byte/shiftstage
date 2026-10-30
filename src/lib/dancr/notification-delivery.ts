import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { publicAppUrl } from "./public-app-url";
import type { Json, NotificationType } from "./types";
import { customerNotificationSettings, customerFollowAlertEnabled, followAlertKey } from "./customer-notification-preferences";
import { deliverWebPush } from "./web-push-delivery";
import { venueNotificationCategory, venueNotificationEnabled } from "./venue-notification-preferences";

type DancrClient = SupabaseClient;
const DELIVERY_PROVIDER_TIMEOUT_MS = 10_000;

export type NotificationDeliveryRow = {
  deliveryId?: string;
  recipient_id: string;
  notification_type: NotificationType;
  title: string;
  body: string;
  payload?: Json;
};

type Recipient = {
  id: string;
  email: string | null;
  role?: string;
};

export async function deliverNotificationRows(client: DancrClient, rows: NotificationDeliveryRow[], options: { email?: boolean; push?: boolean } = {}) {
  // These notices have dedicated delivery workers; offers must never send an email per alert.
  rows = rows.filter(row => !["club_pickup", "club_offer"].includes(String((row.payload as Record<string, unknown> | null)?.kind || "")));
  if (!rows.length) return { push: 0, email: 0 };

  const recipients = await getRecipients(client, rows.map((row) => row.recipient_id));
  const recipientById = new Map(recipients.map(recipient => [recipient.id, recipient]));
  const customerIds = recipients.filter(recipient => recipient.role === "customer").map(recipient => recipient.id);
  const settingsById = new Map<string, unknown>();
  const venueSettingsById = new Map<string, unknown>();
  // Use freshly stored preferences, not caller-supplied roles or cached JWT metadata.
  for (const recipient of recipients.filter(recipient => recipient.role === "venue")) {
    try {
      const { data, error } = await client.auth.admin.getUserById(recipient.id);
      if (!error && data.user) venueSettingsById.set(recipient.id, data.user.user_metadata);
    } catch { /* Optional delivery fails closed when preferences cannot be read. */ }
  }
  if (customerIds.length) {
    const { data, error } = await client.from("customer_profiles").select("user_id, notification_settings").in("user_id", customerIds);
    if (error) {
      console.warn("NOTIFICATION_PREFERENCES_UNAVAILABLE");
      // Do not use defaults when stored preferences could not be read.
    }
    if (!error) for (const profile of data || []) settingsById.set(profile.user_id, profile.notification_settings);
  }
  const allowed = (row: NotificationDeliveryRow, channel: "emailEnabled" | "pushEnabled") => {
    const recipient = recipientById.get(row.recipient_id);
    if (!recipient) return false;
    if (recipient.role === "venue") {
      if (!venueNotificationCategory(row)) return true;
      if (!venueSettingsById.has(recipient.id)) return false;
      return venueNotificationEnabled(venueSettingsById.get(recipient.id), row, channel);
    }
    if (recipient.role !== "customer") return true;
    if (!settingsById.has(recipient.id)) return false;
    const settings = settingsById.get(recipient.id);
    const key = followAlertKey((row.payload as Record<string, unknown> | null)?.kind);
    const preference = channel === "emailEnabled" && key ? "followEmailEnabled" : channel;
    return customerNotificationSettings(settings)[preference] && (!key || customerFollowAlertEnabled(settings, key));
  };
  const pushRows = rows.filter(row => allowed(row, "pushEnabled"));
  const push = options.push === false ? 0 : await deliverPushNotifications(client, pushRows);
  let venueEmailQueued = false;
  if (options.email !== false && recipients.some(recipient => recipient.role === "venue")
    && rows.some(row => (row.payload as Record<string, unknown> | null)?.kind !== "internal_table_request")) {
    // The notification insert and email receipt commit together. The worker
    // retries delivery independently of push and the HTTP request lifetime.
    const queue = await client.rpc("venue_email_queue_ready");
    if (queue.error && !["PGRST202", "42883"].includes(queue.error.code)) throw queue.error;
    venueEmailQueued = queue.data === true;
  }
  const emailRows = rows.filter(row => allowed(row, "emailEnabled") && (!venueEmailQueued
    || recipientById.get(row.recipient_id)?.role !== "venue"
    || (row.payload as Record<string, unknown> | null)?.kind === "internal_table_request"));
  const email = options.email === false ? 0 : await deliverEmailNotifications(client, emailRows, recipients);

  return { push, email };
}

export async function sendTransactionalEmail(input: {
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { delivered: false, reason: "email_not_configured" as const };

  const response = await requestDeliveryProvider("resend", "https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    }),
  });

  if (!response) {
    return { delivered: false, reason: "provider_unavailable" as const };
  }
  if (!response.ok) {
    logProviderRejection("resend", response.status);
    return { delivered: false, reason: "provider_rejected" as const };
  }

  return { delivered: true as const };
}

export async function sendShuttlePhoneAlert(input: { phone: string; requestId: string }) {
  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  const from = process.env.ONESIGNAL_SMS_FROM;
  if (!appId || !apiKey || !from) return false;
  const response = await requestDeliveryProvider("onesignal", "https://api.onesignal.com/notifications", {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId, target_channel: "sms", sms_from: from,
      include_phone_numbers: [input.phone],
      contents: { en: `MyDancr: new free shuttle request. View guest contact and pickup details securely: ${publicAppUrl()}/dashboard/venue. The club confirms the ride.` },
      idempotency_key: input.requestId,
    }),
  });
  return response?.created === true;
}

async function getRecipients(client: DancrClient, recipientIds: string[]): Promise<Recipient[]> {
  const ids = Array.from(new Set(recipientIds));
  if (!ids.length) return [];

  const { data, error } = await (client as any)
    .from("app_users")
    .select("id, email, role")
    .in("id", ids)
    .eq("account_state", "active");

  if (error) throw error;
  return data || [];
}

async function deliverPushNotifications(client: DancrClient, rows: NotificationDeliveryRow[]) {
  let delivered = 0;
  for (const row of rows) {
    const shuttleRequest = (row.payload as Record<string, unknown> | null)?.kind === "club_shuttle_request";
    const tableRequest = ["internal_table_request", "dancer_table_request"].includes(String((row.payload as Record<string, unknown> | null)?.kind));
    if (await deliverWebPush(client, row.recipient_id, {
      title: row.title,
      body: shuttleRequest ? "New free shuttle request. Open your club dashboard to contact the guest and confirm pickup." : row.body,
      url: notificationActionUrl(row) || publicAppUrl(), ttl: tableRequest ? 60 : 3600,
    }, row.deliveryId)) delivered += 1;
  }
  return delivered;
}

async function deliverEmailNotifications(client: DancrClient, rows: NotificationDeliveryRow[], recipients: Recipient[]) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return 0;

  const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  let delivered = 0;

  for (const row of rows) {
    const recipient = recipientById.get(row.recipient_id);
    let email = recipient?.email;
    if (!email) continue;
    let unsubscribeUrl = "", oneClickUrl = "";
    if (recipient?.role === "customer") {
      // Fresh consent, verified address and withdrawal check immediately before each send.
      try {
        const { data, error } = await client.rpc("customer_email_channel_delivery_target", {
          p_user_id: row.recipient_id,
          p_channel: followAlertKey((row.payload as Record<string, unknown> | null)?.kind) ? "follow" : "marketing",
        });
        if (error || !data || typeof data.email !== "string" || !/^[a-f0-9]{64}$/.test(data.token || "")) continue;
        email = data.email;
        unsubscribeUrl = `${publicAppUrl()}/email-preferences/${data.token}`;
        oneClickUrl = `${publicAppUrl()}/api/public/customer-email?token=${data.token}`;
      } catch { continue; }
    }
    const actionUrl = notificationActionUrl(row);
    let text = actionUrl ? `${row.body}\n\nOpen your Dancr dashboard:\n${actionUrl}` : row.body;
    let html = actionUrl
      ? `<p>${escapeHtml(row.body)}</p><p><a href="${escapeHtml(actionUrl)}">Open your Dancr dashboard</a></p>`
      : undefined;
    if (unsubscribeUrl) {
      text += `\n\nUnsubscribe from optional MyDancr emails (no sign-in needed):\n${unsubscribeUrl}`;
      html = (html || `<p>${escapeHtml(row.body)}</p>`) + `<p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from optional MyDancr emails</a> (no sign-in needed)</p>`;
    }

    const response = await requestDeliveryProvider("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(row.deliveryId && ["dancer_table_request", "internal_table_request"].includes(String((row.payload as Record<string, unknown> | null)?.kind))
          ? { "Idempotency-Key": `notification/${row.deliveryId}` } : {}),
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: row.title,
        text,
        ...(oneClickUrl ? { headers: { "List-Unsubscribe": `<${oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
        ...(html ? { html } : {}),
      }),
    });

    if (!response) continue;
    if (!response.ok) {
      logProviderRejection("resend", response.status);
      continue;
    }
    delivered += 1;
  }

  return delivered;
}

async function requestDeliveryProvider(
  provider: "resend" | "onesignal",
  url: string,
  init: RequestInit,
) {
  try {
    const signal = AbortSignal.timeout(DELIVERY_PROVIDER_TIMEOUT_MS);
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal,
    });
    try {
      const created = provider === "onesignal" && response.ok
        ? await hasCreatedPushMessage(response, signal)
        : null;
      return { ok: response.ok, status: response.status, created };
    } finally {
      // Resend callers only use HTTP acceptance. OneSignal success bodies have
      // been read above; discard every remaining body without waiting on cleanup.
      try {
        void response.body?.cancel().catch(() => {});
      } catch {
        // Cleanup cannot reclassify an already acknowledged response.
      }
    }
  } catch {
    console.warn("NOTIFICATION_PROVIDER_REQUEST_FAILED", { provider });
    return null;
  }
}

async function hasCreatedPushMessage(response: Response, signal: AbortSignal) {
  if (signal.aborted) throw new Error("NOTIFICATION_RESPONSE_ABORTED");
  if (!response.body) return false;
  const maxBytes = 64 * 1024;
  const maxChunks = 4096;
  const reader = response.body.getReader();
  const cancelRead = () => {
    try { void reader.cancel().catch(() => {}); } catch { /* No cleanup wait. */ }
  };
  signal.addEventListener("abort", cancelRead, { once: true });
  let complete = false;
  try {
    const bytes = new Uint8Array(maxBytes);
    let total = 0;
    let chunkCount = 0;
    for (;;) {
      if (signal.aborted) throw new Error("NOTIFICATION_RESPONSE_ABORTED");
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("NOTIFICATION_RESPONSE_ABORTED");
      if (done) { complete = true; break; }
      // Count empty chunks too; they must not evade the finite byte budget.
      if (++chunkCount > maxChunks || !(value instanceof Uint8Array) || total + value.byteLength > maxBytes) {
        throw new Error("NOTIFICATION_RESPONSE_TOO_LARGE");
      }
      bytes.set(value, total);
      total += value.byteLength;
    }
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total)));
    const id = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).id : undefined;
    // A created message can include warnings for individual subscriptions.
    return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  } finally {
    signal.removeEventListener("abort", cancelRead);
    if (!complete) cancelRead();
    reader.releaseLock();
  }
}

function logProviderRejection(provider: "resend" | "onesignal", status: number) {
  console.warn("NOTIFICATION_PROVIDER_REJECTED", { provider, status });
}

function notificationActionUrl(row: NotificationDeliveryRow) {
  const payload = (row.payload || {}) as Record<string, unknown>;
  const baseUrl = publicAppUrl();
  if (!baseUrl) return "";
  if (payload.kind === "club_shuttle_request") return `${baseUrl}/dashboard/venue#venue-pickups`;
  if (payload.kind === "internal_table_request") return `${baseUrl}/dashboard/venue#table-requests`;
  if (payload.kind === "dancer_table_request") return `${baseUrl}/dashboard/dancer#dancer-notifications`;
  if (payload.kind === "vip_request" || payload.kind === "vip_request_updated" || payload.kind === "vip_nickname_changed") return `${baseUrl}/dashboard/venue#venue-vip`;
  if (payload.kind === "vip_request_status") return `${baseUrl}/vip`;
  if (payload.kind === "vip_dancer_request") return `${baseUrl}/dashboard/dancer#dancer-account`;
  if (payload.kind === "vip_dancer_working_now") return `${baseUrl}/vip?venueId=${encodeURIComponent(String(payload.venueId || ""))}#vip-plan`;
  if (followAlertKey(payload.kind)) return `${baseUrl}/dashboard/customer#customer-alerts`;

  if (row.notification_type === "dmca_status" && payload.caseId) {
    return `${baseUrl}/dmca/counter/${encodeURIComponent(String(payload.caseId))}`;
  }
  if (row.notification_type === "venue_claim_status") {
    if (payload.status === "approved") return `${baseUrl}/dashboard/venue`;
    if (payload.venueSlug) {
      return `${baseUrl}/venues/${encodeURIComponent(String(payload.venueSlug))}/claim`;
    }
    return `${baseUrl}/`;
  }
  if (row.notification_type !== "approval_status") return "";
  if (payload.kind === "dancer_media_rejected") {
    const path = String(payload.emailPath || "");
    return `${baseUrl}${/^\/dashboard\/dancer#dancer-(?:main-photo|photos-title|videos-title)$/.test(path) ? path : "/dashboard/dancer#dancer-photos-title"}`;
  }
  if (payload.event === "venue_page_review") return `${baseUrl}/dashboard/venue#venue-publication`;
  if (payload.event === "venue_page_published") return `${baseUrl}/dashboard/venue`;

  const params = new URLSearchParams({
    dancr_dashboard: "dancer",
    dancr_status: String(payload.status || ""),
    dancr_step: String(payload.setupStep || (payload.status === "approved" ? "approved" : "approval")),
  });
  if (payload.targetType) params.set("dancr_target_type", String(payload.targetType));
  if (payload.targetId) params.set("dancr_target_id", String(payload.targetId));
  if (payload.label) params.set("dancr_label", String(payload.label));
  return `${baseUrl}/?${params.toString()}`;
}

function escapeHtml(value: unknown) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
