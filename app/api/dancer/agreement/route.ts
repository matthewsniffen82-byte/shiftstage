import { NextResponse } from "next/server";
import { apiError, PublicApiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { acceptDancerAgreement, getDancerAgreementAccess } from "@/src/lib/dancr/dancer-agreement";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user, session } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (account?.role !== "dancer" || account.accountState === "deleted") {
      throw new PublicApiError("FORBIDDEN", "Sign in with your dancer account to continue.", 403);
    }
    const agreement = await getDancerAgreementAccess(client);
    const { data: profile, error } = await createAdminSupabaseClient().from("dancer_profiles")
      .select("status, verification_status, is_public").eq("user_id", user.id).maybeSingle();
    if (error) throw new PublicApiError("UNAVAILABLE", "Unable to check your profile setup status.", 503);
    const profileSetupAllowed = Boolean(profile?.is_public === false && ["draft", "rejected"].includes(profile.status)
      && profile.verification_status !== "approved");
    return NextResponse.json({ ok: true, agreement, profileSetupAllowed, session }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, "Unable to check the Dancer Agreement."); }
}

export async function POST(request: Request) {
  try {
    const { client, session } = await createRequestSupabaseContext(request);
    const body = await readBoundedJsonObject(request, {
      maxBytes: 2_048,
      invalidMessage: "Invalid agreement acceptance.",
      tooLargeMessage: "Agreement acceptance is too large.",
    });
    const agreement = await acceptDancerAgreement(client, body);
    return NextResponse.json({ ok: true, agreement, session }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error, "Unable to save the Dancer Agreement acceptance."); }
}
