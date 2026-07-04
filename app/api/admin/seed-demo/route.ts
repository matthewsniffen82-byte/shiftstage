import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const disabledResponse = {
  ok: false,
  error: "Demo seeding is disabled. Create real profiles through onboarding.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 410 });
}

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 410 });
}
