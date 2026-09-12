import "server-only";
import { createHmac } from "node:crypto";

export function notificationPushExternalId(userId: string) {
  const key = process.env.ONESIGNAL_REST_API_KEY;
  if (!key) return "";
  // Every role needs an opaque enrollment capability. Preserve the existing
  // namespace so enrolled customer devices continue receiving their alerts.
  return `customer_${createHmac("sha256", key).update(`mydancr:push:${userId}`).digest("hex")}`;
}

export const customerPushExternalId = notificationPushExternalId;

export function notificationPushDelivery(userId: string) {
  const pushAvailable = Boolean(process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID && process.env.ONESIGNAL_REST_API_KEY);
  return {
    pushAvailable,
    ...(pushAvailable ? { pushAppId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID, pushExternalId: notificationPushExternalId(userId) } : {}),
  };
}

export function customerNotificationDelivery(userId: string, email?: string) {
  const emailAvailable = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && email);
  return {
    emailAvailable, ...notificationPushDelivery(userId),
  };
}
