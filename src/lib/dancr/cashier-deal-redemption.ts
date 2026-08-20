import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDealRedemptionAttribution } from "./deal-redemption-attribution";
import {
  enforceDealGenerationRateLimit,
  getActiveClubDealByIdForVenue,
  issueAndConfirmDealRedemptionFromNfc,
} from "./deals";
import type { DealSourceType } from "./types";
import { createRequestSupabaseContext, getBearerToken } from "../supabase/request";

type DancrClient = SupabaseClient;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CashierDealRedemptionInput = {
  venueId: string;
  nfcTagId: string;
  dealId: string;
  sourceType: DealSourceType;
  dancerId: string | null;
  attributionToken: string;
  sessionId: string;
  request: Request;
};

export class CashierDealRedemptionError extends Error {
  readonly status: 400 | 404;

  constructor(message: string, status: 400 | 404) {
    super(message);
    this.name = "CashierDealRedemptionError";
    this.status = status;
  }
}

export async function completeCashierDealRedemption(
  client: DancrClient,
  input: CashierDealRedemptionInput,
) {
  const dealId = input.dealId.trim();
  if (!UUID_PATTERN.test(dealId)) {
    throw new CashierDealRedemptionError("Choose an active Club Deal.", 400);
  }

  await enforceDealGenerationRateLimit(client, input.request, dealId);
  const deal = await getActiveClubDealByIdForVenue(client, input.venueId, dealId);
  if (!deal) {
    throw new CashierDealRedemptionError("This Club Deal is no longer active.", 404);
  }

  const attribution = await resolveDealRedemptionAttribution(client, {
    sourceType: input.sourceType,
    dancerId: input.dancerId,
    attributionToken: input.attributionToken,
    venueId: input.venueId,
    dealId,
  });
  const customerId = await optionalCustomerId(input.request, client);

  const confirmation = await issueAndConfirmDealRedemptionFromNfc(client, {
    clubDealId: deal.id,
    venueId: input.venueId,
    dealTitle: deal.dealTitle,
    dealDescription: deal.dealDescription,
    dealTerms: deal.dealTerms,
    dealOfferType: deal.offerType,
    sourceType: attribution.sourceType,
    dancerId: attribution.dancerId,
    shiftId: attribution.shiftId,
    customerId,
    sessionId: input.sessionId,
    campaignSource: "venue_nfc",
    nfcTagId: input.nfcTagId,
    request: input.request,
  });

  return {
    deal,
    confirmation,
    sourceType: attribution.sourceType,
  };
}

async function optionalCustomerId(request: Request, client: DancrClient) {
  if (!getBearerToken(request)) return null;
  try {
    const { user } = await createRequestSupabaseContext(request);
    const { data, error } = await client
      .from("app_users")
      .select("role, account_state")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    return data?.role === "customer" && data?.account_state === "active" ? user.id : null;
  } catch {
    return null;
  }
}
