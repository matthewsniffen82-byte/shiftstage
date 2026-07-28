import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import {
  DmcaUserError,
  getUploaderDmcaCase,
  submitDmcaCounterNotice,
} from "@/src/lib/dancr/dmca";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const { id } = await context.params;
    const dmcaCase = await getUploaderDmcaCase(createAdminSupabaseClient(), user.id, id);
    return NextResponse.json({ ok: true, case: dmcaCase });
  } catch (error) {
    return dmcaCaseError(error, "Unable to load copyright case.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { user } = await createRequestSupabaseContext(request);
    const { id } = await context.params;
    const body = await request.json();
    const counterNotice = await submitDmcaCounterNotice(
      createAdminSupabaseClient(),
      user.id,
      id,
      body,
    );
    return NextResponse.json(
      {
        ok: true,
        counterNotice,
        message: "Your counter-notice was submitted and the required waiting period has started.",
      },
      { status: 201 },
    );
  } catch (error) {
    return dmcaCaseError(error, "Unable to submit counter-notice.");
  }
}

function dmcaCaseError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "Sign in required.") {
    return apiError(error, fallback);
  }
  if (error instanceof DmcaUserError) {
    return apiError(error, fallback, 400);
  }
  console.error(fallback, error);
  return apiError(new Error(fallback), fallback);
}
