import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  createDancerConnectOnboarding,
  refreshDancerConnectAccount,
  requestDancerCashOut,
} from "@/src/lib/dancr/dancer-payout-actions";
import { getDancerFinance } from "@/src/lib/dancr/finance-reporting";
import { requestNatsAffiliateLink } from "@/src/lib/dancr/nats-affiliate-actions";
import { getNatsRuntimeConfig } from "@/src/lib/dancr/nats";
import { publicAppUrl } from "@/src/lib/dancr/public-app-url";
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
    if (body.action === "request_nats_link") {
      if (!getNatsRuntimeConfig().selected) {
        return NextResponse.json({ ok: false, error: "Payout account setup is not currently available." }, { status: 409 });
      }
      const loginId = parseNatsLoginId(body.loginId);
      const username = parseNatsUsername(body.username);
      if (loginId === null || username === undefined) {
        return NextResponse.json({ ok: false, error: "Enter a valid payout account login ID and optional username." }, { status: 400 });
      }
      const account = await requestNatsAffiliateLink(createAdminSupabaseClient(), user.id, { loginId, username });
      return NextResponse.json({ ok: true, account, finance: await getDancerFinance(createAdminSupabaseClient(), user.id) });
    }
    if (body.action === "cash_out") {
      const suppliedKey = request.headers.get("idempotency-key")?.trim();
      const requestKey = suppliedKey && suppliedKey.length >= 12 && suppliedKey.length <= 160
        ? `${user.id}:${suppliedKey}`
        : `${user.id}:${crypto.randomUUID()}`;
      const payout = await requestDancerCashOut(createAdminSupabaseClient(), user.id, requestKey);
      return NextResponse.json({ ok: true, payout, finance: await getDancerFinance(createAdminSupabaseClient(), user.id) });
    }
    if (body.action === "connect_onboarding") {
      const origin = publicAppUrl();
      const onboarding = await createDancerConnectOnboarding(
        createAdminSupabaseClient(),
        user.id,
        `${origin}/dashboard?finance=connected`,
        `${origin}/dashboard?finance=refresh`,
      );
      return NextResponse.json({ ok: true, onboarding });
    }
    return NextResponse.json({ ok: false, error: "Unsupported payout action." }, { status: 400 });
  } catch (error) {
    return apiError(error, "Unable to start secure payout setup.");
  }
}

function parseNatsLoginId(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^[1-9]\d{0,17}$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNatsUsername(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const username = value.trim();
  return /^[A-Za-z0-9_.@-]{2,80}$/.test(username) ? username : undefined;
}

async function requireActiveDancer(client: Parameters<typeof getAccountByUserId>[0], userId: string) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.role !== "dancer" || account.accountState !== "active") {
    return NextResponse.json({ ok: false, error: "Active dancer account required." }, { status: 403 });
  }
  return null;
}
