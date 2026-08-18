import { createHash, randomBytes, webcrypto } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "../env";
import type { PayoutInstruction, ProviderAccountState } from "./payout-provider";

type DancrClient = SupabaseClient;

type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type BitsafeClaims = {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  nonce?: unknown;
  aliastoken?: unknown;
};

type BitsafeAccountResponse = {
  aliastoken?: unknown;
  accountstatus?: unknown;
  countrycode?: unknown;
  eighteenplus?: unknown;
  idverifieddate?: unknown;
  peplistdate?: unknown;
  sanctiondate?: unknown;
  uksanctionlists?: unknown;
  unsanctionlists?: unknown;
  ussanctionlists?: unknown;
  eusanctionlists?: unknown;
  ibanserials?: unknown;
};

const BITSAFE_OIDC_ISSUER = "https://accounts.yoursafe.com";
const BITSAFE_API_ORIGIN = "https://api.yoursafe.com";
const OAUTH_STATE_LIFETIME_MINUTES = 10;
const REQUEST_TIMEOUT_MS = 15_000;

export async function createBitsafeOnboarding(
  client: DancrClient,
  input: { dancerId: string; userId: string; returnUrl: string; callbackUrl: string },
) {
  const discovery = await getBitsafeDiscovery();
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + OAUTH_STATE_LIFETIME_MINUTES * 60_000);
  const stateHash = sha256(state);

  await (client as any).from("payout_provider_oauth_states").delete()
    .eq("payment_provider", "bitsafe")
    .eq("dancer_id", input.dancerId)
    .lt("expires_at", new Date().toISOString());

  const { error } = await (client as any).from("payout_provider_oauth_states").insert({
    payment_provider: "bitsafe",
    dancer_id: input.dancerId,
    user_id: input.userId,
    state_hash: stateHash,
    nonce,
    return_url: input.returnUrl,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw error;

  const authorizeUrl = new URL(discovery.authorization_endpoint);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", getServerEnv("BITSAFE_CLIENT_ID"));
  authorizeUrl.searchParams.set("redirect_uri", input.callbackUrl);
  authorizeUrl.searchParams.set("scope", "openid default");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("nonce", nonce);

  return { url: authorizeUrl.toString(), expiresAt: Math.floor(expiresAt.getTime() / 1000) };
}

export async function completeBitsafeOnboarding(
  client: DancrClient,
  input: { code: string; state: string; callbackUrl: string },
) {
  const { data: consumed, error } = await (client as any).rpc("consume_payout_provider_oauth_state", {
    p_payment_provider: "bitsafe",
    p_state_hash: sha256(input.state),
  });
  if (error) throw error;
  const oauthState = Array.isArray(consumed) ? consumed[0] : consumed;
  if (!oauthState) throw new Error("This payout setup link is invalid or expired.");

  const discovery = await getBitsafeDiscovery();
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.callbackUrl,
    client_id: getServerEnv("BITSAFE_CLIENT_ID"),
    client_secret: getServerEnv("BITSAFE_CLIENT_SECRET"),
  });
  const tokenResponse = await fetchWithTimeout(discovery.token_endpoint, {
    method: "PUT",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: tokenBody,
    cache: "no-store",
  });
  const tokenPayload = await jsonObject(tokenResponse);
  if (!tokenResponse.ok || typeof tokenPayload.id_token !== "string") {
    throw new Error("Bitsafe could not complete secure payout setup.");
  }

  const claims = await verifyBitsafeIdToken(tokenPayload.id_token, discovery, String(oauthState.nonce));
  const aliasToken = normalizeAliasToken(String(claims.aliastoken || claims.sub || ""));
  const account = await getBitsafeAccountState(aliasToken);
  return {
    dancerId: String(oauthState.dancer_id),
    userId: String(oauthState.user_id),
    returnUrl: String(oauthState.return_url),
    account,
  };
}

