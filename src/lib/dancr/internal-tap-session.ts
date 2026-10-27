import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "../server-env";

export const INTERNAL_ACCESS_SECONDS = 60 * 60;
export const INTERNAL_ACCESS_MESSAGE = "Tap the club’s NFC sticker to open the internal grid. Access lasts one hour.";
export const INTERNAL_EXPIRED_MESSAGE = "Your one-hour access has ended. Tap the club’s NFC sticker again.";
export type InternalTapGrant = { link: string; token: string; tag: string | null; generation: string | null; actor: string | null; issued: number; expires: number };
const key = (purpose: string) => createHmac("sha256", getServerEnv("SUPABASE_SERVICE_ROLE_KEY")).update(`mydancr:internal-nfc:${purpose}:v1`).digest();
const sign = (value: string) => createHmac("sha256", key("session")).update(value).digest();
export const internalCookieName = (token: string) => `md_internal_${token}`;
export function createInternalGrant(input: Omit<InternalTapGrant, "issued" | "expires">, now = Date.now()) {
  const grant: InternalTapGrant = { ...input, issued: Math.floor(now / 1000), expires: Math.floor(now / 1000) + INTERNAL_ACCESS_SECONDS };
  const value = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return { grant, value: `${value}.${sign(value).toString("base64url")}` };
}
export function readInternalGrant(request: Request, token: string, now = Date.now()): InternalTapGrant | null {
  const value = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${internalCookieName(token)}=`))?.split("=").slice(1).join("=");
  if (!value || value.length > 2048) return null;
  const [payload, signature, extra] = value.split(".");
  if (extra !== undefined || !payload || !/^[\w-]{43}$/.test(signature || "")) return null;
  const received = Buffer.from(signature, "base64url");
  if (received.length !== 32 || !timingSafeEqual(received, sign(payload))) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString()) as InternalTapGrant;
    const seconds = Math.floor(now / 1000);
    if (grant.token !== token || typeof grant.link !== "string" || !Number.isInteger(grant.issued) || !Number.isInteger(grant.expires)
      || grant.expires - grant.issued !== INTERNAL_ACCESS_SECONDS || grant.issued > seconds || grant.expires <= seconds
      || !(grant.actor === null ? typeof grant.tag === "string" && typeof grant.generation === "string" : typeof grant.actor === "string" && grant.tag === null && grant.generation === null)) return null;
    return grant;
  } catch { return null; }
}
export function internalGrantCookie(token: string, value: string, secure = true) {
  return `${internalCookieName(token)}=${value}; Path=/; Max-Age=${INTERNAL_ACCESS_SECONDS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
export type InternalTagKeys = { adminKey: string; metaKey: string; fileKey: string };
export function sealInternalTagKeys(id: string, keys: InternalTagKeys) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key("keys"), iv);
  cipher.setAAD(Buffer.from(id));
  const data = Buffer.concat([cipher.update(JSON.stringify(keys), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function openInternalTagKeys(id: string, value: string): InternalTagKeys {
  const data = Buffer.from(value, "base64url"), cipher = createDecipheriv("aes-256-gcm", key("keys"), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(id)); cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
}
