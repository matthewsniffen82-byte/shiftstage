"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/app/components/PasswordField";
import { PasswordRequirements } from "@/app/components/PasswordRequirements";
import { BROWSER_AUTH_SESSION_KEY, captureBrowserAuthSessionGuard, persistBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { readSession, requestDashboardJson, revokeDashboardSession, type StoredDashboardSession } from "@/app/dashboard/dashboard-session";
import type { VipInvitation } from "@/src/lib/dancr/vip-types";
import dynamic from "next/dynamic";
import "./vip-premium.css";

const VipDashboard = dynamic(() => import("./VipDashboard"), { loading: () => <main className="vip-shell vip-dashboard-shell"><div className="vip-container vip-loading" role="status">Opening your VIP lounge…</div></main> });

export default function VipClient({ token = "" }: { token?: string }) {
  const [session, setSession] = useState<StoredDashboardSession | null>(null);
  const [ready, setReady] = useState(false);
  const [invitation, setInvitation] = useState<VipInvitation | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "reset_password">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [status, setStatus] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const lock = useRef(false); const mounted = useRef(false);
  const customer = session?.account?.role === "customer";

  useEffect(() => {
    mounted.current = true;
    setSession(readSession()); setReady(true);
    const changed = (event: StorageEvent) => {
      if (event.key !== BROWSER_AUTH_SESSION_KEY && event.key !== null) return;
      setSession(readSession()); setPassword(""); setName(""); setStatus(""); setError("");
    };
    window.addEventListener("storage", changed);
    return () => { mounted.current = false; window.removeEventListener("storage", changed); };
  }, []);

  useEffect(() => {
    setInvitation(null); setInviteError("");
    if (!token) return;
    const controller = new AbortController();
    setMode("signup");
    fetch("/api/vip/invitation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), signal: controller.signal, cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || "Unable to open invitation."); if (!controller.signal.aborted) setInvitation(data.invitation); })
      .catch(failure => { if (!controller.signal.aborted) setInviteError(failure.message); });
    return () => controller.abort();
  }, [token]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setStatus("");
    try { await action(); } catch (failure) { if (mounted.current) setError(message(failure)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function authenticate(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const unchanged = captureBrowserAuthSessionGuard();
      const redirect = new URL("/auth/callback", window.location.origin);
      redirect.searchParams.set("return_to", mode === "reset_password" ? "/account/reset-password" : token ? `/vip/invite/${encodeURIComponent(token)}` : "/vip");
      if (mode === "reset_password") redirect.searchParams.set("type", "recovery");
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ mode, role: "customer", email, password, emailRedirectTo: redirect.toString() }) });
      const data = await response.json();
      if (!mounted.current) return;
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to sign in.");
      if (!unchanged()) throw new Error("Your sign-in changed in another window. Refresh to continue.");
      if (!data.session?.accessToken) {
        setStatus(mode === "reset_password" ? data.message : "Check your email to confirm your MyDancr guest account. Your confirmation link brings you back to activate VIP access."); setMode("login"); setPassword(""); return;
      }
      if (data.account?.role !== "customer") throw new Error("Use your MyDancr guest account with the invited email for VIP access.");
      if (!persistBrowserAuthSession({ ...data.session, account: data.account })) throw new Error("Unable to save your sign-in in this browser.");
      setSession(readSession()); setPassword("");
    });
  }
  async function signOut() {
    await run(async () => { await revokeDashboardSession(); if (mounted.current) { setSession(null); } });
  }
  function accept(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      await requestDashboardJson("/api/vip/invitation", { expectedRole: "customer", method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name }), timeoutMs: 20000 });
      if (mounted.current) window.location.assign("/vip");
    });
  }
  if (ready && customer && session?.accessToken && !token) {
    return <VipDashboard key={session.account?.id || session.account?.email} account={session.account || {}} onSignOut={signOut} signingOut={busy} accountError={error} />;
  }
  return <main className="vip-shell vip-auth-shell" data-global-navigation-swipe="ignore"><div className="vip-container">
    <section className="vip-panel vip-entry-card">
    <header className="vip-header"><Link href="/" className="dancr-home-back"><span aria-hidden="true">‹</span> Back to MyDancr</Link><Link href="/" className="vip-brand">mydanc<span>r</span></Link><div className="vip-actions">{session?.accessToken && <button type="button" disabled={busy} onClick={() => void signOut()}>Sign out</button>}</div></header>
    <div className="vip-hero"><span className="vip-eyebrow">Private access</span><h1>{invitation ? invitation.venueName : "Your VIP lounge."}</h1><p>{invitation ? "Your private VIP invitation." : "Your venues. Your next visit. One MyDancr sign-in."}</p></div>
    {status && <p className="vip-feedback" role="status">{status}</p>}{error && <p className="vip-feedback vip-error" role="alert">{error}</p>}
    {!ready ? <p role="status">Opening your lounge…</p> : token && !invitation ? <section className="vip-entry-content"><p role={inviteError ? "alert" : "status"}>{inviteError || "Checking your private invitation…"}</p><Link href="/vip">Go to VIP sign in</Link></section>
    : !session?.accessToken ? <section className="vip-entry-content vip-auth"><h2>{mode === "signup" ? "Activate your VIP access" : mode === "reset_password" ? "Reset your password" : "VIP sign in"}</h2>
      <p>{mode === "reset_password" ? "Enter your MyDancr guest email. We’ll send you a link to choose a new password." : invitation ? `Use the invited email (${invitation.maskedEmail}). Already have a MyDancr guest account? Choose Sign in and use your existing password.` : "Use your existing MyDancr guest email and password. VIP access is unlocked by a private club invitation."}</p>
      {invitation && mode !== "reset_password" && <div className="vip-auth-tabs" role="group" aria-label="Account access"><button type="button" aria-pressed={mode === "login"} disabled={busy} onClick={() => setMode("login")}>Sign in</button><button type="button" aria-pressed={mode === "signup"} disabled={busy} onClick={() => setMode("signup")}>Create account</button></div>}
      <form onSubmit={authenticate}><label>Email<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} disabled={busy} /></label>
        {mode !== "reset_password" && <PasswordField label="Password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required disabled={busy} />}
        {mode === "signup" && <><PasswordRequirements password={password} /><small>This creates your MyDancr guest account. Your invitation adds VIP access to it.</small></>}
        <button className="vip-primary" disabled={busy} type="submit">{busy ? "Please wait…" : mode === "signup" ? "Create account & continue" : mode === "reset_password" ? "Send reset link" : "Enter VIP lounge"}</button>
      </form><button className="vip-text-button" type="button" disabled={busy} onClick={() => setMode(mode === "reset_password" ? "login" : "reset_password")}>{mode === "reset_password" ? "Back to sign in" : "Forgot password?"}</button>
    </section> : !customer ? <section className="vip-entry-content"><h2>Use your invited guest account</h2><p>You’re signed in to a different account type. Sign out, then use the email that received your VIP invitation.</p></section>
    : token && invitation ? <section className="vip-entry-content vip-auth"><h2>Activate your VIP access</h2><p>Signed in as {session.account?.email}. This invitation is for {invitation.maskedEmail}.</p><form onSubmit={accept}><label>Your name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} autoComplete="name" required disabled={busy} /></label><small>Your club will see this name with your requests.</small><button type="submit" className="vip-primary" disabled={busy}>{busy ? "Activating…" : "Activate VIP access"}</button></form><small>Link expires {new Date(invitation.expiresAt).toLocaleDateString()}.</small></section>
    : null}
    </section>
    <footer className="vip-footer">Private invitations. Personal plans. <Link href="/privacy">Privacy Policy</Link><span>MyDancr VIP</span></footer>
  </div></main>;
}
function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
