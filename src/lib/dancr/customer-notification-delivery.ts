import "server-only";
import { createHmac } from "node:crypto";

export function customerPushExternalId(userId: string) {
  const key = process.env.ONESIGNAL_REST_API_KEY;
  if (!key) return "";
  // Public dancer/customer IDs cannot be used to enroll someone else's alerts.
  return `customer_${createHmac("sha256", key).update(`mydancr:push:${userId}`).digest("hex")}`;
}

export function customerNotificationDelivery(userId: string, email?: string) {
  const emailAvailable = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && email);
  const pushAvailable = Boolean(process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID && process.env.ONESIGNAL_REST_API_KEY);
  return {
    emailAvailable, pushAvailable,
    ...(pushAvailable ? { pushAppId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID, pushExternalId: customerPushExternalId(userId) } : {}),
  };
}