export async function getBitsafeAccountState(providerAccountId: string): Promise<ProviderAccountState> {
  const aliasToken = normalizeAliasToken(providerAccountId);
  const response = await fetchWithTimeout(`https://${aliasToken}/?json=1`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const payload = await jsonObject(response) as BitsafeAccountResponse;
  if (!response.ok) throw new Error("Bitsafe account verification is temporarily unavailable.");

  const accountActive = lower(payload.accountstatus) === "active";
  const ageVerified = payload.eighteenplus === true;
  const hasReceivingAccount = Array.isArray(payload.ibanserials) && payload.ibanserials.length > 0;
  const screeningsClear = [
    payload.uksanctionlists,
    payload.unsanctionlists,
    payload.ussanctionlists,
    payload.eusanctionlists,
  ].every((value) => lower(value) === "negative");
  const verified = accountActive && ageVerified && hasReceivingAccount && screeningsClear;
  const restricted = !accountActive || !ageVerified || !screeningsClear;
  const lastError = !accountActive
    ? "Your Bitsafe payout account is not active."
    : !ageVerified
      ? "Bitsafe must verify payout eligibility before cash out is available."
      : !hasReceivingAccount
        ? "Finish opening your Bitsafe receiving account to enable payouts."
        : !screeningsClear
          ? "Your Bitsafe payout account needs review."
          : null;

  return {
    providerAccountId: aliasToken,
    country: upper(payload.countrycode) || "US",
    currency: "usd",
    onboardingStatus: verified ? "complete" : restricted ? "restricted" : "pending",
    payoutEligibility: verified ? "eligible" : restricted ? "restricted" : "pending",
    verificationStatus: verified ? "verified" : restricted ? "restricted" : "pending",
    detailsSubmitted: true,
    chargesEnabled: false,
    payoutsEnabled: verified,
    lastError,
    providerStatus: {
      accountActive,
      ageVerified,
      receivingAccountPresent: hasReceivingAccount,
      screeningsClear,
      identityVerifiedAt: text(payload.idverifieddate),
      pepScreenedAt: text(payload.peplistdate),
      sanctionsScreenedAt: text(payload.sanctiondate),
    },
  };
}

export async function createBitsafePayoutInstruction(input: PayoutInstruction) {
  const aliasToken = normalizeAliasToken(input.providerAccountId);
  const beneficiaryAliasToken = aliasToken.slice(0, -".yoursafe.id".length);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Bitsafe payout amount is invalid.");
  }
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Bitsafe payout currency is invalid.");
  const reference = input.payoutId.replaceAll("-", "").slice(0, 40);
  const instruction = [{
    group: "mydancr_payouts",
    transfer_method: "INTERNAL",
    reference,
    amount: centsToDecimal(input.amountCents),
    currency,
    beneficiary_alias_token: beneficiaryAliasToken,
    note_for_beneficiary: "MyDancr dancer earnings payout",
  }];
  const credentials = `${getServerEnv("BITSAFE_API_USERNAME")}:${getServerEnv("BITSAFE_API_PASSWORD")}`;
  const response = await fetchWithTimeout(`${BITSAFE_API_ORIGIN}/mass-payment-api/upload`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(instruction),
    cache: "no-store",
  });
  const payload = await jsonObject(response);
  if (!response.ok && !isDuplicateReferenceResponse(payload)) {
    throw new Error(`Bitsafe rejected the payout instruction (${response.status}).`);
  }
  if (response.ok && payload.success !== true) {
    throw new Error("Bitsafe did not accept the payout instruction.");
  }
  return { providerReferenceId: `bitsafe:${reference}` };
}

async function verifyBitsafeIdToken(token: string, discovery: OidcDiscovery, expectedNonce: string): Promise<BitsafeClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Bitsafe returned an invalid identity token.");
  const header = decodeJwtPart(parts[0]) as { alg?: unknown; kid?: unknown };
  const claims = decodeJwtPart(parts[1]) as BitsafeClaims;
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Bitsafe returned an unsupported identity signature.");
  }
  const jwksResponse = await fetchWithTimeout(discovery.jwks_uri, { cache: "no-store" });
  const jwks = await jsonObject(jwksResponse);
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const jwk = keys.find((key) => key && typeof key === "object" && (key as { kid?: unknown }).kid === header.kid);
  if (!jwk) throw new Error("Bitsafe identity signing key is unavailable.");
  const cryptoKey = await webcrypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureValid = await webcrypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    Buffer.from(parts[2], "base64url"),
    Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"),
  );
  if (!signatureValid) throw new Error("Bitsafe identity verification failed.");

  const clientId = getServerEnv("BITSAFE_CLIENT_ID");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== discovery.issuer || !audience.includes(clientId)) throw new Error("Bitsafe identity token is not intended for MyDancr.");
  if (typeof claims.exp !== "number" || claims.exp <= now - 30) throw new Error("Bitsafe identity token has expired.");
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) throw new Error("Bitsafe identity token is not active yet.");
  if (claims.nonce !== expectedNonce) throw new Error("Bitsafe payout setup could not be matched to this request.");
  return claims;
}

async function getBitsafeDiscovery(): Promise<OidcDiscovery> {
  const response = await fetchWithTimeout(`${BITSAFE_OIDC_ISSUER}/.well-known/openid-configuration`, { cache: "no-store" });
  const payload = await jsonObject(response);
  const discovery = {
    issuer: text(payload.issuer),
    authorization_endpoint: text(payload.authorization_endpoint),
    token_endpoint: text(payload.token_endpoint),
    jwks_uri: text(payload.jwks_uri),
  };
  if (!response.ok || discovery.issuer !== BITSAFE_OIDC_ISSUER) throw new Error("Bitsafe secure onboarding is unavailable.");
  for (const endpoint of [discovery.authorization_endpoint, discovery.token_endpoint, discovery.jwks_uri]) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.hostname !== "accounts.yoursafe.com") {
      throw new Error("Bitsafe returned an invalid secure onboarding endpoint.");
    }
  }
  return discovery;
}

function normalizeAliasToken(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.yoursafe\.id$/.test(normalized)) {
    throw new Error("Bitsafe payout account reference is invalid.");
  }
  return normalized;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Bitsafe did not respond in time.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({}));
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

function isDuplicateReferenceResponse(payload: unknown) {
  const messages = collectStrings(payload).map((value) => value.toLowerCase());
  return messages.length > 0 && messages.every((value) => value.includes("duplicate unique identifier"));
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

function centsToDecimal(cents: number) {
  const whole = Math.floor(cents / 100);
  return `${whole}.${String(cents % 100).padStart(2, "0")}`;
}

function decodeJwtPart(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function lower(value: unknown) {
  return text(value).trim().toLowerCase();
}

function upper(value: unknown) {
  return text(value).trim().toUpperCase();
}
