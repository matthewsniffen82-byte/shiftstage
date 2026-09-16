import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { getDancerFinance } from "@/src/lib/dancr/finance-reporting";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authContext = await createRequestSupabaseContext(request);
    const { client, user } = authContext;
    const denied = await requireActiveDancer(client, user.id);
    if (denied) return denied;
    if (new URL(request.url).searchParams.get("access") === "1") {
      return NextResponse.json({
        ok: true,
        access: { active: true },
        session: authContext.session || null,
      }, { headers: { "cache-control": "private, no-store" } });
    }
    const admin = createAdminSupabaseClient();
    return NextResponse.json({
      ok: true,
      finance: await getDancerFinance(admin, user.id),
      session: authContext.session || null,
    });
  } catch (error) {
    return apiError(error, "Unable to load dancer payouts.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const denied = await requireActiveDancer(client, user.id);
    if (denied) return denied;
    return NextResponse.json({ ok: false, error: "The dancer commission program has ended." }, {
      status: 410, headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "Unable to verify dancer account.");
  }
}

async function requireActiveDancer(client: Parameters<typeof getAccountByUserId>[0], userId: string) {
  const account = await getAccountByUserId(client, userId);
  if (!account || account.role !== "dancer" || account.accountState !== "active") {
    return NextResponse.json({ ok: false, error: "Active dancer account required." }, { status: 403 });
  }
  return null;
}
