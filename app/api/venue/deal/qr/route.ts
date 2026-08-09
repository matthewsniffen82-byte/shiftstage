import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { createVenueDealCampaignToken } from "@/src/lib/dancr/deal-campaign";
import { getVenueDealsForAccount } from "@/src/lib/dancr/deals";
import { getPublicEnv } from "@/src/lib/env";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "venue" || account.accountState !== "active") {
      return NextResponse.json({ ok: false, error: "Active venue account required." }, { status: 403 });
    }

    const dealId = new URL(request.url).searchParams.get("dealId")?.trim() || "";
    if (!UUID_PATTERN.test(dealId)) {
      return NextResponse.json({ ok: false, error: "A valid Club Deal is required." }, { status: 400 });
    }

    const owned = await getVenueDealsForAccount(createAdminSupabaseClient(), user.id);
    const deal = owned?.deals.find((candidate) => candidate.id === dealId) || null;
    if (!deal) {
      return NextResponse.json({ ok: false, error: "Club Deal not found for this venue." }, { status: 404 });
    }
    if (!deal.isActive || deal.payoutType !== "flat" || deal.payoutAmountCents <= 0) {
      return NextResponse.json(
        { ok: false, error: "Publish this Club Deal with a referral commission before generating its QR." },
        { status: 409 },
      );
    }

    const campaignToken = createVenueDealCampaignToken({ dealId: deal.id, venueId: deal.venueId });
    const claimUrl = `${getPublicEnv().siteUrl.replace(/\/+$/, "")}/deals/claim/${encodeURIComponent(deal.id)}?campaign=${encodeURIComponent(campaignToken)}`;
    const qrDataUrl = await QRCode.toDataURL(claimUrl, {
      errorCorrectionLevel: "H",
      margin: 2,
      width: 1024,
      color: { dark: "#050507", light: "#ffffff" },
    });

    const response = NextResponse.json({
      ok: true,
      asset: {
        dealId: deal.id,
        dealTitle: deal.dealTitle,
        claimUrl,
        qrDataUrl,
      },
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error, "Unable to generate the tracked Club Deal QR.");
  }
}
