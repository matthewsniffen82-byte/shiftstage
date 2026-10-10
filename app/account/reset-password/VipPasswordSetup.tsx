"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/app/components/PasswordField";
import { PasswordRequirements } from "@/app/components/PasswordRequirements";
import { passwordValidationMessage } from "@/src/lib/dancr/password-policy";
import { ACCESS_TERMS_HREF, ACCESS_TERMS_VERSION, VIP_ACCESS_NOTICE } from "@/src/lib/dancr/access-terms";
import { USER_TERMS_HREF, USER_TERMS_VERSION } from "@/src/lib/dancr/user-terms-version";
import { vipPlannerPath, vipReturnPath } from "@/src/lib/dancr/vip-entry";
import { captureBrowserAuthSessionGuard, isCurrentBrowserSession, persistBrowserAuthSession, persistRefreshedBrowserAuthSession, readBrowserAuthSession } from "@/src/lib/dancr/browser-session";

// Supplied by the authenticated account response, never URL parameters or form input.
export type VerifiedVipSetupAccount = { id: string; email: string; displayName: string; passwordSetupComplete: boolean; passwordLoginComplete: boolean };

export default function VipPasswordSetup({ account, invitationPath }: { account: VerifiedVipSetupAccount; invitationPath: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState(account.displayName.slice(0, 80));
  const [consent, setConsent] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(account.passwordSetupComplete);
  const [signedIn, setSignedIn] = useState(account.passwordLoginComplete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => { controllerRef.current?.abort(); controllerRef.current = null; }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (controllerRef.current) return;
    if (!consent) { setError("Please read and accept the User Terms and VIP & Table Access Terms."); return; }
    if (!name.trim() || name.trim().length > 80) { setError("Enter your name for the guest list."); return; }
    if (!signedIn) {
      const validation = passwordSaved ? (!password ? "Enter your password." : "") : passwordValidationMessage(password);
      if (validation) { setError(validation); return; }
      if (!passwordSaved && password !== confirm) { setError("The passwords do not match."); return; }
    }
    const returnTo = vipReturnPath(invitationPath);
    if (!returnTo.startsWith("/vip/invite/")) { setError("Return to your venue invitation to continue."); return; }
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = globalThis.setTimeout(() => controller.abort(), 45000);
    setBusy(true); setError("");
    function currentSession() {
      const session = readBrowserAuthSession();
      if (controller.signal.aborted || controllerRef.current !== controller) throw new Error("Setup was interrupted. Please try again.");
      if (!session?.accessToken || session.account?.id !== account.id || session.account.role !== "customer") throw new Error("Your sign-in changed. Reopen your private email link to continue.");
      return session;
    }
    async function request(url: string, method: string, body: unknown, authenticated = true) {
      const session = currentSession();
      const unchanged = captureBrowserAuthSessionGuard();
      const response = await fetch(url, { method, signal: controller.signal, cache: "no-store", credentials: "same-origin",
        headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${session.accessToken}`,
          ...(session.refreshToken ? { "x-dancr-refresh-token": session.refreshToken } : {}) } : {}) }, body: JSON.stringify(body) });
      const data = await response.json();
      currentSession();
      if (!unchanged() || !isCurrentBrowserSession(session)) throw new Error("Your sign-in changed in another window. Reopen your private email link to continue.");
      if (!response.ok || !data.ok) throw new Error(data.error || "We couldn’t finish VIP setup. Please try again.");
      if (authenticated && data.session?.accessToken && !persistRefreshedBrowserAuthSession(data.session, session)) throw new Error("Unable to save your sign-in in this browser. Please try again.");
      return data;
    }
    try {
      if (!passwordSaved) {
        setProgress("Saving your password…");
        const saved = await request("/api/account", "PATCH", { password });
        if (saved.passwordSetupComplete !== true) throw new Error("Your password was saved, but setup couldn’t be confirmed. Please try again.");
        setPasswordSaved(true);
      }
      if (!signedIn) {
        setProgress("Signing you in…");
        const login = await request("/api/auth", "POST", { mode: "login", role: "customer", email: account.email, password }, false);
        if (login.account?.id !== account.id || login.account?.role !== "customer" || login.account?.accountState !== "active"
          || !login.session?.accessToken || !login.session.refreshToken) throw new Error("Unable to confirm your guest sign-in. Please try again.");
        if (!persistBrowserAuthSession({ ...login.session, account: login.account })) throw new Error("Unable to save your sign-in in this browser. Please try again.");
        if (login.passwordLoginComplete !== true) throw new Error("Your sign-in worked, but setup couldn’t be confirmed. Please try again.");
        setSignedIn(true); setPassword(""); setConfirm("");
      }
      setProgress("Opening your VIP lounge…");
      const activation = await request("/api/vip/invitation", "PATCH", { token: returnTo.slice("/vip/invite/".length), name: name.trim(),
        termsAccepted: consent, termsVersion: ACCESS_TERMS_VERSION, userTermsAccepted: consent, userTermsVersion: USER_TERMS_VERSION });
      window.location.replace(vipPlannerPath(activation.venueId));
    } catch (reason) {
      if (controllerRef.current === controller) setError(controller.signal.aborted
        ? "We couldn’t confirm the last step. Please try again to continue your setup."
        : reason instanceof Error ? reason.message : "Unable to finish VIP setup. Please try again.");
    } finally {
      globalThis.clearTimeout(timeout);
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); setProgress(""); }
    }
  }

  return <form onSubmit={submit}>
    <p>Your email is confirmed. {signedIn ? "Finish below to open your VIP lounge." : passwordSaved ? "Enter your password to finish opening your VIP lounge." : "Create your password and we’ll sign you in automatically."}</p>
    <label>Email · confirmed<input type="email" name="email" autoComplete="username" value={account.email} readOnly /></label>
    <label>Your name<input autoComplete="name" value={name} maxLength={80} required disabled={busy} onChange={event => setName(event.target.value)} /></label>
    {!signedIn && <>
      <PasswordField label={passwordSaved ? "Password" : "Create password"} autoComplete={passwordSaved ? "current-password" : "new-password"} minLength={passwordSaved ? 1 : 6} maxLength={1024} required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
      {!passwordSaved && <><PasswordRequirements password={password} /><PasswordField label="Confirm password" autoComplete="new-password" minLength={6} maxLength={1024} required value={confirm} disabled={busy} onChange={event => setConfirm(event.target.value)} /></>}
    </>}
    <small className="vip-setup-notice" id="vip-setup-notice">{VIP_ACCESS_NOTICE} <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a></small>
    <label className="vip-setup-consent"><input type="checkbox" checked={consent} required disabled={busy} aria-describedby="vip-setup-notice" onChange={event => setConsent(event.target.checked)} /><span>I’m 18 or older and agree to the <a href={USER_TERMS_HREF} target="_blank" rel="noreferrer">User Terms</a> and <a href={ACCESS_TERMS_HREF} target="_blank" rel="noreferrer">VIP &amp; Table Access Terms</a>.</span></label>
    {error && <p className="reset-error" role="alert">{error}</p>}
    {progress && <p role="status">{progress}</p>}
    <button type="submit" className="account-form-primary" data-sign-in-action aria-busy={busy} disabled={busy}>{busy ? "Please wait…" : signedIn ? "Enter VIP" : passwordSaved ? "Sign in & enter VIP" : "Create password & enter VIP"}</button>
  </form>;
}
