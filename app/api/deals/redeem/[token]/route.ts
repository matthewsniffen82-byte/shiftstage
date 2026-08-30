import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getRedemptionForScanner } from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, { params }: RouteProps) {
  try {
    const { token } = await params;
    const redemption = await getRedemptionForScanner(createAdminSupabaseClient(), token);
    if (!redemption) return NextResponse.json({ ok: false, error: "Club Deal not found." }, { status: 404 });

    return NextResponse.json({ ok: true, redemption });
  } catch (error) {
    return apiError(error, "Unable to load Club Deal redemption.");
  }
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Legacy QR confirmation has retired. Choose a Club Deal, then tap the venue's cashier sticker.",
      replacement: "cashier_nfc",
    },
    { status: 410, headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
