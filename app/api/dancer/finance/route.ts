import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  createDancerConnectOnboarding,
  getDancerFinance,
  refreshDancerConnectAccount,
} from "@/src/lib/dancr/finance";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const denied = await requireActiveDancer(client, user.id);
    if (denied) return denied;
    const admin = createAdminSupabaseClient();
    await refreshDancerConnectAccount(admin, user.id);
    return NextResponse.json({ ok: true, finance: await getDancerFinance(admin, user.id) });
  } catch (error) {
    return apiError(error, "Unable to load dancer payouts.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const denied = await requireActiveDancer(client, user.id);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    if (body.action !== "connect_onboarding") {
      return NextResponse.json({ ok: false, error: "Unsupported payout action." }, { status: 400 });
    }
    const origin = configuredSiteOrigin(request);
    const onboarding = await createDancerConnectOnboarding(
      createAdminSupabaseClient(),
      user.id,
      `${origin}/dashboard?finance=connected`,
      `${origin}/dashboard?finance=refresh`,
    );
    return NextResponse.json({ ok: true, onboarding });
  } catch (error) {
    return apiError(error, "Unable to start secure payout setup.");
  }
}

async function requireActiveDancer(client: Parameters<typeof getAccountByUserId>[0], userId: string) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.role !== "dancer" || account.accountState !== "active") {
    return NextResponse.json({ ok: false, error: "Active dancer account required." }, { status: 403 });
  }
  return null;
}

function configuredSiteOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
}
