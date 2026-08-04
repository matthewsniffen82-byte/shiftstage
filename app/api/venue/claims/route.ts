import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import {
  createVenueOwnershipClaim,
  getLatestVenueOwnershipClaim,
  hashVenueClaimRequestIp,
  resolveVenueClaimCode,
  validateVenueClaimProof,
  VenueClaimUserError,
} from "@/src/lib/dancr/venue-claims";
import { getPublicEnv } from "@/src/lib/env";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext, getBearerToken } from "@/src/lib/supabase/request";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const account = await getAccountByUserId(client, user.id);
    if (!account || account.role !== "venue" || account.accountState !== "active") {
      return NextResponse.json({ ok: false, error: "Active venue account required." }, { status: 403 });
    }
    const claim = await getLatestVenueOwnershipClaim(createAdminSupabaseClient(), user.id);
    return NextResponse.json({ ok: true, claim });
  } catch (error) {
    return apiError(error, "Unable to load your venue claim.");
  }
}

export async function POST(request: Request) {
  const admin = createAdminSupabaseClient();
  let createdUserId = "";
  let uploadedClaim = false;

  try {
    const formData = await request.formData();
    const venueId = formText(formData, "venueId");
    const venueSlug = formText(formData, "venueSlug");
    const claimCode = formText(formData, "claimCode");
    const claimantName = formText(formData, "claimantName");
    const claimantTitle = formText(formData, "claimantTitle");
    const claimantPhone = formText(formData, "claimantPhone");
    if (formText(formData, "attested") !== "on") {
      throw new VenueClaimUserError("Confirm that you are authorized to manage this venue.");
    }
    const proofFile = formData.get("proofFile");
    if (!(proofFile instanceof File)) throw new VenueClaimUserError("Venue ownership proof is required.");

    // Validate before account creation so a bad upload cannot leave an orphan login.
    await validateVenueClaimProof(proofFile);
    const targetVenue = await loadClaimableVenue(admin, venueId, venueSlug);
    const claimCodeId = await resolveVenueClaimCode(admin, targetVenue.id, claimCode);

    let userId = "";
    let email = "";
    let requiresEmailConfirmation = false;
    let session: { accessToken?: string; refreshToken?: string; expiresAt?: number } | null = null;

    if (getBearerToken(request)) {
      const context = await createRequestSupabaseContext(request);
      const account = await getAccountByUserId(context.client, context.user.id);
      if (!account || account.role !== "venue" || account.accountState !== "active") {
        throw new VenueClaimUserError("Sign in with an active venue account to submit this claim.");
      }
      userId = context.user.id;
      email = context.user.email?.toLowerCase() || account.email?.toLowerCase() || "";
      if (!email) throw new VenueClaimUserError("A verified account email is required.");
    } else {
      email = formText(formData, "email").toLowerCase();
      const password = formText(formData, "password");
      if (password.length < 8) throw new VenueClaimUserError("Password must be at least 8 characters.");

      const client = createServerSupabaseClient();
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            role: "venue",
            display_name: targetVenue.name,
            venue_name: targetVenue.name,
            venue_claim: true,
            city: targetVenue.city,
          },
          emailRedirectTo: venueClaimEmailRedirect(targetVenue.slug),
        },
      });
      if (error) throw error;
      if (!data.user) throw new Error("Unable to create venue account.");
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new VenueClaimUserError("An account already uses this email. Sign in with that account, then submit the venue claim again.");
      }

      createdUserId = data.user.id;
      userId = data.user.id;
      requiresEmailConfirmation = !data.session;
      session = data.session
        ? {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt: data.session.expires_at,
          }
        : null;

      const { error: accountError } = await admin.from("app_users").upsert({
        id: userId,
        role: "venue",
        display_name: targetVenue.name,
        email,
      });
      if (accountError) throw accountError;
    }

    const claim = await createVenueOwnershipClaim(admin, {
      venueId: targetVenue.id,
      claimCodeId,
      userId,
      email,
      claimantName,
      claimantTitle,
      claimantPhone,
      proofFile,
      requestIpHash: hashVenueClaimRequestIp(requestIp(request)),
    });
    uploadedClaim = true;

    return NextResponse.json(
      {
        ok: true,
        claim,
        requiresEmailConfirmation,
        session,
        account: {
          role: "venue",
          displayName: targetVenue.name,
          email,
          accountState: "active",
        },
        message: requiresEmailConfirmation
          ? "Claim submitted. Confirm your email so an admin can approve venue access."
          : "Claim submitted for admin review.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (createdUserId && !uploadedClaim) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(createdUserId);
      if (cleanupError) {
        console.error("VENUE_CLAIM_ORPHAN_ACCOUNT_CLEANUP_FAILED", {
          userId: createdUserId,
          message: cleanupError.message,
        });
      }
    }
    const userMessage = error instanceof VenueClaimUserError ? error.message : "";
    if (!userMessage) {
      console.error("VENUE_OWNERSHIP_CLAIM_FAILED", error);
    }
    return apiError(
      new Error(userMessage || "Unable to submit venue claim."),
      "Unable to submit venue claim.",
      userMessage ? (userMessage.startsWith("Too many") ? 429 : 400) : 500,
    );
  }
}

async function loadClaimableVenue(
  client: ReturnType<typeof createAdminSupabaseClient>,
  venueId: string,
  venueSlug: string,
) {
  if (!venueId || !venueSlug) throw new VenueClaimUserError("Choose a venue card to claim.");
  const { data, error } = await client
    .from("venues")
    .select("id, slug, name, city, owner_user_id, is_active")
    .eq("id", venueId)
    .eq("slug", venueSlug)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_active === false) throw new VenueClaimUserError("This venue card is not available to claim.");
  if (data.owner_user_id) throw new VenueClaimUserError("This venue is already managed by a verified account.");
  return data;
}

function venueClaimEmailRedirect(venueSlug: string) {
  const siteUrl = getPublicEnv().siteUrl.replace(/\/$/, "");
  const returnTo = `/venues/${encodeURIComponent(venueSlug)}/claim?submitted=1`;
  const params = new URLSearchParams({
    role: "venue",
    dancr_role: "venue",
    return_to: returnTo,
  });
  return `${siteUrl}/auth/callback?${params.toString()}`;
}

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requestIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown"
  );
}
