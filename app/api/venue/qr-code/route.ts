import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return retired();
}

export async function DELETE() {
  return retired();
}

function retired() {
  return NextResponse.json(
    {
      ok: false,
      error: "Club QR uploads have been retired. Manage physical tap stickers from the club dashboard.",
      replacement: "/api/venue/nfc-tags",
    },
    { status: 410, headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
