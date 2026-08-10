import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Legacy QR issuance endpoint. New redemptions are created and confirmed only
 * by a physical cashier NFC tap through /api/nfc/[token]. Keeping this route
 * explicit prevents older clients from silently issuing unredeemable passes.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Club Deal QR passes have been retired. Choose a deal in MyDancr, then tap the venue's cashier NFC sticker.",
      replacement: "cashier_nfc",
    },
    { status: 410, headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
