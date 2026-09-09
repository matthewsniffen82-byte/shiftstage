import { provisionAppAccount } from "@/src/lib/dancr/account-provisioning";
import { getAccountByUserId } from "@/src/lib/dancr/auth";
import { BROWSER_AUTH_SESSION_KEY } from "@/src/lib/dancr/browser-session";
import { safeLocalReturnPath } from "@/src/lib/dancr/safe-return-path";
import { safeErrorMetadata } from "@/src/lib/security/safe-error-metadata";
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
  let callbackSession: Awaited<ReturnType<typeof readCallbackSession>> = null;
  let unavailable = false;
  try {
    callbackSession = await readCallbackSession(request);
  } catch (error) {
    unavailable = true;
    console.warn("AUTH_CALLBACK_TEMPORARILY_UNAVAILABLE", safeErrorMetadata(error));
  }
  const redirectPath = callbackRedirectPath(request, callbackSession);
  const role = callbackRole(request, callbackSession);
  const showDancerConfirmation = role === "dancer" && !isPasswordResetCallback(request);

  return new Response(callbackHtml(callbackSession, redirectPath, showDancerConfirmation, isPasswordResetCallback(request), unavailable), {
    status: unavailable ? 503 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      expires: "0",
      pragma: "no-cache",
      "referrer-policy": "no-referrer",
    },
  });
}

function callbackRedirectPath(request: Request, callbackSession: Awaited<ReturnType<typeof readCallbackSession>>) {
  const url = new URL(request.url);
  if (isPasswordResetCallback(request)) return "/account/reset-password";
  const explicitReturnTo = safeLocalReturnPath(url.searchParams.get("return_to"));
  const accountRole = callbackSession?.account?.role;
  const role = callbackRole(request, callbackSession);

  if (role && isLiveAppDestination(explicitReturnTo)) {
    return liveAppCallbackPath(url, role);
  }
  if (explicitReturnTo) return explicitReturnTo;
  if (accountRole === "admin") return "/admin";
  if (role) return liveAppCallbackPath(url, role);
  return "/?auth=login";
}

