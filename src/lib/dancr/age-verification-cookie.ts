export const AGE_VERIFICATION_COOKIE_NAME = "mydancr_age_verified";

export type AgeVerificationClaims = {
  v: 1;
  provider: "yoti";
  referenceId: string;
  verifiedAt: number;
  expiresAt: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function createAgeVerificationCookieValue(
  referenceId: string,
  secret: string,
  lifetimeSeconds: number,
  now = Date.now(),
) {
  assertCookieSecret(secret);
  const claims: AgeVerificationClaims = {
    v: 1,
    provider: "yoti",
    referenceId,
    verifiedAt: now,
    expiresAt: now + lifetimeSeconds * 1_000,
  };
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signature = await sign(payload, secret);
  return `${payload}.${base64UrlEncode(signature)}`;
}

export async function verifyAgeVerificationCookieValue(
  value: string | null | undefined,
  secret: string,
  now = Date.now(),
): Promise<AgeVerificationClaims | null> {
  if (!value || secret.length < 32) return null;
  const [payload, encodedSignature, extra] = value.split(".");
  if (!payload || !encodedSignature || extra) return null;

  try {
    const expected = await sign(payload, secret);
    const received = base64UrlDecode(encodedSignature);
    if (!constantTimeEqual(expected, received)) return null;

    const claims = JSON.parse(decoder.decode(base64UrlDecode(payload))) as Partial<AgeVerificationClaims>;
    if (
      claims.v !== 1
      || claims.provider !== "yoti"
      || typeof claims.referenceId !== "string"
      || !/^[0-9a-f-]{36}$/i.test(claims.referenceId)
      || typeof claims.verifiedAt !== "number"
      || typeof claims.expiresAt !== "number"
      || claims.verifiedAt > now + 5 * 60 * 1_000
      || claims.expiresAt <= now
      || claims.expiresAt <= claims.verifiedAt
    ) {
      return null;
    }
    return claims as AgeVerificationClaims;
  } catch {
    return null;
  }
}

export function ageVerificationCookieLifetimeSeconds() {
  const configured = Number.parseInt(process.env.YOTI_AGE_COOKIE_DAYS || "30", 10);
  const days = Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 365) : 30;
  return days * 24 * 60 * 60;
}

export function ageVerificationCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ageVerificationCookieLifetimeSeconds(),
  };
}

export function isYotiAgeVerificationEnabled() {
  return process.env.YOTI_AGE_VERIFICATION_ENABLED?.trim().toLowerCase() === "true";
}

function assertCookieSecret(secret: string) {
  if (secret.length < 32) {
    throw new Error("YOTI_AGE_COOKIE_SECRET must contain at least 32 characters.");
  }
}

async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value.");
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
