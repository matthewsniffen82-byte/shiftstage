import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  createDmcaNotice,
  DmcaUserError,
  getPublicDmcaAgent,
} from "@/src/lib/dancr/dmca";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agent = await getPublicDmcaAgent(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, agent });
  } catch (error) {
    console.error("Unable to load public copyright contact", error);
    return apiError(new Error("Unable to load copyright contact."), "Unable to load copyright contact.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const notice = await createDmcaNotice(
      createAdminSupabaseClient(),
      body,
      requestIp(request),
    );
    return NextResponse.json(
      {
        ok: true,
        notice,
        message: `Copyright notice ${notice.id} was submitted for review.`,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof DmcaUserError ? error.message : "";
    if (!message) console.error("Unable to submit copyright notice", error);
    return apiError(
      new Error(message || "Unable to submit copyright notice."),
      "Unable to submit copyright notice.",
      message ? (message.startsWith("Too many copyright notices") ? 429 : 400) : 500,
    );
  }
}

function requestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown"
  );
}
