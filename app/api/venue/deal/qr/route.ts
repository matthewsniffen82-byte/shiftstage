import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}

function retired() {
  return NextResponse.json(
    {
      ok: false,
      error: "Tracked Club Deal QR assets have been retired. Manage cashier NFC stickers in the venue dashboard.",
      replacement: "/api/venue/nfc-tags",
    },
    { status: 410, headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