function callbackRole(request: Request, callbackSession: Awaited<ReturnType<typeof readCallbackSession>>) {
  const url = new URL(request.url);
  const explicitReturnTo = safeLocalReturnPath(url.searchParams.get("return_to"));
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

function isLiveAppDestination(value: string) {
  if (!value) return true;

  try {
    const pathname = new URL(value, "https://mydancr.com").pathname;
    return pathname === "/" || pathname === "/account" || pathname === "/outputs/index.html" || pathname.startsWith("/dashboard/customer") || pathname.startsWith("/dashboard/dancer") || pathname.startsWith("/dashboard/venue");
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

  if (role === "venue" && !isPasswordReset) return "/dashboard/venue?confirmed=1";

  if (role === "customer" && !isPasswordReset) {
    return "/dashboard/customer?confirmed=1";
  }

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
  passwordReset: boolean,
  unavailable: boolean,
) {
  const sessionJson = JSON.stringify(callbackSession || null).replace(/</g, "\\u003c");
  const redirectJson = JSON.stringify(redirectPath).replace(/</g, "\\u003c");
  const dancerConfirmationJson = JSON.stringify(showDancerConfirmation);
  const sessionKeyJson = JSON.stringify(BROWSER_AUTH_SESSION_KEY);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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
    <link rel="stylesheet" href="/dancr-status-pages.v1.css?v=1">
  </head>
  <body class="dancr-status-page">
    <main id="dancerConfirmation" class="dancr-status-card" hidden>
      <p class="eyebrow">Dancer account</p>
      <span class="dancr-status-mark is-success" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-8" /></svg></span>
      <h1>Email confirmed</h1>
      <p>Your email is verified. Complete the required dancer profile steps before your profile can go live.</p>
      <a id="dancerConfirmationContinue" href="${escapeHtml(redirectPath)}">Complete your profile</a>
    </main>
    <main id="confirmationError" class="dancr-status-card" hidden>
      <p class="eyebrow">MyDancr</p>
      <span class="dancr-status-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 8v4m0 4h.01" /></svg></span>
      <h1>Confirmation link unavailable</h1>
      <p>This link is invalid, already used, or has expired. Try signing in if you already confirmed your email, or request a new email.</p>
      <a href="/?auth=login">Continue to sign in</a>
      ${redirectPath.startsWith("/dashboard/venue") ? '<a href="/venue/confirm-email">Request a new confirmation email</a>' : ""}
    </main>
    <main id="openingDancr" class="dancr-status-card">
      <p class="eyebrow">MyDancr</p>
      <span class="dancr-status-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3" /></svg></span>
      <h1>Opening Dancr</h1>
      <p>Your live account is being connected.</p>
      <a href="${escapeHtml(redirectPath)}">Continue</a>
    </main>
    <main id="temporaryError" class="dancr-status-card" hidden>
      <p class="eyebrow">MyDancr</p>
      <span class="dancr-status-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 11a9 9 0 0 1 16 0M8 14a5 5 0 0 1 8 0M12 18h.01M4 4l16 16" /></svg></span>
      <h1>Unable to connect</h1>
      <p id="temporaryErrorMessage">We couldn't verify this link right now. Check your connection and try opening the email link again. If the link was already used, sign in or request a new email.</p>
      <a href="/?auth=login">Go to sign in</a>
    </main>
    <script>
      const serverSession = ${sessionJson};
      const sessionStorageKey = ${sessionKeyJson};
      const redirectTo = ${redirectJson};
      const showDancerConfirmation = ${dancerConfirmationJson};
      const fragmentParams = new URLSearchParams(window.location.hash ? window.location.hash.slice(1) : "");
      const isPasswordReset = ${JSON.stringify(passwordReset)} || fragmentParams.get("type") === "recovery";
      const redirectUrl = new URL(redirectTo, window.location.origin);
      const serverUnavailable = ${JSON.stringify(unavailable)};

      function showTemporaryError(message) {
        document.getElementById("openingDancr").hidden = true;
        document.getElementById("temporaryError").hidden = false;
        if (message) document.getElementById("temporaryErrorMessage").textContent = message;
      }

      async function validateFragmentSession() {
        const accessToken = fragmentParams.get("access_token") || "";
        const refreshToken = fragmentParams.get("refresh_token") || "";
        return validateSessionTokens(accessToken, refreshToken);
      }

      async function validateSessionTokens(accessToken, refreshToken) {
        if (!accessToken || !refreshToken) return null;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
        const response = await fetch("/api/auth", {
          method: "PUT",
          headers: { "content-type": "application/json", accept: "application/json" },
          cache: "no-store",
          credentials: "same-origin",
          body: JSON.stringify({ accessToken, refreshToken }),
          signal: controller.signal
        });
        const data = await response.json().catch(() => null);
        if (controller.signal.aborted || response.status >= 500 || response.status === 429 || !data) throw new Error("Temporarily unavailable");
        return response.ok && data?.ok && data.session?.accessToken ? data : null;
        } finally { clearTimeout(timeout); }
      }

      async function validateExistingBrowserSession() {
        let raw;
        let stored;
        try {
          raw = localStorage.getItem(sessionStorageKey);
          stored = JSON.parse(raw || "null");
        } catch { return null; }
        if (!stored?.accessToken || !stored?.refreshToken) return null;
        const data = await validateSessionTokens(stored.accessToken, stored.refreshToken);
        // A reply from this tab must not overwrite a newer sign-in or logout.
        if (localStorage.getItem(sessionStorageKey) !== raw) return { changed: true };
        return data?.session?.accessToken && data.account?.role
          ? { ...data.session, account: data.account }
          : null;
      }

      async function completeCallback() {
        if (window.location.hash || window.location.search) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        let startingBrowserSession;
        try {
          startingBrowserSession = localStorage.getItem(sessionStorageKey);
        } catch {
          showTemporaryError("This browser couldn't read your sign-in. Allow site storage, then open the email link again.");
          return;
        }
        let temporarilyUnavailable = serverUnavailable;
        let resumedExistingSession = false;
        let session = serverSession && serverSession.accessToken ? serverSession : null;
        if (!session && fragmentParams.get("access_token")) {
          let confirmation;
          try { confirmation = await validateFragmentSession(); }
          catch (error) { temporarilyUnavailable = true; }
          session = confirmation?.session
            ? { ...confirmation.session, account: confirmation.account || null }
            : null;
        }

        if (!session?.accessToken && !isPasswordReset) {
          try {
            const existing = await validateExistingBrowserSession();
            if (existing?.changed) { window.location.replace("/?auth=login"); return; }
            if (existing?.accessToken) {
              session = existing;
              resumedExistingSession = true;
            }
          } catch { temporarilyUnavailable = true; }
        }
        if (!session?.accessToken && temporarilyUnavailable) { showTemporaryError(); return; }

        if (session?.accessToken) {
          try {
            // A delayed email callback must respect a newer sign-in, refresh or logout.
            if (localStorage.getItem(sessionStorageKey) !== startingBrowserSession) {
              window.location.replace("/?auth=login");
              return;
            }
            localStorage.setItem(sessionStorageKey, JSON.stringify(session));
          } catch (error) {
            showTemporaryError("This browser couldn't save your sign-in. Allow site storage, then sign in again or request a new email link.");
            return;
          }
        }

        if (!session?.accessToken && !isPasswordReset) {
          document.getElementById("openingDancr").hidden = true;
          document.getElementById("confirmationError").hidden = false;
          return;
        }

        if (resumedExistingSession) {
          const role = session.account.role;
          const destination = role === "admin" ? "/admin"
            : ["customer", "dancer", "venue"].includes(role) ? "/dashboard/" + role : "/?auth=login";
          window.location.replace(destination);
          return;
        }

        const authoritativeRole = ["customer", "dancer", "venue"].includes(session?.account?.role)
          ? session.account.role
          : "";
        if (authoritativeRole) {
          if (!isPasswordReset && redirectUrl.pathname.startsWith("/dashboard/") && redirectUrl.pathname.split("/")[2] !== authoritativeRole) {
            redirectUrl.pathname = "/dashboard/" + authoritativeRole;
          }
          if (redirectUrl.pathname === "/account") {
            redirectUrl.pathname = "/";
            redirectUrl.searchParams.set("dancr_confirm", "1");
          }
          redirectUrl.searchParams.set("role", authoritativeRole);
          redirectUrl.searchParams.set("dancr_role", authoritativeRole);
        }
        if (isPasswordReset) {
          redirectUrl.pathname = "/account/reset-password";
          redirectUrl.search = "";
          if (!session?.accessToken) {
            // The reset page rejects this link without clearing an unrelated account.
            redirectUrl.searchParams.set("error", "expired");
          }
        }
        const destination = redirectUrl.pathname + redirectUrl.search;
        const shouldPauseForDancer = !isPasswordReset && showDancerConfirmation && (!session || authoritativeRole === "dancer");

        if (shouldPauseForDancer) {
          document.getElementById("openingDancr").hidden = true;
          if (session?.accessToken) {
            const continueLink = document.getElementById("dancerConfirmationContinue");
            continueLink.href = destination;
            document.getElementById("dancerConfirmation").hidden = false;
          } else {
            document.getElementById("confirmationError").hidden = false;
          }
          return;
        }

        window.location.replace(destination);
      }

      void completeCallback();
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
    const provisioningRole = publicCallbackProvisioningRole(roleHint);
    const authoritativeRole = existingRole || (!account ? provisioningRole : null);
    if (!account && authoritativeRole) {
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
      ...safeErrorMetadata(error),
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
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  if (!code && !tokenHash) return null;

  const client = createServerSupabaseClient();
  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (isTemporaryCallbackError(error)) throw error;
    if (error || !data.session || !data.user) return null;
    return { session: data.session, user: data.user };
  }

  const { data, error } = await client.auth.verifyOtp({
    token_hash: tokenHash!,
    type: readOtpType(url.searchParams.get("type")),
  });
  if (isTemporaryCallbackError(error)) throw error;
  if (error || !data.user) return null;

  return { session: data.session, user: data.user };
}

function isTemporaryCallbackError(error: { status?: number; name?: string } | null) {
  return Boolean(error && (error.status === 0 || error.status === 408 || error.status === 429 || Number(error.status) >= 500 || error.name === "AuthRetryableFetchError"));
}

function publicCallbackProvisioningRole(role: CallbackRole | null) {
  return role === "customer" || role === "dancer" ? role : null;
}

async function ensureCallbackAccount(admin: AdminClient, user: CallbackUser, role: CallbackRole) {
  const metadata = user.user_metadata || {};
  const email = user.email?.toLowerCase() || readMetadataText(metadata.email).toLowerCase();
  const submittedDisplayName =
    readMetadataText(metadata.display_name) ||
    readMetadataText(metadata.venue_name);
  const displayName = role === "dancer"
    ? "Dancer"
    : submittedDisplayName || displayNameFromEmail(email, role);

  await provisionAppAccount(admin, {
    role,
    userId: user.id,
    email,
    displayName,
    city: role === "customer"
      ? readMetadataText(metadata.city) || "Las Vegas"
      : readMetadataText(metadata.city),
    existingDancerLogEvent: "EXISTING_DANCER_PROFILE_PRESERVED_DURING_EMAIL_CALLBACK",
  });
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
  const fallback = role === "dancer" ? "Dancer" : role === "venue" ? "Venue" : "Guest";
  return email.split("@")[0]?.trim() || fallback;
}
