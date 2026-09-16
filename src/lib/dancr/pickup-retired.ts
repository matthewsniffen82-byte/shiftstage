import { NextResponse } from "next/server";

export function pickupChatRetired() {
  return NextResponse.json({ ok: false, error: "Pickup chat is no longer available. Open the club page to send a pickup contact form." },
    { status: 410, headers: { "cache-control": "private, no-store" } });
}
