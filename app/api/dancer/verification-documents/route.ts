import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
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
  return NextResponse.json(
    {
      ok: false,
      error: "Identity-document uploads are disabled. MyDancr does not collect identity documents.",
      replacement: null,
    },
    {
      status: 410,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
