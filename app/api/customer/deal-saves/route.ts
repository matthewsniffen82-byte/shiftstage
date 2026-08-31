import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  isMissingCustomerDealSavesTableError,
  removeCustomerClubDeal,
  saveCustomerClubDeal,
} from "@/src/lib/dancr/customer";
import {
  enforcePublicRequestRateLimit,
  PublicRequestRateLimitError,
} from "@/src/lib/dancr/public-request-rate-limit";
import { requirePublicClubDeal, requirePublicDancer } from "@/src/lib/dancr/resource-authorization";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CUSTOMER_ACTION_BODY_BYTES = 4_096;

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const dealId = new URL(request.url).searchParams.get("dealId") || "";
    if (!UUID_PATTERN.test(dealId)) {
      return NextResponse.json({ ok: false, error: "Invalid dealId." }, { status: 400 });
    }

    await requireActiveCustomer(createAdminSupabaseClient(), user.id);
    const { data, error } = await (client as any)
      .from("customer_deal_saves")
      .select("club_deal_id")
      .eq("customer_id", user.id)
      .eq("club_deal_id", dealId)
      .maybeSingle();
    if (error) {
      if (isMissingCustomerDealSavesTableError(error)) {
        return NextResponse.json({ ok: true, saved: false, persisted: false, session });
      }
      throw error;
    }

    return NextResponse.json({ ok: true, saved: Boolean(data), persisted: true, session });
  } catch (error) {
    return apiError(error, "Unable to load saved Club Deal state.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const admin = createAdminSupabaseClient();
    await requireActiveCustomer(admin, user.id);
    await enforcePublicRequestRateLimit(admin, {
      namespace: "customer_deal_save",
      request,
      subject: user.id,
      windowSeconds: 60,
      ipLimit: 180,
      subjectLimit: 90,
    });
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_CUSTOMER_ACTION_BODY_BYTES,
      invalidMessage: "Invalid Club Deal save request.",
      tooLargeMessage: "Club Deal save request is too large.",
    });
    const dealId = typeof body.dealId === "string" ? body.dealId : "";
    const saved = body.saved !== false;
    const sourceType = body.sourceType === "dancer_profile" ? "dancer_profile" : "club_page";
    const dancerId = typeof body.dancerId === "string" ? body.dancerId : "";

    if (!UUID_PATTERN.test(dealId)) {
      return NextResponse.json({ ok: false, error: "Invalid dealId." }, { status: 400 });
    }
    if (dancerId && !UUID_PATTERN.test(dancerId)) {
      return NextResponse.json({ ok: false, error: "Invalid dancerId." }, { status: 400 });
    }

    let persisted: boolean;
    if (saved) {
      await requirePublicClubDeal(admin, dealId);
      if (dancerId) await requirePublicDancer(admin, dancerId);
      persisted = await saveCustomerClubDeal(client, user.id, { dealId, sourceType, dancerId: dancerId || null });
    } else {
      persisted = await removeCustomerClubDeal(client, user.id, dealId);
    }

    return NextResponse.json({ ok: true, saved, persisted, session });
  } catch (error) {
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    return apiError(error, "Unable to update saved Club Deal.");
  }
}

async function requireActiveCustomer(client: ReturnType<typeof createAdminSupabaseClient>, userId: string) {
  const { data, error } = await (client as any)
    .from("app_users")
    .select("id")
    .eq("id", userId)
    .eq("role", "customer")
    .eq("account_state", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Active guest account required.");
}
