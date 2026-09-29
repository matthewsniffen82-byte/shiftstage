import "server-only";
import { createECDH } from "node:crypto";

export function webPushConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  try {
    const contact = new URL(subject);
    if (!["https:", "mailto:"].includes(contact.protocol)) return null;
    const key = createECDH("prime256v1");
    key.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (key.getPublicKey().toString("base64url") !== publicKey) return null;
    return { publicKey, privateKey, subject };
  } catch { return null; }
}
