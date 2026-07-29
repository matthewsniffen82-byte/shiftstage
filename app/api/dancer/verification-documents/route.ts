import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getIdentityVerificationMode } from "@/src/lib/dancr/identity-mode";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await createRequestSupabaseContext(request);
    return disabledUploadResponse();
  } catch (error) {
    return apiError(error, "Unable to check identity-document upload status.");
  }
}

export async function POST(request: Request) {
  try {
    await createRequestSupabaseContext(request);
    return disabledUploadResponse();
  } catch (error) {
    return apiError(error, "Unable to check identity-document upload status.");
  }
}

function disabledUploadResponse() {
  const mode = getIdentityVerificationMode();
  return NextResponse.json(
    {
      ok: false,
      mode,
      error:
        mode === "auto_approve"
          ? "Identity-document uploads are disabled because dancer accounts are automatically approved."
          : "Direct identity-document uploads are disabled. Use secure VerifyMy verification.",
      replacement: "/api/dancer/identity-verification",
    },
    {
      status: 410,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
