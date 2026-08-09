import { notFound } from "next/navigation";
import { verifyVenueDealCampaignToken } from "@/src/lib/dancr/deal-campaign";
import { getActiveClubDealById } from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import DealClaimClient from "./DealClaimClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ campaign?: string | string[] }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ClubDealClaimPage({ params, searchParams }: PageProps) {
  const { dealId } = await params;
  if (!UUID_PATTERN.test(dealId)) notFound();

  const query = await searchParams;
  const campaignToken = typeof query.campaign === "string" ? query.campaign : "";
  const campaign = verifyVenueDealCampaignToken(campaignToken);
  if (!campaign || campaign.dealId !== dealId) notFound();

  const deal = await getActiveClubDealById(createAdminSupabaseClient(), dealId);
  if (!deal || deal.venueId !== campaign.venueId) notFound();

  return <DealClaimClient campaignToken={campaignToken} deal={deal} />;
}
