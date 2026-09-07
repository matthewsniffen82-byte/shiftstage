"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { passwordValidationMessage } from "@/src/lib/dancr/password-policy";
import { PasswordRequirements } from "@/app/components/PasswordRequirements";
import { readSession, requestAccountJson, type DashboardSessionAccount } from "./dashboard-session";

type Credential = "email" | "password";
type Feedback = { error: boolean; message: string } | null;

export default function CustomerAccountPanel({ account, onAccountChange }: {
  account: DashboardSessionAccount;
  onAccountChange: (account: DashboardSessionAccount) => void;
}) {
  const [editing, setEditing] = useState<Credential | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const emailButton = useRef<HTMLButtonElement>(null);
  const passwordButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Credential | null>(null);

  useEffect(() => {
    setEditing(null);
    setFeedback(null);
    setBusy(false);
    returnFocus.current = null;
    return () => { pending.current?.abort(); pending.current = null; };
  }, [account.id]);

  useEffect(() => {
    if (editing || busy || !returnFocus.current) return;
    (returnFocus.current === "email" ? emailButton : passwordButton).current?.focus();
    returnFocus.current = null;
  }, [editing, busy]);

  function closeForm(credential: Credential) {
    returnFocus.current = credential;
    setEditing(null);
  }

  function openForm(credential: Credential) {
    if (pending.current) return;
    setFeedback(null);
    setEditing(current => current === credential ? null : credential);
  }

  async function saveCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || pending.current) return;
    const credential = editing;
    const fields = new FormData(event.currentTarget);
    const value = String(fields.get(credential) || "");
    const email = value.trim().toLowerCase();
    setFeedback(null);
    if (credential === "email" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
      setFeedback({ error: true, message: "Enter a valid email address." });
      return;
    }
    if (credential === "email" && email === account.email?.trim().toLowerCase()) {
      setFeedback({ error: true, message: "Enter a different email address." });
      return;
    }
    const passwordError = credential === "password" ? passwordValidationMessage(value) : "";
    if (passwordError) {
      setFeedback({ error: true, message: passwordError });
      return;
    }
    if (credential === "password" && value !== fields.get("confirmPassword")) {
      setFeedback({ error: true, message: "Your passwords don’t match. Please enter them again." });
      return;
    }
    const accountId = account.id;
    if (!accountId || readSession()?.account?.id !== accountId) {
      setFeedback({ error: true, message: "Sign in again before changing your account details." });
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    const isCurrent = () => pending.current === controller && !controller.signal.aborted && readSession()?.account?.id === accountId;
    try {
      const data = await requestAccountJson({
        method: "PATCH", expectedRole: "customer", timeoutMs: 30_000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential === "email" ? { email } : { password: value }),
        signal: controller.signal,
        fallbackMessage: `Unable to change your ${credential}. Please try again.`,
      });
      if (!isCurrent()) return;
      if (data.account?.id === accountId) onAccountChange(data.account);
      setFeedback({ error: false, message: data.message || (credential === "email" ? "Check your email for confirmation instructions." : "Your password has been updated.") });
      closeForm(credential);
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback({ error: true, message: error instanceof Error && !/Loading took too long|Failed to fetch|NetworkError/i.test(error.message)
        ? error.message
        : credential === "password" ? "We couldn’t confirm the change. Try signing in with your new password before trying again." : "We couldn’t confirm the change. Check your email for confirmation instructions before trying again." });
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return (
    <article className="info-panel customer-account-details">
      <div className="customer-account-details-heading">
        <h2>Sign-in details</h2>
        <span className="account-status-pill">{(account.accountState || "active").replaceAll("_", " ")}</span>
      </div>
      <div className="customer-account-email"><span>Email address</span><strong>{account.email || "Private"}</strong></div>
      <div className="customer-credential-options">
        {(["email", "password"] as const).map(credential => (
          <button key={credential} ref={credential === "email" ? emailButton : passwordButton} type="button" className="customer-credential-option" aria-expanded={editing === credential} aria-controls={editing === credential ? "customer-credential-form" : undefined} disabled={busy} onClick={() => openForm(credential)}>
            <svg className="customer-credential-icon" viewBox="0 0 24 24" aria-hidden="true">{credential === "email" ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></> : <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>}</svg>
            <span>Change {credential}</span>
            <svg className="customer-credential-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d={editing === credential ? "m6 15 6-6 6 6" : "m9 6 6 6-6 6"} /></svg>
          </button>
        ))}
      </div>
      {editing ? <CredentialForm key={editing} credential={editing} busy={busy} onSubmit={saveCredential} onCancel={() => { setFeedback(null); closeForm(editing); }} /> : null}
      {feedback ? <p className={`customer-credential-feedback${feedback.error ? " is-error" : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.message}</p> : null}
      <style>{`
        .info-panel.customer-account-details { min-width: 0; gap: 16px; }
        .customer-account-details .customer-account-details-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .customer-account-details-heading h2 { margin: 0; }
        .customer-account-details-heading .account-status-pill { flex: 0 0 auto; font-size: 10px; text-transform: capitalize; }
        .customer-account-details .customer-account-email { display: grid; gap: 5px; }
        .customer-account-email > span { color: #aaa4b8; font-size: 12px; }
        .customer-account-email > strong { color: #f5f2fa; font-size: 16px; line-height: 1.4; overflow-wrap: anywhere; }
        .customer-credential-options { display: grid; gap: 9px; }
        body.dancr-button-system .customer-account-details button.customer-credential-option { display: flex !important; align-items: center !important; justify-content: flex-start !important; gap: 11px !important; width: 100% !important; min-width: 0 !important; min-height: 54px !important; padding: 11px 13px !important; border: 1px solid rgba(179,125,255,.2) !important; border-radius: 12px !important; background: rgba(139,92,246,.06) !important; color: #f2ebfc !important; box-shadow: none !important; font-size: 14px !important; }
        .customer-credential-icon, .customer-credential-chevron { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
        .customer-credential-icon { color: #c6a5fb; }
        .customer-credential-chevron { margin-left: auto; width: 16px; }
        .customer-credential-form { display: grid; gap: 14px; margin-top: 16px; padding-top: 18px; border-top: 1px solid rgba(179,125,255,.15); }
        .customer-credential-form h3 { margin: 0; font-size: 17px; }
        .customer-credential-form > p { margin: 0; color: #aaa4b8; font-size: 13px; line-height: 1.5; }
        .customer-credential-form label { display: grid; gap: 8px; font-size: 13px; color: #e3ddea; }
        .customer-credential-form input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 48px; padding: 12px; border: 1px solid rgba(179,125,255,.25); border-radius: 10px; background: #0b0911; color: #fff; font-size: 16px; }
        .customer-credential-form input:focus-visible, .customer-credential-options button:focus-visible { outline: 2px solid #c4a0ff; outline-offset: 2px; }
        .customer-credential-form-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; }
        body.dancr-button-system .customer-credential-form-actions > button { min-width: 0 !important; min-height: 46px !important; padding: 10px 12px !important; border-radius: 10px !important; font-size: 13px !important; }
        .customer-credential-feedback { margin: 16px 0 0; color: #b6e6cf; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
        .customer-credential-feedback.is-error { color: #fda4af; }
      `}</style>
    </article>
  );
}

function CredentialForm({ credential, busy, onSubmit, onCancel }: {
  credential: Credential; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return <form id="customer-credential-form" className="customer-credential-form" aria-label={`Change ${credential}`} aria-busy={busy} onSubmit={onSubmit}>
    <h3>Change {credential}</h3>
    <p>{credential === "email" ? "We’ll email confirmation instructions. Keep using your current email until the change is confirmed." : "Changing your password signs out your other sessions."}</p>
    <label>{credential === "email" ? "New email address" : "New password"}<input ref={input} name={credential} type={credential === "email" ? "email" : "password"} autoComplete={credential === "email" ? "email" : "new-password"} autoCapitalize="none" spellCheck={false} required minLength={credential === "password" ? 6 : undefined} maxLength={credential === "email" ? 254 : 1024} disabled={busy} /></label>
    {credential === "password" ? <PasswordRequirements /> : null}
    {credential === "password" ? <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={6} maxLength={1024} disabled={busy} /></label> : null}
    <div className="customer-credential-form-actions">
      <button className="primary-link" type="submit" disabled={busy}>{busy ? "Please wait…" : credential === "email" ? "Confirm email change" : "Update password"}</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}
