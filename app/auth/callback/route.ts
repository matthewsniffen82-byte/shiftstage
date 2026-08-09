import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createServerSupabaseClient } from "@/src/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CallbackRole = "customer" | "dancer" | "venue";
type CallbackUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};
type AdminClient = ReturnType<typeof createAdminSupabaseClient>;
type CallbackSession = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
} | null;

export async function GET(request: Request) {
  const callbackSession = await readCallbackSession(request);
  const redirectPath = callbackRedirectPath(request, callbackSession);
  const role = callbackRole(request, callbackSession);
  const showDancerConfirmation = role === "dancer" && !isPasswordResetCallback(request);

  return new Response(callbackHtml(callbackSession, redirectPath, showDancerConfirmation), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function callbackRedirectPath(request: Request, callbackSession: Awaited<ReturnType<typeof readCallbackSession>>) {
  const url = new URL(request.url);
  const explicitReturnTo = safeReturnPath(url.searchParams.get("return_to"));
  const accountRole = callbackSession?.account?.role;
  const role = callbackRole(request, callbackSession);

  if (role && isLiveAppDestination(explicitReturnTo)) {
    return liveAppCallbackPath(url, role);
  }
  if (explicitReturnTo) return explicitReturnTo;
  if (accountRole === "admin") return "/admin";
  if (role) return liveAppCallbackPath(url, role);
  return "/account";
}

function callbackRole(request: Request, callbackSession: Awaited<ReturnType<typeof readCallbackSession>>) {
  const url = new URL(request.url);
  const explicitReturnTo = safeReturnPath(url.searchParams.get("return_to"));
  return (
    readCallbackRole(callbackSession?.account?.role) ||
    readCallbackRole(url.searchParams.get("role")) ||
    readCallbackRole(url.searchParams.get("dancr_role")) ||
    readCallbackRoleFromReturnTo(explicitReturnTo)
  );
}

function isPasswordResetCallback(request: Request) {
  const url = new URL(request.url);
  return (
    url.searchParams.get("dancr_reset") === "1" ||
    url.searchParams.get("reset_target") === "account_password" ||
    url.searchParams.get("type") === "recovery"
  );
}

function safeReturnPath(value: string | null) {
  if (!value) return "";
  try {
    const path = value.startsWith("http") ? new URL(value).pathname : value;
    return path.startsWith("/") && !path.startsWith("//") ? path : "";
  } catch {
    return "";
  }
}

function isLiveAppDestination(value: string) {
  if (!value) return true;

  try {
    const pathname = new URL(value, "https://mydancr.com").pathname;
    return pathname === "/" || pathname.startsWith("/dashboard/customer") || pathname.startsWith("/dashboard/dancer") || pathname.startsWith("/dashboard/venue");
  } catch {
    return false;
  }
}

function liveAppCallbackPath(url: URL, role: CallbackRole) {
  const params = new URLSearchParams();
  const isPasswordReset =
    url.searchParams.get("dancr_reset") === "1" ||
    url.searchParams.get("reset_target") === "account_password" ||
    url.searchParams.get("type") === "recovery";

  params.set(isPasswordReset ? "dancr_reset" : "dancr_confirm", "1");
  params.set("role", role);
  params.set("dancr_role", role);

  for (const key of ["resume", "reset_target"]) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }

  return `/?${params.toString()}`;
}

function callbackHtml(
  callbackSession: Awaited<ReturnType<typeof readCallbackSession>>,
  redirectPath: string,
  showDancerConfirmation: boolean,
) {
  const sessionJson = JSON.stringify(callbackSession || null).replace(/</g, "\\u003c");
  const redirectJson = JSON.stringify(redirectPath);
  const dancerConfirmationJson = JSON.stringify(showDancerConfirmation);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>${showDancerConfirmation ? "Email confirmed | MyDancr" : "Opening Dancr"}</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 50% 15%, rgba(105, 42, 255, .2), transparent 34%), #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(100%, 460px); padding: 36px 28px; display: grid; gap: 16px; text-align: center; border: 1px solid rgba(148, 117, 255, .28); border-radius: 28px; background: rgba(10, 8, 17, .96); box-shadow: 0 24px 80px rgba(0, 0, 0, .48), 0 0 42px rgba(107, 51, 255, .12); }
      .eyebrow { margin: 0; color: #9be7f5; font-size: 12px; font-weight: 900; letter-spacing: .2em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(32px, 9vw, 46px); line-height: 1; letter-spacing: -.04em; }
      p { margin: 0; color: #c5bfd3; font-size: 16px; line-height: 1.55; }
      a { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; margin-top: 8px; padding: 13px 20px; border: 1px solid rgba(180, 151, 255, .72); border-radius: 16px; background: linear-gradient(135deg, #7c35ff, #5720d5); color: #fff; font-size: 16px; font-weight: 900; text-decoration: none; box-shadow: 0 12px 30px rgba(103, 42, 231, .34); }
      a:hover { filter: brightness(1.08); }
      a:active { transform: translateY(1px); }
      a:focus-visible { outline: 3px solid #91e7f5; outline-offset: 3px; }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    <main id="dancerConfirmation" hidden>
      <p class="eyebrow">Dancer account</p>
      <h1>Email confirmed</h1>
      <p>Your email is verified. Complete the required dancer profile steps before your profile can go live.</p>
      <a id="dancerConfirmationContinue" href="${escapeHtml(redirectPath)}">Click here to complete dancer profile</a>
    </main>
    <main id="confirmationError" hidden>
      <p class="eyebrow">Dancer account</p>
      <h1>Confirmation link unavailable</h1>
      <p>This link is invalid or has expired. Sign in to continue your dancer profile or request a new confirmation email.</p>
      <a href="/account?role=dancer">Continue to dancer sign in</a>
    </main>
    <main id="openingDancr">
      <p class="eyebrow">MyDancr</p>
      <h1>Opening Dancr</h1>
      <p>Your live account is being connected.</p>
      <a href="${escapeHtml(redirectPath)}">Continue</a>
    </main>
    <script>
      const serverSession = ${sessionJson};
      const redirectTo = ${redirectJson};
      const showDancerConfirmation = ${dancerConfirmationJson};
      const fragmentParams = new URLSearchParams(window.location.hash ? window.location.hash.slice(1) : "");
      const fragmentAccessToken = fragmentParams.get("access_token") || "";
      const fragmentRefreshToken = fragmentParams.get("refresh_token") || undefined;
      const fragmentExpiresAt = fragmentParams.get("expires_at");
      const fragmentExpiresIn = fragmentParams.get("expires_in");
      let tokenPayload = {};
      if (fragmentAccessToken) {
        try {
          const encodedPayload = fragmentAccessToken.split(".")[1] || "";
          const normalizedPayload = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
          const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
          tokenPayload = JSON.parse(window.atob(paddedPayload));
        } catch (error) {}
      }
      const tokenMetadata = tokenPayload.user_metadata && typeof tokenPayload.user_metadata === "object"
        ? tokenPayload.user_metadata
        : {};
      const tokenRole = ["customer", "dancer", "venue"].includes(tokenMetadata.role) ? tokenMetadata.role : "";
      const tokenEmail = typeof tokenPayload.email === "string" ? tokenPayload.email : "";
      const redirectUrl = new URL(redirectTo, window.location.origin);
      if (tokenRole && redirectUrl.pathname === "/account") {
        redirectUrl.pathname = "/";
        redirectUrl.searchParams.set("dancr_confirm", "1");
      }
      const redirectRole = redirectUrl.searchParams.get("role") || redirectUrl.searchParams.get("dancr_role") || tokenRole;
      if (tokenRole && !redirectUrl.searchParams.get("role")) redirectUrl.searchParams.set("role", tokenRole);
      if (tokenRole && !redirectUrl.searchParams.get("dancr_role")) redirectUrl.searchParams.set("dancr_role", tokenRole);
      const fragmentSession = fragmentAccessToken
        ? {
            accessToken: fragmentAccessToken,
            refreshToken: fragmentRefreshToken,
            expiresAt: fragmentExpiresAt
              ? Number(fragmentExpiresAt)
              : fragmentExpiresIn
                ? Math.floor(Date.now() / 1000) + Number(fragmentExpiresIn)
                : undefined,
            account: {
              role: tokenRole || redirectRole || null,
              displayName: tokenMetadata.display_name || tokenMetadata.stage_name || tokenEmail || null,
              email: tokenEmail || null,
              accountState: "active"
            }
          }
        : null;
      const session = serverSession && serverSession.accessToken ? serverSession : fragmentSession;
      if (session && session.accessToken) {
        try {
          localStorage.setItem("dancrAuthSessionV1", JSON.stringify(session));
        } catch (error) {}
      }
      const fragment = fragmentAccessToken ? window.location.hash : "";
      const destination = redirectUrl.pathname + redirectUrl.search + fragment;
      if (showDancerConfirmation) {
        document.getElementById("openingDancr").hidden = true;
        if (session && session.accessToken) {
          const continueLink = document.getElementById("dancerConfirmationContinue");
          continueLink.href = destination;
          document.getElementById("dancerConfirmation").hidden = false;
        } else {
          document.getElementById("confirmationError").hidden = false;
        }
      } else {
        window.location.replace(destination);
      }
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

async function readCallbackSession(request: Request) {
  const url = new URL(request.url);
  const authData = await confirmSupabaseCallback(url);
  if (!authData?.user) return null;

  try {
    const metadata = authData.user.user_metadata || {};
    const roleHint =
      readCallbackRole(url.searchParams.get("role")) ||
      readCallbackRole(url.searchParams.get("dancr_role")) ||
      readCallbackRole(readMetadataText(metadata.role)) ||
      readCallbackRoleFromReturnTo(url.searchParams.get("return_to")) ||
      readCallbackRoleFromReturnTo(url.searchParams.get("redirect_to"));
    const admin = createAdminSupabaseClient();
    let account = await getAccountByUserId(admin, authData.user.id);
    const existingRole = readCallbackRole(account?.role);
    const authoritativeRole = existingRole || (!account ? roleHint : null);
    if (authoritativeRole) {
      await ensureCallbackAccount(admin, authData.user, authoritativeRole);
      account = await getAccountByUserId(admin, authData.user.id);
    }

    return {
      accessToken: authData.session?.access_token,
      refreshToken: authData.session?.refresh_token,
      expiresAt: authData.session?.expires_at,
      account,
    };
  } catch (error) {
    console.error("AUTH_CALLBACK_ACCOUNT_SYNC_FAILED", {
      userId: authData.user.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      accessToken: authData.session?.access_token,
      refreshToken: authData.session?.refresh_token,
      expiresAt: authData.session?.expires_at,
      account: null,
    };
  }
}

async function confirmSupabaseCallback(url: URL): Promise<{ session: CallbackSession; user: CallbackUser } | null> {
  const client = createServerSupabaseClient();
  const code = url.searchParams.get("code");
  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !data.session || !data.user) return null;
    return { session: data.session, user: data.user };
  }

  const tokenHash = url.searchParams.get("token_hash");
  if (!tokenHash) return null;

  const { data, error } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: readOtpType(url.searchParams.get("type")),
  });
  if (error || !data.user) return null;

  return { session: data.session, user: data.user };
}

async function ensureCallbackAccount(admin: AdminClient, user: CallbackUser, role: CallbackRole) {
  const metadata = user.user_metadata || {};
  const email = user.email?.toLowerCase() || readMetadataText(metadata.email).toLowerCase();
  const displayName =
    readMetadataText(metadata.display_name) ||
    readMetadataText(metadata.stage_name) ||
    readMetadataText(metadata.venue_name) ||
    displayNameFromEmail(email, role);

  const { error: accountError } = await admin.from("app_users").upsert({
    id: user.id,
    role,
    display_name: displayName,
    email,
  });
  if (accountError) throw accountError;

  if (role === "customer") {
    const { error } = await admin.from("customer_profiles").upsert({
      user_id: user.id,
      city: readMetadataText(metadata.city) || "Las Vegas",
    });
    if (error) throw error;
    return;
  }

  if (role === "dancer") {
    await ensureCallbackDancerProfile(admin, user.id, displayName, metadata);
  }
}

async function ensureCallbackDancerProfile(
  admin: AdminClient,
  userId: string,
  displayName: string,
  metadata: Record<string, unknown>,
) {
  const stageName = readMetadataText(metadata.stage_name) || displayName || "New Dancer";
  const city = readMetadataText(metadata.city) || "Las Vegas";

  const { data: existingProfile, error: existingProfileError } = await admin
    .from("dancer_profiles")
    .select("id, status, verification_status, is_public, disabled_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingProfileError) throw existingProfileError;

  if (existingProfile) {
    console.log("EXISTING_DANCER_PROFILE_PRESERVED_DURING_EMAIL_CALLBACK", {
      dancerId: existingProfile.id,
      status: existingProfile.status,
      verificationStatus: existingProfile.verification_status,
      isPublic: existingProfile.is_public,
      disabledAt: existingProfile.disabled_at,
    });
    return;
  }

  const slug = await uniqueDancerSlug(admin, stageName, userId);
  const { error } = await admin.from("dancer_profiles").insert({
    user_id: userId,
    real_name: null,
    stage_name: stageName,
    slug,
    city,
    status: "draft",
    verification_status: "pending",
    is_public: false,
  });
  if (error) throw error;
}

async function uniqueDancerSlug(admin: AdminClient, stageName: string, userId: string) {
  const baseSlug = slugify(stageName) || `dancer-${userId.slice(0, 8)}`;
  let candidate = baseSlug;
  let suffix = 1;

  while (true) {
    const { data, error } = await admin
      .from("dancer_profiles")
      .select("user_id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.user_id === userId) return candidate;

    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }
}

function readCallbackRole(value: unknown): CallbackRole | null {
  return value === "customer" || value === "dancer" || value === "venue" ? value : null;
}

function readOtpType(value: string | null) {
  if (
    value === "signup" ||
    value === "invite" ||
    value === "magiclink" ||
    value === "recovery" ||
    value === "email_change" ||
    value === "email"
  ) {
    return value;
  }
  return "signup";
}

function readCallbackRoleFromReturnTo(value: string | null): CallbackRole | null {
  if (!value) return null;

  try {
    const pathname = value.startsWith("http") ? new URL(value).pathname : value;
    if (pathname.startsWith("/dashboard/dancer")) return "dancer";
    if (pathname.startsWith("/dashboard/customer")) return "customer";
    if (pathname.startsWith("/dashboard/venue")) return "venue";
    return null;
  } catch {
    return null;
  }
}

function readMetadataText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function displayNameFromEmail(email: string, role: CallbackRole) {
  const fallback = role === "dancer" ? "Dancer" : role === "venue" ? "Venue" : "Customer";
  return email.split("@")[0]?.trim() || fallback;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
