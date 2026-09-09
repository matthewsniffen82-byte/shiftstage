// Runs before Next can substitute NEXT_PUBLIC_* values into browser assets.
// This module must never log or return environment values.
const PRIVATE_PUBLIC_NAME = /(?:SERVICE_ROLE|(?:^|_)(?:SECRET|PASSWORD|PRIVATE_KEY)(?:_|$)|ADMIN_(?:SIGNUP_CODE|SEED_KEY)|DATABASE_URL|(?:ACCESS|REFRESH)_TOKEN|(?:OPENAI|NATS|RESEND)_API_KEY|ONESIGNAL_REST_API_KEY|MEDIA_IMPORT_KEY)/;
const PRIVATE_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsb_secret_[A-Za-z0-9_-]+|\b(?:sk_live_|sk_test_|rk_live_|rk_test_|sk-proj-|sk-svcacct-|whsec_)[A-Za-z0-9_-]+)/;
const SECRET_SERVER_NAME = /(?:SECRET|PASSWORD|TOKEN|(?:^|_)KEY|ADMIN_SIGNUP_CODE)$/;

/** @param {Record<string, string | undefined>} environment */
export function validatePublicEnvironment(environment) {
  // Next also embeds this non-NEXT_PUBLIC setting through nextConfig.env.
  // Validate the complete allowed value set before it can enter a browser asset.
  const moderationMode = environment.DANCR_VIDEO_MODERATION_MODE?.trim().toLowerCase();
  if (moderationMode && !["ai", "demo_auto_approve"].includes(moderationMode)) {
    throw new Error("Public environment configuration rejected: DANCR_VIDEO_MODERATION_MODE must be ai or demo_auto_approve.");
  }
  const privateValues = Object.entries(environment)
    .filter(([name, value]) => !name.startsWith("NEXT_PUBLIC_")
      && SECRET_SERVER_NAME.test(name) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value);

  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith("NEXT_PUBLIC_") || !value) continue;
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch { /* Check the original if it is not URL encoded. */ }
    if (PRIVATE_PUBLIC_NAME.test(name) || PRIVATE_VALUE.test(decoded)
      || privateValues.some((secret) => secret && decoded.includes(secret))
      || containsPrivateJwt(decoded) || containsCredentialUrl(decoded)) {
      const label = /^[A-Z0-9_]+$/.test(name) ? name : "NEXT_PUBLIC variable";
      throw new Error(`Public environment configuration rejected: ${label} contains server-only configuration.`);
    }
  }
}

/** @param {string} value */
function containsPrivateJwt(value) {
  const tokens = value.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
  return tokens.some((token) => {
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      return payload?.role !== "anon";
    } catch { return false; }
  });
}

/** @param {string} value */
function containsCredentialUrl(value) {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:", "mysql:", "mongodb:", "redis:"].includes(url.protocol)
      || Boolean(url.username || url.password);
  } catch { return false; }
}
