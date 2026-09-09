import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import {
  createDmcaNotice,
  DmcaUserError,
  getPublicDmcaAgent,
} from "@/src/lib/dancr/dmca";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
import { requestClientAddress } from "@/src/lib/security/request-client-address";
import { PublicRequestRateLimitError } from "@/src/lib/dancr/public-request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_DMCA_NOTICE_BODY_BYTES = 65_536;

export async function GET() {
  try {
    const agent = await getPublicDmcaAgent(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, agent });
  } catch (error) {
    console.error("Unable to load public copyright contact", safeErrorMetadata(error));
    return apiError(new Error("Unable to load copyright contact."), "Unable to load copyright contact.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await readBoundedJsonObject(request, {
      maxBytes: MAX_DMCA_NOTICE_BODY_BYTES,
      invalidMessage: "Invalid copyright notice request.",
      tooLargeMessage: "Copyright notice request is too large.",
    });
    const notice = await createDmcaNotice(
      createAdminSupabaseClient(),
      body,
      requestIp(request),
      request,
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
    if (error instanceof PublicApiError) {
      return apiError(error, "Unable to submit copyright notice.");
    }
    if (error instanceof PublicRequestRateLimitError) {
      return NextResponse.json(
        { ok: false, error: "Too many copyright notices were submitted. Try again later or email the copyright contact." },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
      );
    }
    const message = error instanceof DmcaUserError ? error.message : "";
    if (!message) console.error("Unable to submit copyright notice", safeErrorMetadata(error));
    return apiError(
      new Error(message || "Unable to submit copyright notice."),
      "Unable to submit copyright notice.",
      message ? (message.startsWith("Too many copyright notices") ? 429 : 400) : 500,
    );
  }
}

function requestIp(request: Request) {
  return requestClientAddress(request);
}
