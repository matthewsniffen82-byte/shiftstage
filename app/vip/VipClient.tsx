"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/app/components/PasswordField";
import { BROWSER_AUTH_SESSION_KEY, captureBrowserAuthSessionGuard, persistBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { readSession, requestDashboardJson, revokeDashboardSession, type StoredDashboardSession } from "@/app/dashboard/dashboard-session";
import type { VipInvitation } from "@/src/lib/dancr/vip-types";
import { ACCESS_TERMS_HREF, ACCESS_TERMS_VERSION, VIP_ACCESS_NOTICE } from "@/src/lib/dancr/access-terms";
import dynamic from "next/dynamic";
import { USER_TERMS_HREF, USER_TERMS_VERSION } from "@/src/lib/dancr/user-terms-version";
import { vipPlannerPath, vipPasswordSetupPath } from "@/src/lib/dancr/vip-entry";
import "./vip-premium.css";

const VipDashboard = dynamic(() => import("./VipDashboard"), { loading: () => <main className="vip-shell vip-dashboard-shell"><div className="vip-container vip-loading" role="status">Opening your VIP lounge…</div></main> });

export default function VipClient({ token = "", initialVenueId = "" }: { token?: string; initialVenueId?: string }) {
  const [session, setSession] = useState<StoredDashboardSession | null>(null);
  const [ready, setReady] = useState(false);
  const [invitation, setInvitation] = useState<VipInvitation | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [signupTermsAccepted, setSignupTermsAccepted] = useState(false);
  const [mode, setMode] = useState<"choose" | "login" | "signup" | "reset_password" | "setup_password">("login");
  const [emailStep, setEmailStep] = useState<"signup" | "reset_password" | "setup_password" | null>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [status, setStatus] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [setupCheck, setSetupCheck] = useState<"loading" | "ready" | "needed" | "error">("loading");
  const [setupAttempt, setSetupAttempt] = useState(0);
  const lock = useRef(false); const mounted = useRef(false);
  const customer = session?.account?.role === "customer";

  useEffect(() => {
    mounted.current = true;
    setSession(readSession()); setReady(true);
    const changed = (event: StorageEvent) => {
      if (event.key !== BROWSER_AUTH_SESSION_KEY && event.key !== null) return;
      setSession(readSession()); setPassword(""); setName(""); setStatus(""); setError(""); setTermsAccepted(false); setEmailStep(null); setSignupTermsAccepted(false);
    };
    window.addEventListener("storage", changed);
    return () => { mounted.current = false; window.removeEventListener("storage", changed); };
  }, []);

  useEffect(() => {
    setInvitation(null); setInviteError(""); setTermsAccepted(false); setEmailStep(null); setPassword(""); setSignupTermsAccepted(false);
    if (!token) return;
    const controller = new AbortController();
    setMode("choose");
    fetch("/api/vip/invitation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), signal: controller.signal, cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || "Unable to open invitation."); if (!controller.signal.aborted) setInvitation(data.invitation); })
      .catch(failure => { if (!controller.signal.aborted) setInviteError(failure.message); });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    setSetupCheck("loading");
    if (!customer || !token || !invitation) return;
    const controller = new AbortController();
    const accountId = session?.account?.id;
    requestDashboardJson("/api/account", { expectedRole: "customer", cache: "no-store", timeoutMs: 20000, signal: controller.signal })
      .then(data => { if (!controller.signal.aborted && readSession()?.account?.id === accountId) setSetupCheck(data.passwordSetupComplete === true ? "ready" : "needed"); })
      .catch(() => { if (!controller.signal.aborted && readSession()?.account?.id === accountId) setSetupCheck("error"); });
    return () => controller.abort();
  }, [customer, token, invitation, session?.account?.id, setupAttempt]);

  useEffect(() => {
    if (!resendSeconds) return;
    const timer = window.setTimeout(() => setResendSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  function chooseMode(next: typeof mode) {
    setMode(next); setEmailStep(null); setPassword(""); setError(""); setStatus(""); setSignupTermsAccepted(false);
  }
  function emailRedirect(reset = false, setup = false) {
    const redirect = new URL("/auth/callback", window.location.origin);
    const returnTo = token ? `/vip/invite/${encodeURIComponent(token)}` : "/vip";
    redirect.searchParams.set("return_to", reset ? "/account/reset-password" : returnTo);
    if (reset) { redirect.searchParams.set("type", "recovery"); redirect.searchParams.set("vip_return_to", returnTo); }
    if (setup) redirect.searchParams.set("vip_setup", "1");
    return redirect.toString();
  }
  function invitationEmailRequest(step: "signup" | "setup_password") {
    return { token, email, action: step === "signup" ? "start" : "resume",
      ...(step === "signup" ? { userTermsAccepted: signupTermsAccepted, userTermsVersion: USER_TERMS_VERSION } : {}) };
  }

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setStatus("");
    try { await action(); } catch (failure) { if (mounted.current) setError(message(failure)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function authenticate(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (mode === "signup" && !signupTermsAccepted) throw new Error("Please read and accept the User Terms.");
      const unchanged = captureBrowserAuthSessionGuard();
      const invitationEmail = token && (mode === "signup" || mode === "setup_password") ? invitationEmailRequest(mode) : null;
      const response = await fetch(invitationEmail ? "/api/vip/confirmation" : "/api/auth", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify(invitationEmail || { mode: mode === "setup_password" ? "reset_password" : mode, role: "customer", email, password, emailRedirectTo: emailRedirect(mode === "reset_password" || mode === "setup_password", mode === "setup_password") }) });
      const data = await response.json();
      if (!mounted.current) return;
      if (!unchanged()) throw new Error("Your sign-in changed in another window. Refresh to continue.");
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      if (!data.session?.accessToken) {
        if (mode !== "signup" && mode !== "reset_password" && mode !== "setup_password") throw new Error("Sign-in could not be completed. Please try again.");
        setEmailStep(mode); setResendSeconds(60); setPassword(""); return;
      }
      if (data.account?.role !== "customer") throw new Error("Use your MyDancr guest account with the invited email for VIP access.");
      if (!persistBrowserAuthSession({ ...data.session, account: data.account })) throw new Error("Unable to save your sign-in in this browser.");
      setSession(readSession()); setPassword(""); setTermsAccepted(false);
    });
  }
  function resendEmail() {
    if (!emailStep || resendSeconds || busy) return;
    void run(async () => {
      const unchanged = captureBrowserAuthSessionGuard();
      const invitationEmail = token && (emailStep === "signup" || emailStep === "setup_password") ? invitationEmailRequest(emailStep) : null;
      const response = await fetch(invitationEmail ? "/api/vip/confirmation" : "/api/auth", {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify(invitationEmail || { mode: "reset_password", role: "customer", email, emailRedirectTo: emailRedirect(true, emailStep === "setup_password") }),
      });
      const data = await response.json();
      if (!mounted.current || !unchanged()) return;
      if (!response.ok || !data.ok) {
        if (response.status === 429) setResendSeconds(Math.min(600, Math.max(60, Number(response.headers.get("retry-after")) || 60)));
        throw new Error(data.error || "Unable to send another email. Please try again.");
      }
      setResendSeconds(60); setStatus(data.message || "Check your inbox for the newest confirmation email.");
    });
  }
  async function signOut() {
    await run(async () => { await revokeDashboardSession(); if (mounted.current) { setSession(null); setTermsAccepted(false); } });
  }
  function accept(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      if (!termsAccepted) throw new Error("Please read and accept the VIP & Table Access Terms to activate VIP access.");
      const result = await requestDashboardJson("/api/vip/invitation", { expectedRole: "customer", method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name, termsAccepted, termsVersion: ACCESS_TERMS_VERSION, userTermsAccepted: termsAccepted, userTermsVersion: USER_TERMS_VERSION }), timeoutMs: 20000 });
      if (mounted.current) window.location.assign(vipPlannerPath(result.venueId));
    });
  }
  if (ready && customer && session?.accessToken && !token) {
    return <VipDashboard key={session.account?.id || session.account?.email} account={session.account || {}} initialVenueId={initialVenueId} onSignOut={signOut} signingOut={busy} accountError={error} />;
  }
  return <main className="vip-shell vip-auth-shell" data-global-navigation-swipe="ignore"><div className="vip-container">
    <section className="vip-panel vip-entry-card">
    <header className="vip-header"><Link href="/" className="dancr-home-back"><span aria-hidden="true">‹</span> Back to MyDancr</Link>{session?.accessToken && <div className="vip-actions"><button type="button" disabled={busy} onClick={() => void signOut()}>Sign out</button></div>}</header>
    <div className="vip-hero"><span className="vip-eyebrow">{token ? "Private invitation" : "Private access"}</span><h1>{invitation ? `You’re invited to ${invitation.venueName}` : mode === "reset_password" ? "Reset your password" : "VIP sign in"}</h1>{invitation && <p>Plan your visit and request dancers with your venue.</p>}</div>
    {status && <p className="vip-feedback" role="status">{status}</p>}{error && <p className="vip-feedback vip-error" role="alert">{error}</p>}
    {!ready ? <p role="status">Opening your lounge…</p> : token && !invitation ? <section className="vip-entry-content"><p role={inviteError ? "alert" : "status"}>{inviteError || "Checking your private invitation…"}</p><Link href="/vip">Go to VIP sign in</Link></section>
    : !session?.accessToken && emailStep ? <section className="vip-entry-content vip-email-step" aria-labelledby="vip-email-heading">
      <span className="vip-email-mark" aria-hidden="true">✉</span><h2 id="vip-email-heading">Check your email</h2>
      <p>{emailStep === "signup" ? "If this email matches your invitation, a confirmation link is on the way to" : emailStep === "setup_password" ? "If this email has an account, a secure password setup link is on the way to" : "If you have a MyDancr account, a reset link is on the way to"} <strong>{email}</strong>.</p>
      <small>{emailStep === "signup" ? "Open the newest link to verify your email, set your password, and continue to VIP access. If you already have a guest account, we’ll use it." : "After choosing a new password, you’ll return here to finish VIP access."} Check your spam folder too.</small>
      <button type="button" className="vip-primary" disabled={busy || resendSeconds > 0} onClick={resendEmail}>{busy ? "Sending…" : resendSeconds ? `Resend email in ${resendSeconds}s` : "Resend email"}</button>
      <div className="vip-actions"><button type="button" disabled={busy} onClick={() => chooseMode("login")}>I already have a password</button><button type="button" disabled={busy} onClick={() => chooseMode(emailStep)}>Use a different email</button></div>
    </section>
    : !session?.accessToken && invitation && mode === "choose" ? <section className="vip-entry-content vip-account-choice"><h2>Continue with your guest account</h2><p>Use the email invited by your venue: {invitation.maskedEmail}.</p>
      <button type="button" className="vip-primary" onClick={() => chooseMode("login")}>I have an account · Sign in</button>
      <button type="button" className="vip-primary" onClick={() => chooseMode("signup")}>I’m new · Create account</button>
      <button type="button" className="vip-text-button" onClick={() => chooseMode("setup_password")}>Already confirmed? Finish password setup</button>
      <small>Already signed up for MyDancr? Use the same guest account.</small>
    </section>
    : !session?.accessToken ? <section className="vip-entry-content vip-auth">{invitation && <h2>{mode === "signup" ? "Confirm your email" : mode === "setup_password" ? "Finish password setup" : mode === "reset_password" ? "Reset your password" : "Sign in to continue"}</h2>}
      <p>{mode === "setup_password" ? "Confirmed your email but haven’t chosen a password? Enter that email to get a fresh secure link. You’ll return to this invitation after saving your password." : mode === "reset_password" ? "Enter your MyDancr guest email. We’ll send you a link to choose a new password." : invitation ? `Use your invited email (${invitation.maskedEmail}).` : "Use your invited MyDancr guest account."}</p>
      {invitation && (mode === "login" || mode === "signup") && <div className="vip-auth-tabs" role="group" aria-label="Account access"><button type="button" aria-pressed={mode === "login"} disabled={busy} onClick={() => chooseMode("login")}>Sign in</button><button type="button" aria-pressed={mode === "signup"} disabled={busy} onClick={() => chooseMode("signup")}>Create account</button></div>}
      <form onSubmit={authenticate}><label>Email<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} disabled={busy} /></label>
        {mode === "login" && <PasswordField label="Password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required disabled={busy} />}
        {mode === "signup" && <small>Verify your email, then set your password. If you already have a guest account, we’ll use it.</small>}
        {mode === "signup" && <label className="vip-terms-consent"><input type="checkbox" checked={signupTermsAccepted} onChange={event => setSignupTermsAccepted(event.target.checked)} required disabled={busy} /><span>I agree to the <Link href={USER_TERMS_HREF} target="_blank" rel="noreferrer">User Terms</Link>. <Link href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link></span></label>}
        <button className="vip-primary" data-sign-in-action={mode === "login" || undefined} disabled={busy} type="submit">{busy ? "Please wait…" : mode === "signup" ? "Send confirmation link" : mode === "setup_password" ? "Send password setup link" : mode === "reset_password" ? "Send reset link" : "Sign in"}</button>
      </form><div className="vip-auth-help"><button className="vip-text-button" type="button" disabled={busy} onClick={() => chooseMode(mode === "reset_password" || mode === "setup_password" ? "login" : "reset_password")}>{mode === "reset_password" || mode === "setup_password" ? "Back to sign in" : "Forgot password?"}</button>
      {(mode === "signup" || mode === "login") && <button className="vip-text-button" type="button" disabled={busy} onClick={() => chooseMode("setup_password")}>Finish password setup</button>}
      </div>
    </section> : !customer ? <section className="vip-entry-content"><h2>Use your invited guest account</h2><p>You’re signed in to a different account type. Sign out, then use the email that received your VIP invitation.</p></section>
    : token && invitation && setupCheck !== "ready" ? <section className="vip-entry-content vip-password-setup">
      {setupCheck === "loading" ? <p role="status">Checking your account setup…</p> : setupCheck === "error" ? <><p role="alert">We couldn’t check your account setup. Please try again.</p><button className="vip-primary" onClick={() => setSetupAttempt(value => value + 1)}>Try again</button></> : <><h2>Set your password</h2><p>Your email is confirmed. Save a password to finish setting up your guest account and continue to VIP access.</p><Link className="vip-primary" href={vipPasswordSetupPath(`/vip/invite/${token}`)}>Set password &amp; continue</Link><small>Already have a password? Sign out above, then sign in with it.</small></>}
    </section>
    : token && invitation ? <section className="vip-entry-content vip-auth"><h2>Activate your VIP access</h2><p>Signed in as {session.account?.email}. This invitation is for {invitation.maskedEmail}.</p><form onSubmit={accept}><label>Your name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} autoComplete="name" required disabled={busy} /></label>
      <small id="vip-access-notice">{VIP_ACCESS_NOTICE} <Link href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link></small>
      <label className="vip-terms-consent"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} required disabled={busy} aria-describedby="vip-access-notice" /><span>I’m 18 or older and agree to the <Link href={USER_TERMS_HREF} target="_blank" rel="noreferrer">User Terms</Link> and <Link href={ACCESS_TERMS_HREF} target="_blank" rel="noreferrer">VIP &amp; Table Access Terms</Link>.</span></label>
      <button type="submit" className="vip-primary" disabled={busy || !termsAccepted}>{busy ? "Activating…" : "Activate VIP access"}</button></form><small>Link expires {new Date(invitation.expiresAt).toLocaleDateString()}.</small></section>
    : null}
    </section>
    <footer className="vip-footer"><span>MyDancr VIP</span><Link href="/privacy">Privacy Policy</Link></footer>
  </div></main>;
}
function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
