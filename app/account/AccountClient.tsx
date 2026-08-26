"use client";

import { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  clearBrowserAuthSession,
  persistBrowserAuthSession,
  readBrowserAuthSession,
  type BrowserAuthSession,
  type BrowserSessionRole,
} from "@/src/lib/dancr/browser-session";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

type AuthRole = "customer" | "dancer";
type AuthMode = "login" | "signup";
type RecoveryView = "password" | "email" | null;

type NfcAccountContext = {
  tag: { type: "dressing_room" | "cashier"; label: string };
  venue: { name: string; city: string; state: string };
};

export default function AccountClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRole = searchParams.get("role");
  const isVenueAccessRedirect = requestedRole === "venue";
  const venueNfcToken = /^[A-Za-z0-9_-]{40,120}$/.test(searchParams.get("venue_nfc") || "")
    ? String(searchParams.get("venue_nfc"))
    : "";
  const isNfcAuth = Boolean(venueNfcToken);
  const initialRole = isNfcAuth || searchParams.get("role") === "dancer" ? "dancer" : "customer";
  const initialMode = searchParams.get("mode") === "signup" ? "signup" : "login";
  const [role, setRole] = useState<AuthRole>(initialRole);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [city, setCity] = useState("Las Vegas");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isSendingLoginHelp, setIsSendingLoginHelp] = useState(false);
  const [recoveryView, setRecoveryView] = useState<RecoveryView>(null);
  const [recoveryOrigin, setRecoveryOrigin] = useState({ x: "0px", y: "34px" });
  const [recoveryAccountName, setRecoveryAccountName] = useState("");
  const [recoveryCity, setRecoveryCity] = useState("Las Vegas");
  const [recoveryContactEmail, setRecoveryContactEmail] = useState("");
  const [recoveryDetails, setRecoveryDetails] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [existingSessionRole, setExistingSessionRole] = useState<BrowserSessionRole | null>(null);
  const [nfcAccountContext, setNfcAccountContext] = useState<NfcAccountContext | null>(null);
  const [nfcContextStatus, setNfcContextStatus] = useState<"idle" | "loading" | "ready" | "error">(isNfcAuth ? "loading" : "idle");
  const customerBenefitsRef = useRef<HTMLElement | null>(null);
  const customerEmailRef = useRef<HTMLInputElement | null>(null);
  const passwordRecoveryEmailRef = useRef<HTMLInputElement | null>(null);
  const recoveryAccountNameRef = useRef<HTMLInputElement | null>(null);
  const recoveryTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isVenueAccessRedirect) return;
    const destination = new URL("/", window.location.origin);
    destination.searchParams.set("venueAccess", "1");
    destination.searchParams.set("venueMode", searchParams.get("mode") === "signup" ? "signup" : "login");
    const returnTo = searchParams.get("return_to") || "";
    if (returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      destination.searchParams.set("return_to", returnTo);
    }
    window.location.replace(destination.toString());
  }, [isVenueAccessRedirect, searchParams]);

  useEffect(() => {
    if (!venueNfcToken) return;
    let cancelled = false;
    setNfcContextStatus("loading");

    async function loadNfcAccountContext() {
      try {
        const response = await fetch(`/api/nfc/${encodeURIComponent(venueNfcToken)}`, {
          headers: { accept: "application/json" },
          cache: "no-store",
          credentials: "same-origin",
        });
        const data = await response.json() as { ok?: boolean; error?: string; tag?: NfcAccountContext["tag"]; venue?: NfcAccountContext["venue"] };
        if (!response.ok || !data.ok || !data.tag || !data.venue) {
          throw new Error(data.error || "Unable to load this venue tap.");
        }
        if (data.tag.type !== "dressing_room") {
          throw new Error("This sticker is not set up for dancer venue access.");
        }
        if (cancelled) return;
        setNfcAccountContext({ tag: data.tag, venue: data.venue });
        setNfcContextStatus("ready");
      } catch {
        if (cancelled) return;
        setNfcAccountContext(null);
        setNfcContextStatus("error");
      }
    }

    void loadNfcAccountContext();
    return () => { cancelled = true; };
  }, [venueNfcToken]);

  const destination = useMemo(() => (role === "dancer" ? "/dashboard/dancer" : "/dashboard/customer"), [role]);
  const isCustomerSignup = role === "customer" && mode === "signup";
  const isDancerSignup = role === "dancer" && mode === "signup";

  const closeRecovery = useCallback(() => {
    setRecoveryView(null);
    window.setTimeout(() => recoveryTriggerRef.current?.focus({ preventScroll: true }), 0);
  }, []);

  const scrollCustomerBenefitsToTop = useCallback((behavior: ScrollBehavior = "smooth") => {
    const benefits = customerBenefitsRef.current;
    if (!benefits) return;
    const top = benefits.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top: Math.max(0, top), behavior });
  }, []);

  const scrollCustomerFieldsToTop = useCallback(() => {
    const emailField = customerEmailRef.current;
    if (!emailField) return;
    const top = emailField.getBoundingClientRect().top + window.scrollY - 18;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    window.setTimeout(() => emailField.focus({ preventScroll: true }), 260);
  }, []);

  useEffect(() => {
    const session = readBrowserAuthSession();
    const hasAccessToken = typeof session?.accessToken === "string" && Boolean(session.accessToken);
    setExistingSessionRole(hasAccessToken ? session.account?.role || null : null);
  }, []);

  useEffect(() => {
    if (!isCustomerSignup) return;
    let settleTimer: number | undefined;
    let finalTimer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      scrollCustomerBenefitsToTop("smooth");
      settleTimer = window.setTimeout(() => scrollCustomerBenefitsToTop("smooth"), 180);
      finalTimer = window.setTimeout(() => scrollCustomerBenefitsToTop("smooth"), 360);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
      if (finalTimer) window.clearTimeout(finalTimer);
    };
  }, [isCustomerSignup, scrollCustomerBenefitsToTop]);

  useEffect(() => {
    if (!recoveryView) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRecovery();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeRecovery, recoveryView]);

  function clearFields() {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setCity("Las Vegas");
    setStatus("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setRecoveryView(null);
    setRecoveryAccountName("");
    setRecoveryCity("Las Vegas");
    setRecoveryContactEmail("");
    setRecoveryDetails("");
    setRecoveryStatus("");
  }

  function openRecovery(view: Exclude<RecoveryView, null>, event: ReactMouseEvent<HTMLButtonElement>) {
    const trigger = event.currentTarget;
    const rect = trigger.getBoundingClientRect();
    recoveryTriggerRef.current = trigger;
    setRecoveryOrigin({
      x: `${rect.left + rect.width / 2 - window.innerWidth / 2}px`,
      y: `${rect.top + rect.height / 2 - window.innerHeight / 2}px`,
    });
    setStatus("");
    setRecoveryStatus("");
    if (view === "email") {
      setRecoveryContactEmail(EMAIL_PATTERN.test(email.trim()) ? email.trim() : "");
      setRecoveryCity(city || "Las Vegas");
    }
    setRecoveryView(view);
    window.setTimeout(() => {
      (view === "password" ? passwordRecoveryEmailRef.current : recoveryAccountNameRef.current)?.focus({ preventScroll: true });
    }, 220);
  }

  function keepFocusInRecovery(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]"),
    ).filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function chooseRole(nextRole: AuthRole) {
    setRole(nextRole);
    clearFields();
  }

  function chooseMode(nextMode: AuthMode) {
    setMode(nextMode);
    clearFields();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (mode === "signup" && role === "customer" && password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    if (mode === "login") {
      setStatus(role === "dancer" ? "Signing in to your dancer account..." : "Signing in to your guest account...");
    }

    const payload: Record<string, string> = { mode, role, email, password };
    if (mode === "signup" && role === "customer") payload.city = city;
    if (mode === "signup" && typeof window !== "undefined") {
      const requestedReturnTo = searchParams.get("return_to") || "";
      const safeReturnTo = requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
        ? requestedReturnTo
        : "";
      const returnTo = role === "dancer" ? safeReturnTo || "/dashboard/dancer" : "/";
      payload.emailRedirectTo = `${window.location.origin}/auth/callback?dancr_confirm=1&role=${encodeURIComponent(role)}&return_to=${encodeURIComponent(returnTo)}`;
    }

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(friendlyAuthErrorMessage(data.error, "Unable to sign in."));

      if (mode === "signup") {
        setStatus(
          role === "customer"
            ? `Confirmation email sent to ${email}. After confirmation, Mydancr will open the homepage signed in.`
            : `Confirmation email sent to ${email}. Check your email or spam folder, then tap Confirm email to open your three-step dancer profile setup.`,
        );
        clearBrowserAuthSession();
        return;
      }

      if (data.requiresEmailConfirmation || !data.session?.accessToken) {
        setStatus("Check your email to confirm the account before signing in.");
        return;
      }

      const session: BrowserAuthSession = {
        accessToken: data.session.accessToken,
        refreshToken: data.session.refreshToken,
        expiresAt: data.session.expiresAt,
        account: data.account,
      };
      if (!persistBrowserAuthSession(session)) {
        throw new Error("Unable to save your sign-in in this browser.");
      }
      setExistingSessionRole(data.account?.role || role);
      setStatus(role === "dancer" ? "Signed in. Opening your dancer dashboard..." : "Signed in. Opening your dashboard...");
      const requestedReturnTo = searchParams.get("return_to") || "";
      const safeReturnTo = requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
        ? requestedReturnTo
        : "";
      router.push(safeReturnTo || destination);
    } catch (error) {
      setStatus(friendlyAuthErrorMessage(error instanceof Error ? error.message : "", "Unable to sign in."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function sendPasswordReset() {
    setRecoveryStatus("");

    if (!email.trim()) {
      setRecoveryStatus("Enter the email used for your account.");
      return;
    }

    setIsResettingPassword(true);

    try {
      const resetReturnTo = role === "dancer" ? "/dashboard/dancer" : "/dashboard/customer";
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "reset_password",
          role,
          email,
          emailRedirectTo:
            typeof window === "undefined"
              ? undefined
              : `${window.location.origin}/auth/callback?dancr_reset=1&role=${encodeURIComponent(role)}&return_to=${encodeURIComponent(resetReturnTo)}`,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(friendlyAuthErrorMessage(data.error, "Unable to send reset email."));
      setRecoveryStatus("If that email has a MyDancr account, we sent a secure reset link. Check the newest email and your spam folder.");
    } catch (error) {
      setRecoveryStatus(friendlyAuthErrorMessage(error instanceof Error ? error.message : "", "Unable to send reset email."));
    } finally {
      setIsResettingPassword(false);
    }
  }

  async function submitLoginRecovery() {
    setRecoveryStatus("");
    setIsSendingLoginHelp(true);
    try {
      const response = await fetch("/api/account-recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role,
          accountName: recoveryAccountName,
          city: recoveryCity,
          contactEmail: recoveryContactEmail,
          details: recoveryDetails,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to submit account recovery request.");
      setRecoveryStatus(`${data.message} Reference: ${data.reference}.`);
      setRecoveryDetails("");
    } catch (error) {
      setRecoveryStatus(error instanceof Error ? error.message : "Unable to submit account recovery request.");
    } finally {
      setIsSendingLoginHelp(false);
    }
  }

  if (isVenueAccessRedirect) {
    return (
      <main className="account-shell">
        <AccountStyles />
        <p className="status" role="status">Opening secure venue access…</p>
      </main>
    );
  }

  const nfcReturnHref = venueNfcToken ? `/nfc/${venueNfcToken}` : "/";
  const nfcVenueName = nfcAccountContext?.venue.name || "this venue";

  return (
    <main className={`account-shell${isNfcAuth ? " nfc-account-shell" : ""}`}>
      <AccountStyles />
      {isNfcAuth ? (
        <header className="nfc-account-header">
          <Link className="brand nfc-brand" href="/" aria-label="MyDancr home">mydancr</Link>
          <Link className="nfc-back-link" href={nfcReturnHref}>Back to venue tap</Link>
        </header>
      ) : (
        <nav className="top-nav" aria-label="Primary">
          <Link className="brand" href="/">
            Mydancr
          </Link>
          <div className="nav-links">
            <Link href={homeDiscoveryHref("tonight")}>Now</Link>
            <Link href={homeDiscoveryHref("dancers")}>Dancers</Link>
            <Link href={homeDiscoveryHref("venues")}>Venues</Link>
            <Link href={homeDiscoveryHref("tv")}>MyDancr TV</Link>
          </div>
        </nav>
      )}

      <section className={`account-grid${isNfcAuth ? " nfc-account-grid" : ""}`}>
        <div className="account-copy">
          {isNfcAuth ? (
            <>
              <div className="nfc-account-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M7 7.5a6.4 6.4 0 0 1 0 9M10 5a10 10 0 0 1 0 14M13 2.5a13.5 13.5 0 0 1 0 19" /></svg>
              </div>
              <span className="eyebrow">Verified dressing-room tap</span>
              <h1>Connect to {nfcVenueName}.</h1>
              <p>
                {mode === "login"
                  ? "Sign in to your dancer account. MyDancr will return to this sticker and confirm the venue connection automatically."
                  : "Create your dancer login, confirm your email, and complete the required profile steps. MyDancr keeps this venue connection saved while you finish."}
              </p>
              <div className={`nfc-venue-context ${nfcContextStatus}`} role="status" aria-live="polite">
                <span className="nfc-venue-dot" aria-hidden="true" />
                <span>
                  <strong>{nfcContextStatus === "loading" ? "Checking venue…" : nfcAccountContext?.venue.name || "Venue connection saved"}</strong>
                  <small>{nfcAccountContext
                    ? `${nfcAccountContext.venue.city}, ${nfcAccountContext.venue.state} · ${nfcAccountContext.tag.label}`
                    : nfcContextStatus === "error"
                      ? "Return to the sticker after signing in to verify it again."
                      : "Secure MyDancr tap"}</small>
                </span>
              </div>
              <ol className="nfc-account-steps" aria-label="Venue connection steps">
                <li><span>1</span><strong>Use a dancer account</strong></li>
                <li><span>2</span><strong>Finish required setup if new</strong></li>
                <li><span>3</span><strong>Venue affiliation activates automatically</strong></li>
              </ol>
            </>
          ) : (
            <>
              <span className="eyebrow">Live account</span>
              <h1>{role === "dancer" ? "Manage your dancer profile." : "Save your night out."}</h1>
              <p>
                Sign in with a secure Mydancr account to manage saved profiles, private alerts, Club Deals, and dashboard data.
              </p>
            </>
          )}
        </div>

        <form className={`account-panel account-panel-${role}${isNfcAuth ? " account-panel-nfc" : ""}`} onSubmit={submit}>
          {!isCustomerSignup ? (
            <>
              {isNfcAuth ? (
                <div className="nfc-dancer-lock"><span aria-hidden="true">✓</span> Dancer account</div>
              ) : (
                <div className="segmented" aria-label="Account type">
                  <button className={role === "customer" ? "active" : ""} type="button" onClick={() => chooseRole("customer")}>
                    Guest
                  </button>
                  <button className={role === "dancer" ? "active" : ""} type="button" onClick={() => chooseRole("dancer")}>
                    Dancer
                  </button>
                </div>
              )}

              <div className="segmented" aria-label="Auth mode">
                <button className={mode === "login" ? "active" : ""} type="button" onClick={() => chooseMode("login")}>
                  Sign in
                </button>
                <button className={mode === "signup" ? "active" : ""} type="button" onClick={() => chooseMode("signup")}>
                  Create
                </button>
              </div>
            </>
          ) : null}

          {mode === "login" && role === "dancer" && existingSessionRole === "admin" ? (
            <p className="session-notice" role="status">
              An admin session is active in this browser. Signing in here will safely switch it to your dancer account{isNfcAuth ? ` and return to ${nfcVenueName}` : ""}.
            </p>
          ) : null}

          {mode === "signup" && role === "customer" ? (
            <>
              <section ref={customerBenefitsRef} className="signup-benefits" aria-label="Guest signup benefits">
                <span className="eyebrow">Why join</span>
                <h2>Create your private Mydancr dashboard</h2>
                <button className="continue-signup" type="button" onClick={scrollCustomerFieldsToTop}>
                  Continue to create account
                  <span aria-hidden="true">↓</span>
                </button>
                <div className="customer-benefit-grid">
                  <div className="customer-benefit-tile">
                    <strong>Tap-to-use Club Deals</strong>
                    <span>Choose an offer, then redeem it by tapping the venue&apos;s cashier sticker.</span>
                  </div>
                  <div className="customer-benefit-tile">
                    <strong>Private follows</strong>
                    <span>Follow dancers and venues without a public guest profile.</span>
                  </div>
                  <div className="customer-benefit-tile">
                    <strong>Working now alerts</strong>
                    <span>See when dancers you follow are checked in or posting shifts.</span>
                  </div>
                  <div className="customer-benefit-tile">
                    <strong>Your night dashboard</strong>
                    <span>Manage saved profiles, venues, Club Deals, and alerts quickly.</span>
                  </div>
                </div>
                <p>Your follows and saved Club Deals are private. Confirm your email, then Mydancr opens the homepage signed in.</p>
              </section>
            </>
          ) : null}

          {isDancerSignup ? (
            <>
              <section className="dancer-signup-note" aria-label="Dancer verification next steps">
                <span className="eyebrow">Dancer signup</span>
                <h2>Create your dancer login first</h2>
                <p>{venueNfcToken
                  ? "Your dressing-room tap is saved through account creation. Confirm your email, finish profile setup and media review, then MyDancr approves your eligible profile and activates that venue automatically."
                  : "Confirm your email, then choose your city during onboarding and create your profile with a stage name, socials, avatar, photos, and optional videos. Every image and video is safety-moderated. At a club, tap its official MyDancr dressing-room sticker to approve your eligible profile, authorize that venue, and check in."}</p>
              </section>
            </>
          ) : null}

          <label>
            Email
            <input ref={customerEmailRef} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <span className="password-control">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                type="button"
                onClick={() => setShowPassword((value) => !value)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </span>
          </label>
          {mode === "signup" && role === "customer" ? (
            <label>
              Confirm password
              <span className="password-control">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  minLength={6}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
                <button
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  aria-pressed={showConfirmPassword}
                  type="button"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </span>
            </label>
          ) : null}
          {mode === "login" ? (
            <div className="auth-help-row">
              <button className="forgot-password" type="button" aria-haspopup="dialog" aria-expanded={recoveryView === "password"} onClick={(event) => openRecovery("password", event)}>
                Forgot password?
              </button>
              <button className="forgot-password" type="button" aria-haspopup="dialog" aria-expanded={recoveryView === "email"} onClick={(event) => openRecovery("email", event)}>
                Forgot email?
              </button>
            </div>
          ) : null}
          {mode === "signup" && role === "customer" ? (
            <label>
              City
              <input value={city} onChange={(event) => setCity(event.target.value)} required />
            </label>
          ) : null}
          <button className="submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (mode === "login" ? "Signing in..." : "Creating account...") : mode === "login" ? "Sign in" : "Create account"}
          </button>
          {status ? <p className="status" role="status" aria-live="polite" aria-atomic="true">{status}</p> : null}
        </form>
        {mode === "login" && recoveryView === "password" ? (
          <section className="recovery-popover" role="dialog" aria-modal="true" aria-labelledby="password-recovery-title" onKeyDown={keepFocusInRecovery} onClick={(event) => { if (event.target === event.currentTarget) closeRecovery(); }}>
            <div className="recovery-popover-surface" style={{ "--recovery-shift-x": recoveryOrigin.x, "--recovery-shift-y": recoveryOrigin.y } as CSSProperties}>
              <div className="login-recovery-head">
                <div>
                  <span className="eyebrow">Password recovery</span>
                  <h2 id="password-recovery-title">Reset your password</h2>
                </div>
                <button className="recovery-close" type="button" aria-label="Close password recovery" onClick={closeRecovery}>×</button>
              </div>
              <p>Enter the email used for this account. MyDancr will send a secure reset link if the email matches an account.</p>
              <label>
                Account email
                <input ref={passwordRecoveryEmailRef} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required />
              </label>
              <button className="recovery-submit" type="button" onClick={sendPasswordReset} disabled={isResettingPassword}>
                {isResettingPassword ? "Sending reset link..." : "Send reset link"}
              </button>
              <button className="recovery-cancel" type="button" onClick={closeRecovery}>Back to sign in</button>
              {recoveryStatus ? <p className="recovery-status" role="status" aria-live="polite" aria-atomic="true">{recoveryStatus}</p> : null}
            </div>
          </section>
        ) : null}
        {mode === "login" && recoveryView === "email" ? (
          <section className="recovery-popover" role="dialog" aria-modal="true" aria-labelledby="login-recovery-title" onKeyDown={keepFocusInRecovery} onClick={(event) => { if (event.target === event.currentTarget) closeRecovery(); }}>
            <div className="recovery-popover-surface" style={{ "--recovery-shift-x": recoveryOrigin.x, "--recovery-shift-y": recoveryOrigin.y } as CSSProperties}>
              <div className="login-recovery-head">
                <div>
                  <span className="eyebrow">Email recovery</span>
                  <h2 id="login-recovery-title">Find your sign-in email</h2>
                </div>
                <button className="recovery-close" type="button" aria-label="Close email recovery" onClick={closeRecovery}>×</button>
              </div>
              <p>MyDancr will not display possible account emails. Give support enough information to verify that the account belongs to you.</p>
              <div className="login-recovery-grid">
                <label>
                  {role === "dancer" ? "Stage name" : "Name used on the account"}
                  <input ref={recoveryAccountNameRef} value={recoveryAccountName} onChange={(event) => setRecoveryAccountName(event.target.value)} maxLength={80} required />
                </label>
                <label>
                  Account city
                  <input value={recoveryCity} onChange={(event) => setRecoveryCity(event.target.value)} maxLength={80} placeholder="Las Vegas" required />
                </label>
              </div>
              <label>
                Email where support can reach you
                <input type="email" autoComplete="email" value={recoveryContactEmail} onChange={(event) => setRecoveryContactEmail(event.target.value)} maxLength={254} required />
              </label>
              <label>
                Other details that can help verify the account
                <textarea value={recoveryDetails} onChange={(event) => setRecoveryDetails(event.target.value)} maxLength={1000} rows={4} placeholder="Approximate signup date, profile details, or venues you remember" />
              </label>
              <p className="recovery-security">Never send a password, reset code, government ID, or payment information. Support verifies ownership before providing access.</p>
              <div className="login-recovery-actions">
                <button className="recovery-submit" type="button" onClick={submitLoginRecovery} disabled={isSendingLoginHelp}>
                  {isSendingLoginHelp ? "Sending securely..." : "Send recovery request"}
                </button>
                <button className="recovery-cancel" type="button" onClick={closeRecovery}>Back to sign in</button>
              </div>
              {recoveryStatus ? <p className="recovery-status" role="status" aria-live="polite" aria-atomic="true">{recoveryStatus}</p> : null}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function friendlyAuthErrorMessage(message: string | undefined, fallback: string) {
  const text = message || fallback;
  if (/rate limit/i.test(text)) {
    return "Too many confirmation emails were sent. Please wait a few minutes, then try again, or use the newest confirmation email already in your inbox.";
  }

  return text;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AccountStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .account-shell { min-height: 100vh; padding: 22px clamp(16px, 4vw, 56px) 56px; background: radial-gradient(circle at 82% 2%, rgba(34,199,255,.18), transparent 24rem), radial-gradient(circle at 12% 12%, rgba(139,92,246,.26), transparent 25rem), linear-gradient(180deg, #090911, #050507 66%); }
      .top-nav { max-width: 1080px; margin: 0 auto 42px; display: flex; align-items: center; justify-content: space-between; gap: 18px; color: #cfc5de; }
      .brand { color: #fff; text-decoration: none; font-weight: 950; letter-spacing: .08em; text-transform: uppercase; }
      .nav-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
      .nav-links a { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; padding: 0 14px; border-radius: 999px; color: #fff; text-decoration: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); font-weight: 850; }
      .account-grid { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 430px); gap: clamp(22px, 5vw, 62px); align-items: center; }
      .account-copy { display: grid; gap: 18px; }
      .eyebrow { color: #94e5ff; text-transform: uppercase; letter-spacing: .18em; font-size: 12px; font-weight: 900; }
      h1 { margin: 0; max-width: 720px; font-size: clamp(42px, 7vw, 82px); line-height: .94; letter-spacing: 0; }
      p { margin: 0; color: #cfc5de; font-size: 18px; line-height: 1.6; max-width: 58ch; }
      .account-panel { border: 1px solid rgba(139,92,246,.24); background: rgba(12,12,18,.86); border-radius: 8px; padding: 18px; display: grid; gap: 14px; box-shadow: 0 28px 80px rgba(0,0,0,.38); }
      .segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 5px; border-radius: 8px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
      .segmented button, .submit { min-height: 42px; border: 0; border-radius: 8px; color: #fff; font-weight: 900; cursor: pointer; }
      .segmented button { background: transparent; }
      .segmented button.active { background: linear-gradient(135deg, rgba(139,92,246,.62), rgba(34,199,255,.22)); }
      label { display: grid; gap: 7px; color: #d8cfeb; font-size: 13px; font-weight: 850; }
      input, select { min-height: 42px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 0 12px; font: inherit; }
      select option { color: #fff; background: #111118; }
      input[type="file"] { min-height: auto; padding: 10px 12px; color: #cfc5de; }
      .password-control { position: relative; display: flex; align-items: center; }
      .password-control input { width: 100%; padding-right: 46px; }
      .password-control button { position: absolute; right: 8px; width: 30px; height: 30px; border: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: #d8cfeb; background: rgba(255,255,255,.055); cursor: pointer; }
      .password-control button[aria-pressed="true"], .password-control button:hover { color: #fff; background: rgba(155,92,255,.18); box-shadow: 0 0 16px rgba(155,92,255,.18); }
      .password-control svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .submit { background: #f7f2ff; color: #090911; margin-top: 4px; }
      .submit:disabled { opacity: .62; cursor: wait; }
      .account-panel-customer .segmented button.active,
      .account-panel-customer .submit,
      .account-panel-customer .continue-signup { border: 1px solid rgba(53,216,255,.62); background: linear-gradient(135deg, #061b31 0%, #0a4f88 52%, #1ecfff 100%); color: #fff; box-shadow: 0 12px 28px rgba(14,109,185,.24), 0 0 22px rgba(53,216,255,.2); }
      .account-panel-dancer .segmented button.active { background: linear-gradient(135deg, rgba(139,92,246,.62), rgba(34,199,255,.22)); }
      .account-panel-customer .continue-signup span { color: #8ff2ff; }
      .auth-help-row { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; gap: 10px; }
      .forgot-password { width: 100% !important; min-width: 0 !important; min-height: 44px !important; justify-self: stretch; padding: 0 9px !important; border: 1px solid rgba(248,250,252,.12) !important; border-radius: 12px !important; background: rgba(24,24,29,.94) !important; color: rgba(255,255,255,.88) !important; box-shadow: none !important; font-size: clamp(11.5px, 3.2vw, 13px) !important; font-weight: 900; line-height: 1.15 !important; text-align: center; white-space: nowrap; cursor: pointer; }
      .forgot-password:hover, .forgot-password:focus-visible { border-color: var(--dancr-color-brand-primary-medium) !important; color: #fff !important; outline: 0 !important; box-shadow: var(--dancr-focus-ring) !important; }
      .forgot-password:disabled { opacity: .62; cursor: wait; }
      .recovery-popover { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: max(18px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom)); background: rgba(2,2,5,.74); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
      .recovery-popover-surface { width: min(100%, 480px); max-height: min(82dvh, 680px); overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 13px; box-sizing: border-box; padding: 18px; border: 1px solid rgba(248,250,252,.16); border-radius: 18px; background: rgba(10,10,15,.98); box-shadow: 0 24px 70px rgba(0,0,0,.58), 0 0 0 1px rgba(255,255,255,.025) inset; animation: recovery-popover-in 220ms cubic-bezier(.2,.82,.26,1) both; }
      @keyframes recovery-popover-in { from { opacity: .22; transform: translate(var(--recovery-shift-x, 0), var(--recovery-shift-y, 34px)) scale(.2); } to { opacity: 1; transform: translate(0, 0) scale(1); } }
      @media (prefers-reduced-motion: reduce) { .recovery-popover-surface { animation-duration: 1ms; } }
      .login-recovery-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .recovery-popover h2 { margin: 3px 0 0; font-size: 21px; }
      .recovery-popover p { margin: 0; color: #d8cfeb; font-size: 13px; line-height: 1.45; }
      .login-recovery-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .recovery-popover textarea { width: 100%; resize: vertical; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #fff; padding: 10px 12px; font: inherit; box-sizing: border-box; }
      .recovery-close { width: 34px; height: 34px; flex: 0 0 34px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; color: #fff; background: rgba(255,255,255,.06); font-size: 22px; cursor: pointer; }
      .login-recovery-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .recovery-submit, .recovery-cancel { min-height: 44px; border-radius: 10px; padding: 0 14px; font-weight: 900; cursor: pointer; }
      .recovery-submit { border: 1px solid rgba(53,216,255,.55); color: #fff; background: linear-gradient(135deg, #061b31, #0a4f88 55%, #1ecfff); }
      .recovery-cancel { border: 1px solid rgba(255,255,255,.12); color: #fff; background: rgba(255,255,255,.05); }
      .recovery-submit:disabled { opacity: .62; cursor: wait; }
      .recovery-security { padding: 10px 11px; border-left: 3px solid #94e5ff; background: rgba(148,229,255,.06); }
      .recovery-status { color: #94e5ff !important; font-weight: 800; }
      .status { color: #94e5ff; font-size: 14px; }
      .session-notice { padding: 11px 12px; border: 1px solid rgba(148,229,255,.22); border-radius: 8px; color: #dff8ff; background: rgba(34,199,255,.07); font-size: 13px; line-height: 1.45; }
      .signup-benefits { scroll-margin-top: 12px; display: grid; gap: 10px; padding: 14px; border: 1px solid rgba(34,199,255,.28); border-radius: 8px; background: linear-gradient(135deg, rgba(34,199,255,.08), rgba(139,92,246,.14)); }
      .signup-benefits h2 { margin: 0; font-size: 20px; }
      .signup-benefits p { font-size: 14px; line-height: 1.45; }
      .continue-signup { justify-self: start; min-height: 38px; display: inline-flex; align-items: center; gap: 8px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(139,92,246,.52); color: #fff; background: rgba(5,5,9,.62); font-weight: 900; box-shadow: 0 0 18px rgba(139,92,246,.16); cursor: pointer; }
      .continue-signup span { color: #94e5ff; font-size: 15px; transform: translateY(-1px); }
      .continue-signup:hover, .continue-signup:focus-visible { border-color: rgba(34,199,255,.64); box-shadow: 0 0 24px rgba(34,199,255,.16), 0 0 20px rgba(139,92,246,.18); outline: none; }
      .customer-benefit-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .customer-benefit-tile { display: grid; gap: 5px; min-width: 0; padding: 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: rgba(255,255,255,.045); box-shadow: inset 0 0 16px rgba(255,255,255,.025); }
      .customer-benefit-tile strong { color: #fff; font-size: 13px; line-height: 1.2; }
      .customer-benefit-tile span { color: #d8cfeb; font-size: 12px; font-weight: 750; line-height: 1.35; }
      .dancer-signup-note { display: grid; gap: 10px; padding: 14px; border: 1px solid rgba(139,92,246,.34); border-radius: 8px; background: linear-gradient(135deg, rgba(139,92,246,.14), rgba(5,5,9,.72)); box-shadow: 0 0 24px rgba(139,92,246,.12); }
      .dancer-signup-note h2 { margin: 0; font-size: 20px; }
      .dancer-signup-note p { font-size: 14px; line-height: 1.45; }
      .nfc-account-shell { padding-top: max(18px, env(safe-area-inset-top)); padding-bottom: max(112px, calc(96px + env(safe-area-inset-bottom))); background: radial-gradient(circle at 50% -8%, rgba(124,58,237,.3), transparent 26rem), radial-gradient(circle at 82% 30%, rgba(34,211,238,.08), transparent 22rem), #050507; }
      .nfc-account-header { width: min(100%, 920px); min-height: 60px; margin: 0 auto clamp(24px,5vw,52px); display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 2px 14px; border-bottom: 1px solid rgba(248,250,252,.1); }
      .nfc-brand { position: relative; color: #f8fafc; font-size: 25px; letter-spacing: -.055em; text-transform: lowercase; text-shadow: 0 0 20px rgba(124,58,237,.4); }
      .nfc-brand::after { content: ""; position: absolute; right: -3px; bottom: 3px; width: 19px; height: 2px; border-radius: 999px; background: #7c3aed; box-shadow: 0 0 12px rgba(124,58,237,.68); }
      .nfc-back-link { min-height: 40px; display: inline-flex; align-items: center; padding: 0 13px; border: 1px solid rgba(248,250,252,.14); border-radius: 999px; color: #f8fafc; background: rgba(17,17,24,.78); text-decoration: none; font-size: 12px; font-weight: 900; }
      .nfc-account-grid { width: min(100%, 920px); grid-template-columns: minmax(0,1fr) minmax(320px,420px); align-items: start; }
      .nfc-account-grid .account-copy { gap: 14px; }
      .nfc-account-grid h1 { max-width: 620px; font-size: clamp(38px,6vw,68px); line-height: .98; }
      .nfc-account-grid .account-copy>p { color: #cbd5e1; font-size: clamp(15px,2.1vw,18px); line-height: 1.55; }
      .nfc-account-mark { width: 72px; height: 72px; display: grid; place-items: center; border: 1px solid rgba(248,250,252,.16); border-radius: 22px; color: #f8fafc; background: radial-gradient(circle at 42% 34%,rgba(124,58,237,.42),transparent 58%),#111118; box-shadow: 0 16px 40px rgba(0,0,0,.42),0 0 28px rgba(124,58,237,.14); }
      .nfc-account-mark svg { width: 38px; height: 38px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
      .nfc-venue-context { min-height: 62px; display: flex; align-items: center; gap: 12px; box-sizing: border-box; margin-top: 4px; padding: 12px 14px; border: 1px solid rgba(34,211,238,.28); border-radius: 16px; background: rgba(17,17,24,.84); box-shadow: inset 0 1px 0 rgba(248,250,252,.035); }
      .nfc-venue-context.error { border-color: rgba(251,191,36,.28); }
      .nfc-venue-dot { width: 11px; height: 11px; flex: 0 0 11px; border: 2px solid rgba(248,250,252,.92); border-radius: 50%; background: #22d3ee; box-shadow: 0 0 14px rgba(34,211,238,.5); }
      .nfc-venue-context.error .nfc-venue-dot { background: #fbbf24; box-shadow: 0 0 14px rgba(251,191,36,.36); }
      .nfc-venue-context>span:last-child { min-width: 0; display: grid; gap: 3px; }
      .nfc-venue-context strong { color: #f8fafc; font-size: 14px; }
      .nfc-venue-context small { overflow: hidden; color: #94a3b8; font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
      .nfc-account-steps { display: grid; gap: 9px; margin: 4px 0 0; padding: 0; list-style: none; }
      .nfc-account-steps li { display: flex; align-items: center; gap: 10px; color: #cbd5e1; font-size: 13px; }
      .nfc-account-steps li span { width: 25px; height: 25px; display: grid; place-items: center; flex: 0 0 25px; border: 1px solid rgba(124,58,237,.48); border-radius: 50%; color: #f8fafc; background: rgba(124,58,237,.16); font-size: 11px; }
      .account-panel-nfc { border-color: rgba(248,250,252,.16); border-radius: 20px; background: linear-gradient(155deg,rgba(17,17,24,.97),rgba(5,5,7,.96)); box-shadow: 0 26px 72px rgba(0,0,0,.48),inset 0 1px 0 rgba(248,250,252,.04); }
      .nfc-dancer-lock { min-height: 42px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid rgba(34,211,238,.24); border-radius: 12px; color: #f8fafc; background: rgba(34,211,238,.055); font-size: 13px; font-weight: 900; }
      .nfc-dancer-lock span { width: 19px; height: 19px; display: grid; place-items: center; border-radius: 50%; color: #050507; background: #22d3ee; font-size: 12px; }
      .account-panel-nfc .segmented { border-radius: 12px; background: rgba(248,250,252,.035); }
      .account-panel-nfc .segmented button { border-radius: 9px; }
      .account-panel-nfc.account-panel-dancer .segmented button.active,
      .account-panel-nfc .submit { border: 1px solid rgba(166,126,255,.5); color: #f8fafc; background: linear-gradient(135deg,#7c3aed,#4c1d95); box-shadow: 0 10px 26px rgba(124,58,237,.24),0 0 18px rgba(124,58,237,.14); }
      .account-panel-nfc input,.account-panel-nfc select { border-color: rgba(248,250,252,.15); background: #111118; }
      @media (max-width: 780px) { .account-grid { grid-template-columns: 1fr; } }
      @media (max-width: 780px) { .nfc-account-grid { gap: 22px; } .nfc-account-grid .account-copy { max-width: 620px; } .nfc-account-grid h1 { font-size: clamp(36px,10vw,52px); } }
      @media (max-width: 520px) { .top-nav { align-items: flex-start; flex-direction: column; } .nav-links { justify-content: flex-start; } h1 { font-size: 40px; } .customer-benefit-grid, .login-recovery-grid { grid-template-columns: 1fr; } .login-recovery-actions { display: grid; grid-template-columns: 1fr; } .recovery-submit, .recovery-cancel { width: 100%; } .nfc-account-shell { padding-inline: 18px; } .nfc-account-header { margin-bottom: 22px; } .nfc-back-link { min-height: 38px; padding-inline: 11px; font-size: 11px; } .nfc-account-grid .account-copy { gap: 11px; } .nfc-account-mark { width: 58px; height: 58px; border-radius: 18px; } .nfc-account-mark svg { width: 31px; height: 31px; } .nfc-account-grid h1 { font-size: clamp(34px,10.5vw,44px); } .nfc-account-steps { display: none; } .account-panel-nfc { padding: 15px; } }
      @media (max-width: 340px) { .auth-help-row { grid-template-columns: 1fr; } }
    `}</style>
  );
}
