import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address")?.trim();
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!address) {
    return fallback("Missing address.");
  }

  if (!key) {
    return fallback("Map preview unavailable.");
  }

  const embedUrl = new URL("https://www.google.com/maps/embed/v1/place");
  embedUrl.searchParams.set("key", key);
  embedUrl.searchParams.set("q", address);
  embedUrl.searchParams.set("zoom", "15");

  return NextResponse.redirect(embedUrl);
}

function fallback(message: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{height:100%;margin:0;background:#0b0d13;color:#cde7f4;font:700 14px system-ui;display:grid;place-items:center;text-align:center}</style></head><body>${message}</body></html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
