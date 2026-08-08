const ACCESS_SESSION_VERSION = "v1";

export const SITE_ACCESS_COOKIE_NAME = "mydancr_site_access";
export const SITE_ACCESS_DEFAULT_SESSION_DAYS = 7;

export type SiteAccessConfiguration = {
  enabled: boolean;
  codeHash: string;
  secret: string;
  sessionDays: number;
};

export function siteAccessConfiguration(): SiteAccessConfiguration {
  const requestedDays = Number.parseInt(
    process.env.DANCR_SITE_ACCESS_SESSION_DAYS || "",
    10,
  );

  return {
    enabled: process.env.DANCR_SITE_ACCESS_GATE_ENABLED === "true",
    codeHash: (process.env.DANCR_SITE_ACCESS_CODE_HASH || "").trim().toLowerCase(),
    secret: (process.env.DANCR_SITE_ACCESS_SECRET || "").trim(),
    sessionDays:
      Number.isFinite(requestedDays) && requestedDays >= 1 && requestedDays <= 30
        ? requestedDays
        : SITE_ACCESS_DEFAULT_SESSION_DAYS,
  };
}

export function siteAccessConfigurationIsValid(
  configuration: SiteAccessConfiguration,
) {
  return (
    /^[a-f0-9]{64}$/.test(configuration.codeHash) &&
    configuration.secret.length >= 32
  );
}

export function safeSiteAccessReturnPath(value: string | null | undefined) {
  const candidate = (value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";

  try {
    const parsed = new URL(candidate, "https://www.mydancr.com");
    if (parsed.origin !== "https://www.mydancr.com") return "/";
    if (parsed.pathname === "/access") return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export async function createSiteAccessSession(
  secret: string,
  expiresAt: number,
) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${ACCESS_SESSION_VERSION}:${issuedAt}:${expiresAt}:${crypto.randomUUID()}`;
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(payload));
  const signature = await signPayload(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySiteAccessSession(
  token: string | null | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!token || !secret) return false;
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return false;

  const signatureIsValid = await verifySignature(
    secret,
    encodedPayload,
    signature,
  );
  if (!signatureIsValid) return false;

  try {
    const payload = new TextDecoder().decode(decodeBase64Url(encodedPayload));
    const [version, issuedAtText, expiresAtText, nonce, extraPayload] =
      payload.split(":");
    if (
      version !== ACCESS_SESSION_VERSION ||
      !nonce ||
      extraPayload ||
      !/^\d+$/.test(issuedAtText) ||
      !/^\d+$/.test(expiresAtText)
    ) {
      return false;
    }

    const issuedAt = Number(issuedAtText);
    const expiresAt = Number(expiresAtText);
    return (
      Number.isSafeInteger(issuedAt) &&
      Number.isSafeInteger(expiresAt) &&
      issuedAt <= nowSeconds + 60 &&
      expiresAt > nowSeconds &&
      expiresAt - issuedAt <= 31 * 24 * 60 * 60
    );
  } catch {
    return false;
  }
}

async function signPayload(secret: string, payload: string) {
  const key = await importSigningKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

async function verifySignature(
  secret: string,
  payload: string,
  signature: string,
) {
  try {
    const key = await importSigningKey(secret, ["verify"]);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signature),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

function importSigningKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid encoding.");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
