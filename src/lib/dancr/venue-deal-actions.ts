import type { SupabaseClient } from "@supabase/supabase-js";
import { clubDealOfferPresetForTitle } from "./club-deal-presets";
import { QR_COMMISSION_POLICY_VERSION } from "./commission-policy";
import { assertLiquorFreeClubDeal } from "./deal-policy";
import {
  CLUB_DEAL_COLUMNS,
  getVenueDealsForAccount,
  readIssuedDealSnapshot,
  toClubDeal,
} from "./deals";
import { getVenueReferralFeeState } from "./referral-fees";
import type { ClubDeal, ClubDealOfferType } from "./types";
import { requireVenueAccess } from "./venue-access";

type DancrClient = SupabaseClient;

export type VenueDealInput = {
  dealId?: string | null;
  dealTitle: string;
  dealDescription: string;
  dealTerms?: string | null;
  isActive: boolean;
  offerType: ClubDealOfferType;
  sortOrder?: number;
};

export async function updateVenueDealForAccount(
  client: DancrClient,
  userId: string,
  input: VenueDealInput,
) {
  const db = client as any;
  await requireVenueAccess(client, userId, "manage_deals");
  const owned = await getVenueDealsForAccount(client, userId);
  if (!owned) throw new Error("Venue profile not found.");

  const offerPreset = clubDealOfferPresetForTitle(input.dealTitle);
  if (!offerPreset) {
    throw new Error("Choose Half-off admission or Skip the line for this Club Deal.");
  }
  const dealTitle = offerPreset.title;
  const dealDescription = offerPreset.description;
  const dealTerms = optionalDealText(input.dealTerms, "Deal terms", 1200) || offerPreset.terms;
  const offerType: ClubDealOfferType = "admission";
  assertLiquorFreeClubDeal({ offerType, dealTitle, dealDescription, dealTerms });
  const sortOrder = Math.trunc(Number(input.sortOrder || 0));
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) {
    throw new Error("Offer order must be between 0 and 1000.");
  }
  const referralFee = (await getVenueReferralFeeState(client, owned.venueId)).current;
  if (input.isActive && !referralFee) {
    throw new Error("A MyDancr referral fee agreement is required before publishing a Club Deal.");
  }

  const row = {
    venue_id: owned.venueId,
    deal_title: dealTitle,
    deal_description: dealDescription,
    deal_terms: dealTerms,
    is_active: Boolean(input.isActive),
    redemption_rules: {
      one_per_guest: true,
      authenticated_venue_confirmation_required: true,
      attribution_policy: "locked_at_issue",
      commission_policy: QR_COMMISSION_POLICY_VERSION,
    },
    payout_type: "flat",
    payout_amount_cents: referralFee?.feeCents || 0,
    currency: referralFee?.currency || "usd",
    offer_type: offerType,
    booking_url: null,
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  };

  const existingDeal = input.dealId
    ? owned.deals.find((deal) => deal.id === input.dealId)
    : null;
  if (input.dealId && !existingDeal) throw new Error("Club Deal not found for this venue.");
  if (existingDeal) await snapshotIssuedDealPassesBeforeUpdate(db, existingDeal);
  const query = existingDeal
    ? db.from("club_deals").update(row).eq("id", existingDeal.id).eq("venue_id", owned.venueId)
    : db.from("club_deals").insert(row);
  const { data, error } = await query
    .select(CLUB_DEAL_COLUMNS)
    .single();
  if (error) throw error;

  const deal = toClubDeal(data);
  const deals = [deal, ...owned.deals.filter((candidate) => candidate.id !== deal.id)]
    .sort((left, right) => left.sortOrder - right.sortOrder);

  return { deal, deals };
}

export async function deleteVenueDealForAccount(
  client: DancrClient,
  userId: string,
  dealId: string,
) {
  await requireVenueAccess(client, userId, "manage_deals");
  const owned = await getVenueDealsForAccount(client, userId);
  if (!owned || !owned.deals.some((deal) => deal.id === dealId)) {
    throw new Error("Club Deal not found for this venue.");
  }
  const { error } = await (client as any)
    .from("club_deals")
    .delete()
    .eq("id", dealId)
    .eq("venue_id", owned.venueId);
  if (error) throw error;
  return { id: dealId };
}

function optionalDealText(value: string | null | undefined, label: string, maximum: number) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  if (/[<>]/.test(text)) throw new Error(`${label} contains unsupported characters.`);
  return text;
}

async function snapshotIssuedDealPassesBeforeUpdate(db: any, deal: ClubDeal) {
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const { data, error } = await db
      .from("qr_redemptions")
      .select("id, audit")
      .eq("club_deal_id", deal.id)
      .eq("status", "generated")
      .gt("expires_at", new Date().toISOString())
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    const rows = data || [];
    const unsnapshotted = rows.filter((row: any) => !readIssuedDealSnapshot(row.audit));
    const snapshot = {
      dealTitle: deal.dealTitle,
      dealDescription: deal.dealDescription,
      dealTerms: deal.dealTerms,
      offerType: deal.offerType,
      bookingUrl: deal.bookingUrl,
    };
    for (let index = 0; index < unsnapshotted.length; index += 25) {
      const batch = unsnapshotted.slice(index, index + 25);
      const results = await Promise.all(batch.map((row: any) => db
        .from("qr_redemptions")
        .update({ audit: { ...(row.audit || {}), deal_snapshot: snapshot } })
        .eq("id", row.id)
        .eq("status", "generated")));
      const failed = results.find((result: any) => result.error);
      if (failed?.error) throw failed.error;
    }

    if (rows.length < pageSize) break;
    offset += rows.length;
  }
}
