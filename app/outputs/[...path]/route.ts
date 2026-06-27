import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/", url.origin);
  const authRole = url.searchParams.get("auth");
  const city = url.searchParams.get("city");

  if (authRole === "customer" || authRole === "dancer") {
    destination.pathname = "/account";
    destination.searchParams.set("role", authRole);
  } else if (city) {
    destination.pathname = "/tonight";
    destination.searchParams.set("city", city);
  }

  return NextResponse.redirect(destination, 308);
}
