import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return retiredResponse();
}

export async function POST() {
  return retiredResponse();
}

function retiredResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "Venue claiming is retired. Submit a request to join MyDancr, then use the approved access code during venue sign up.",
      signupUrl: "/?venueSignup=1",
    },
    { status: 410 },
  );
}
