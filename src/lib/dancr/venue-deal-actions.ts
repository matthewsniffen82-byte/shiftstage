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

export type AdminVenueDealInput = VenueDealInput & {
  venueId: string;
};

export async function getAdminVenueDealCatalog(client: DancrClient) {
  const { data, error } = await (client as any)
    .from("club_deals")
    .select(`${CLUB_DEAL_COLUMNS}, venues(id, name, slug, city, state)`)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  return (data || []).map((row: any) => ({
    ...toClubDeal(row),
    createdAt: row.created_at ? String(row.created_at) : null,
    venue: Array.isArray(row.venues) ? row.venues[0] || null : row.venues || null,
  }));
}

export async function upsertAdminVenueDeal(
  client: DancrClient,
  input: AdminVenueDealInput,
) {
  const db = client as any;
  const venueId = requiredUuid(input.venueId, "A venue is required.");
  const dealId = input.dealId ? requiredUuid(input.dealId, "The Club Deal is invalid.") : null;
  const { data: venue, error: venueError } = await db
    .from("venues")
    .select("id, name")
    .eq("id", venueId)
    .maybeSingle();
  if (venueError) throw venueError;
  if (!venue) throw new Error("Venue not found.");

  const fields = validatedDealFields(input);
  const referralFee = (await getVenueReferralFeeState(client, venueId)).current;
  if (input.isActive && !referralFee) {
    throw new Error("Record the signed MyDancr referral fee agreement before publishing this Club Deal.");
  }

  const existingDeal = dealId ? await getAdminVenueDeal(client, venueId, dealId) : null;
  if (dealId && !existingDeal) throw new Error("Club Deal not found for this venue.");
  if (existingDeal) await snapshotIssuedDealPassesBeforeUpdate(db, existingDeal);

  const row = {
    venue_id: venueId,
    deal_title: fields.dealTitle,
    deal_description: fields.dealDescription,
    deal_terms: fields.dealTerms,
    is_active: Boolean(input.isActive),
    redemption_rules: {
      one_per_guest: true,
      authenticated_venue_confirmation_required: true,
      attribution_policy: "locked_at_issue",
      commission_policy: QR_COMMISSION_POLICY_VERSION,
      managed_by: "mydancr",
      agreement_reference: referralFee?.agreementReference || null,
    },
    payout_type: "flat",
    payout_amount_cents: referralFee?.feeCents || 0,
    currency: referralFee?.currency || "usd",
    offer_type: fields.offerType,
    booking_url: null,
    sort_order: fields.sortOrder,
    updated_at: new Date().toISOString(),
  };

  const query = existingDeal
    ? db.from("club_deals").update(row).eq("id", existingDeal.id).eq("venue_id", venueId)
    : db.from("club_deals").insert(row);
  const { data, error } = await query.select(CLUB_DEAL_COLUMNS).single();
  if (error) throw error;

  return {
    deal: toClubDeal(data),
    deals: await getAdminVenueDealCatalog(client),
    venueName: String(venue.name || "Venue"),
  };
}

export async function deleteAdminVenueDeal(
  client: DancrClient,
  venueIdValue: string,
  dealIdValue: string,
) {
  const venueId = requiredUuid(venueIdValue, "A venue is required.");
  const dealId = requiredUuid(dealIdValue, "The Club Deal is invalid.");
  const existingDeal = await getAdminVenueDeal(client, venueId, dealId);
  if (!existingDeal) throw new Error("Club Deal not found for this venue.");
  if (existingDeal.isActive) throw new Error("Pause this Club Deal before deleting it.");

  const { error } = await (client as any)
    .from("club_deals")
    .delete()
    .eq("id", dealId)
    .eq("venue_id", venueId);
  if (error) throw error;
  return { id: dealId, deals: await getAdminVenueDealCatalog(client) };
}

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

async function getAdminVenueDeal(client: DancrClient, venueId: string, dealId: string) {
  const { data, error } = await (client as any)
    .from("club_deals")
    .select(CLUB_DEAL_COLUMNS)
    .eq("id", dealId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) throw error;
  return data ? toClubDeal(data) : null;
}

function validatedDealFields(input: VenueDealInput) {
  const offerPreset = clubDealOfferPresetForTitle(input.dealTitle);
  if (!offerPreset) throw new Error("Choose Half-off admission or Skip the line for this Club Deal.");
  const dealTitle = offerPreset.title;
  const dealDescription = offerPreset.description;
  const dealTerms = optionalDealText(input.dealTerms, "Deal terms", 1200) || offerPreset.terms;
  const offerType: ClubDealOfferType = "admission";
  assertLiquorFreeClubDeal({ offerType, dealTitle, dealDescription, dealTerms });
  const sortOrder = Math.trunc(Number(input.sortOrder || 0));
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) {
    throw new Error("Offer order must be between 0 and 1000.");
  }
  return { dealTitle, dealDescription, dealTerms, offerType, sortOrder };
}

function optionalDealText(value: string | null | undefined, label: string, maximum: number) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  if (/[<>]/.test(text)) throw new Error(`${label} contains unsupported characters.`);
  return text;
}

function requiredUuid(value: unknown, message: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(message);
  }
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
