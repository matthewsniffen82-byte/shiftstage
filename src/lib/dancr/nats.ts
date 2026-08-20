export type CommissionSettlementProvider = "mydancr" | "nats";

export type NatsRuntimeConfig = {
  settlementProvider: CommissionSettlementProvider;
  selected: boolean;
  configured: boolean;
  baseUrl: string | null;
  affiliatePortalUrl: string | null;
  apiUsername: string | null;
  apiKey: string | null;
};

export type NatsInvoiceResult = {
  result: string;
  responseMetadata: Record<string, unknown>;
};

export class NatsDefiniteRejectionError extends Error {
  readonly responseMetadata: Record<string, unknown>;

  constructor(message: string, responseMetadata: Record<string, unknown>) {
    super(message);
    this.name = "NatsDefiniteRejectionError";
    this.responseMetadata = responseMetadata;
  }
}

export class NatsAmbiguousDispatchError extends Error {
  readonly responseMetadata: Record<string, unknown>;

  constructor(message: string, responseMetadata: Record<string, unknown> = {}) {
    super(message);
    this.name = "NatsAmbiguousDispatchError";
    this.responseMetadata = responseMetadata;
  }
}

export function getNatsRuntimeConfig(): NatsRuntimeConfig {
  const settlementProvider = normalizedSettlementProvider(process.env.COMMISSION_SETTLEMENT_PROVIDER);
  const baseUrl = normalizedHttpsUrl(process.env.NATS_BASE_URL);
  const affiliatePortalUrl = normalizedHttpsUrl(process.env.NATS_AFFILIATE_PORTAL_URL);
  const apiUsername = trimmed(process.env.NATS_API_USERNAME);
  const apiKey = trimmed(process.env.NATS_API_KEY);
  const selected = settlementProvider === "nats";
  return {
    settlementProvider,
    selected,
    configured: Boolean(selected && baseUrl && affiliatePortalUrl && apiUsername && apiKey),
    baseUrl,
    affiliatePortalUrl,
    apiUsername,
    apiKey,
  };
}

export async function createNatsManualInvoice(input: {
  loginId: number;
  amountCents: number;
  currency: string;
}): Promise<NatsInvoiceResult> {
  const config = getNatsRuntimeConfig();
  if (!config.selected) throw new Error("NATS is not the selected commission settlement platform.");
  if (!config.configured || !config.baseUrl || !config.apiUsername || !config.apiKey) {
    throw new Error("NATS commission export credentials are incomplete.");
  }
  if (!Number.isSafeInteger(input.loginId) || input.loginId < 1) throw new Error("NATS affiliate login ID is invalid.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1) throw new Error("NATS commission amount is invalid.");
  if (input.currency.toLowerCase() !== "usd") throw new Error("NATS commission exports currently require USD.");

  const body = new URLSearchParams({
    loginid: String(input.loginId),
    amount: (input.amountCents / 100).toFixed(2),
  });
  let response: Response;
  try {
    response = await fetch(new URL("/api/v1/affiliate/invoice", config.baseUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "api-username": config.apiUsername,
        "api-key": config.apiKey,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new NatsAmbiguousDispatchError(
      `NATS did not return a response. Verify the affiliate invoice before retrying: ${safeError(error)}`,
    );
  }

  const responseMetadata = {
    http_status: response.status,
    content_type: response.headers.get("content-type") || null,
  };
  const payload = await readNatsJson(response);
  const result = typeof payload?.result === "string" ? payload.result.trim() : "";
  if (response.ok && /successfully added manual invoice/i.test(result)) {
    return { result, responseMetadata };
  }
  const message = result || safeNatsMessage(payload) || `NATS rejected the invoice with HTTP ${response.status}.`;
  if (response.status >= 400 && response.status < 500) {
    throw new NatsDefiniteRejectionError(message, responseMetadata);
  }
  throw new NatsAmbiguousDispatchError(
    `${message} Verify the affiliate invoice in NATS before retrying.`,
    responseMetadata,
  );
}

function normalizedSettlementProvider(value: string | undefined): CommissionSettlementProvider {
  return value?.trim().toLowerCase() === "nats" ? "nats" : "mydancr";
}

function normalizedHttpsUrl(value: string | undefined) {
  const candidate = trimmed(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const localDevelopment = process.env.NODE_ENV !== "production"
      && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localDevelopment) return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function trimmed(value: string | undefined) {
  const result = value?.trim();
  return result || null;
}

async function readNatsJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = (await response.text()).slice(0, 5_000);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function safeNatsMessage(payload: Record<string, unknown> | null) {
  if (!payload) return null;
  for (const key of ["error", "message"]) {
    if (typeof payload[key] === "string") return String(payload[key]).slice(0, 500);
  }
  return null;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "network request failed";
}
