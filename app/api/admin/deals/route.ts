import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import {
  settleDealRevenueEvent,
  voidDealRedemption,
} from "@/src/lib/dancr/deal-admin-actions";
import { getAdminDealActivity } from "@/src/lib/dancr/deals";
import {
  getAdminVenueClubDealRequests,
  reviewVenueClubDealRequest,
} from "@/src/lib/dancr/venue-deal-requests";
import {
  deleteAdminVenueDeal,
  getAdminVenueDealCatalog,
  upsertAdminVenueDeal,
} from "@/src/lib/dancr/venue-deal-actions";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const params = new URL(request.url).searchParams;
    const admin = createAdminSupabaseClient();
    const [activity, clubDeals, dealRequests] = await Promise.all([
      getAdminDealActivity(admin, {
        venueId: params.get("venueId"),
        dancerId: params.get("dancerId"),
        dealId: params.get("dealId"),
        sourceType: params.get("sourceType"),
        status: params.get("status"),
        commissionStatus: params.get("commissionStatus"),
        suspicious: params.get("suspicious"),
      }),
      getAdminVenueDealCatalog(admin),
      getAdminVenueClubDealRequests(admin),
    ]);

    return NextResponse.json({ ok: true, activity, clubDeals, dealRequests });
  } catch (error) {
    return apiError(error, "Unable to load deal activity.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);
    const body = await request.json().catch(() => ({}));
    const admin = createAdminSupabaseClient();

    if (body.action === "upsert_contract_deal") {
      const result = await upsertAdminVenueDeal(admin, {
        venueId: typeof body.venueId === "string" ? body.venueId : "",
        dealId: typeof body.dealId === "string" ? body.dealId : null,
        dealTitle: typeof body.dealTitle === "string" ? body.dealTitle : "",
        dealDescription: typeof body.dealDescription === "string" ? body.dealDescription : "",
        dealTerms: typeof body.dealTerms === "string" ? body.dealTerms : null,
        isActive: body.isActive === true,
        offerType: "admission",
        sortOrder: Number(body.sortOrder || 0),
      });
      if (typeof body.requestId === "string" && body.requestId) {
        await reviewVenueClubDealRequest(admin, {
          requestId: body.requestId,
          venueId: result.deal.venueId,
          adminUserId: user.id,
          status: result.deal.isActive ? "approved" : "under_review",
          linkedDealId: result.deal.id,
          decisionNote: result.deal.isActive ? "Approved and published under the signed Deal Order." : "MyDancr is preparing the requested Deal Order.",
        });
      }
      const dealRequests = await getAdminVenueClubDealRequests(admin);
      console.info("ADMIN_CONTRACT_CLUB_DEAL_SAVED", {
        adminUserId: user.id,
        venueId: result.deal.venueId,
        dealId: result.deal.id,
        active: result.deal.isActive,
      });
      return NextResponse.json({ ok: true, clubDeals: result.deals, dealRequests, deal: result.deal });
    }

    if (body.action === "delete_contract_deal") {
      const result = await deleteAdminVenueDeal(
        admin,
        typeof body.venueId === "string" ? body.venueId : "",
        typeof body.dealId === "string" ? body.dealId : "",
      );
      console.info("ADMIN_CONTRACT_CLUB_DEAL_DELETED", {
        adminUserId: user.id,
        venueId: body.venueId,
        dealId: result.id,
      });
      return NextResponse.json({ ok: true, clubDeals: result.deals, dealRequests: await getAdminVenueClubDealRequests(admin) });
    }

    if (body.action === "review_deal_request") {
      const status = body.status === "rejected" ? "rejected" : body.status === "under_review" ? "under_review" : null;
      if (!status) return NextResponse.json({ ok: false, error: "Choose a valid request decision." }, { status: 400 });
      const dealRequest = await reviewVenueClubDealRequest(admin, {
        requestId: typeof body.requestId === "string" ? body.requestId : "",
        venueId: typeof body.venueId === "string" ? body.venueId : "",
        adminUserId: user.id,
        status,
        decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
      });
      console.info("ADMIN_CLUB_DEAL_REQUEST_REVIEWED", {
        adminUserId: user.id,
        venueId: dealRequest.venueId,
        requestId: dealRequest.id,
        status: dealRequest.status,
      });
      return NextResponse.json({ ok: true, dealRequest, dealRequests: await getAdminVenueClubDealRequests(admin) });
    }

    return NextResponse.json({ ok: false, error: "Unsupported Club Deal action." }, { status: 400 });
  } catch (error) {
    return apiError(error, "Unable to manage the contract Club Deal.", 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const body = await request.json();
    const settlementAction = body?.action === "venue_payment_received" ? body.action : null;
    if (settlementAction === "venue_payment_received") {
      const revenueEventId = typeof body?.revenueEventId === "string" ? body.revenueEventId.trim() : "";
      const externalReference = typeof body?.externalReference === "string" ? body.externalReference.trim() : "";
      if (!revenueEventId || !externalReference) {
        return NextResponse.json(
          { ok: false, error: "Revenue event and external payment reference are required." },
          { status: 400 },
        );
      }
      const revenueEvent = await settleDealRevenueEvent(
        client,
        revenueEventId,
        "venue_payment_received",
        externalReference,
      );
      console.info("DEAL_REVENUE_SETTLEMENT_RECORDED", {
        adminUserId: user.id,
        revenueEventId,
        action: settlementAction,
      });
      return NextResponse.json({ ok: true, revenueEvent });
    }

    const redemptionId = typeof body?.redemptionId === "string" ? body.redemptionId.trim() : "";
    if (!redemptionId) {
      return NextResponse.json({ ok: false, error: "Missing redemption." }, { status: 400 });
    }

    const result = await voidDealRedemption(client, redemptionId);
    if (!result) {
      return NextResponse.json({ ok: false, error: "Redemption is unavailable." }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Unable to update deal activity.");
  }
}
