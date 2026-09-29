import "server-only";
import { webPushConfig } from "./web-push-config";

export function notificationPushDelivery(_userId: string) {
  const config = webPushConfig();
  const pushAvailable = Boolean(config);
  return {
    pushAvailable,
    ...(config ? { pushPublicKey: config.publicKey } : {}),
  };
}

export function customerNotificationDelivery(userId: string, email?: string) {
  const emailAvailable = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && email);
  return {
    emailAvailable, ...notificationPushDelivery(userId),
  };
}
