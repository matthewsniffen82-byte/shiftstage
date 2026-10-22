"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { passwordValidationMessage } from "@/src/lib/dancr/password-policy";
import { PasswordRequirements } from "@/app/components/PasswordRequirements";
import { clearDashboardSession, readSession, requestAccountJson, type DashboardSessionAccount } from "@/app/dashboard/dashboard-session";
import { isCurrentBrowserSession } from "@/src/lib/dancr/browser-session";

type Credential = "email" | "password";
type Feedback = { error: boolean; message: string } | null;

export default function VipAccountPanel({ account, onAccountChange }: {
  account: DashboardSessionAccount;
  onAccountChange: (account: DashboardSessionAccount) => void;
}) {
  const [editing, setEditing] = useState<Credential | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [completedCredential, setCompletedCredential] = useState<Credential | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const pending = useRef<AbortController | null>(null);
  const emailButton = useRef<HTMLButtonElement>(null);
  const passwordButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Credential | null>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const deleteInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditing(null);
    setFeedback(null);
    setBusy(false);
    setCompletedCredential(null);
    setDeleteOpen(false);
    setDeleteConfirmation("");
    returnFocus.current = null;
    return () => { pending.current?.abort(); pending.current = null; };
  }, [account.id]);

  useEffect(() => {
    if (editing || busy || !returnFocus.current) return;
    (returnFocus.current === "email" ? emailButton : passwordButton).current?.focus();
    returnFocus.current = null;
  }, [editing, busy]);

  useEffect(() => {
    if (deleteOpen) deleteInput.current?.focus({ preventScroll: true });
  }, [deleteOpen]);

  function closeForm(credential: Credential) {
    returnFocus.current = credential;
    setEditing(null);
  }

  function openForm(credential: Credential) {
    if (pending.current) return;
    setDeleteOpen(false);
    setDeleteConfirmation("");
    setFeedback(null);
    setCompletedCredential(null);
    setEditing(current => current === credential ? null : credential);
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !deleteOpen) return;
    if (deleteConfirmation !== "DELETE") {
      setFeedback({ error: true, message: "Type DELETE exactly to confirm permanent deletion." });
      return;
    }
    const session = readSession();
    if (!account.id || !session?.accessToken || session.account?.id !== account.id || session.account.role !== "customer") {
      setFeedback({ error: true, message: "Sign in again before deleting your account." });
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setFeedback(null);
    let deleted = false;
    let failure = "";
    try {
      // Finish session cleanup even if the guest leaves the Account tab while
      // the server is deleting their login. Navigation must not cancel this.
      await requestAccountJson({ method: "DELETE", expectedRole: "customer", timeoutMs: 30_000,
        fallbackMessage: "We couldn’t confirm account deletion." });
      deleted = true;
    } catch (error) {
      failure = error instanceof Error ? error.message : "We couldn’t confirm account deletion.";
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
      // Successful deletion also clears refreshed credentials for this account.
      // A late failure must never sign out a newer session or a different user.
      if (isCurrentBrowserSession(session) || (deleted && readSession()?.account?.id === account.id)) {
        clearDashboardSession();
        if (!deleted) window.alert(`${failure} You have been signed out; sign in again to check your account before retrying.`);
        window.location.replace("/");
      }
    }
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
        body: JSON.stringify(credential === "email" ? { email, returnTo: "/vip" } : { password: value }),
        signal: controller.signal,
        fallbackMessage: `Unable to change your ${credential}. Please try again.`,
      });
      if (!isCurrent()) return;
      if (data.account?.id === accountId) onAccountChange(data.account);
      setFeedback({ error: false, message: data.message || (credential === "email" ? "Check both your current and new email inboxes and confirm both links." : "Your password has been updated.") });
      setCompletedCredential(credential);
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
    <article className="vip-panel vip-credentials-account-details account-form-surface">
      <div className="vip-credentials-account-details-heading">
        <h2>Sign-in details</h2>
        <span className="account-status-pill">{(account.accountState || "active").replaceAll("_", " ")}</span>
      </div>
      <div className="vip-credentials-account-email"><span>Email address</span><strong>{account.email || "Private"}</strong></div>
      <div className="vip-credentials-credential-options">
        {(["email", "password"] as const).map(credential => (
          <div key={credential} className="vip-credentials-dropdown">
            <button key={credential} ref={credential === "email" ? emailButton : passwordButton} type="button" className={`vip-credentials-credential-option${completedCredential === credential ? " is-complete" : ""}`} aria-expanded={editing === credential} aria-controls={editing === credential ? `vip-credentials-${credential}-form` : undefined} disabled={busy} onClick={() => openForm(credential)}>
              <svg className="vip-credentials-credential-icon" viewBox="0 0 24 24" aria-hidden="true">{credential === "email" ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></> : <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>}</svg>
              <span>{completedCredential === credential ? credential === "email" ? "✓ Check your email" : "✓ Password updated" : `Change ${credential}`}</span>
              <svg className="vip-credentials-credential-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d={editing === credential ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
            </button>
            {editing === credential ? <CredentialForm key={`${credential}-form`} credential={credential} busy={busy} onSubmit={saveCredential} onCancel={() => { setFeedback(null); closeForm(credential); }} /> : null}
          </div>
        ))}
      </div>
      {feedback ? <p className={`vip-credentials-credential-feedback${feedback.error ? " is-error" : ""}`} role={feedback.error ? "alert" : "status"}>{feedback.message}</p> : null}
      <section className="vip-account-deletion" aria-labelledby="vip-delete-heading">
        <h3 id="vip-delete-heading">Delete account</h3>
        <p>Permanently delete your MyDancr login and end VIP access at every venue. This also ends access to your customer dashboard.</p>
        <button ref={deleteButton} type="button" className="vip-delete-button" disabled={busy} aria-expanded={deleteOpen} aria-controls={deleteOpen ? "vip-delete-form" : undefined} onClick={() => {
          if (pending.current) return;
          setEditing(null); setFeedback(null); setDeleteConfirmation(""); setDeleteOpen(true);
        }}>Delete account</button>
        {deleteOpen ? <form id="vip-delete-form" className="vip-delete-form" aria-label="Confirm account deletion" aria-busy={busy} onSubmit={deleteAccount}>
          <p>This cannot be undone. You’ll be signed out after deletion.</p>
          <label htmlFor="vip-delete-confirmation">Type DELETE to confirm</label>
          <input ref={deleteInput} id="vip-delete-confirmation" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} required aria-describedby="vip-delete-heading" />
          <div className="vip-actions">
            <button type="button" disabled={busy} onClick={() => { setDeleteOpen(false); setDeleteConfirmation(""); setFeedback(null); deleteButton.current?.focus(); }}>Cancel</button>
            <button className="vip-delete-button" type="submit" disabled={busy || deleteConfirmation !== "DELETE"}>{busy ? "Deleting…" : "Permanently delete account"}</button>
          </div>
        </form> : null}
      </section>
      <style>{`
        .info-panel.vip-credentials-account-details { min-width: 0; gap: 16px; }
        .vip-credentials-account-details .vip-credentials-account-details-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .vip-credentials-account-details-heading h2 { margin: 0; }
        .vip-credentials-account-details-heading .account-status-pill { flex: 0 0 auto; font-size: 10px; text-transform: capitalize; }
        .vip-credentials-account-details .vip-credentials-account-email { display: grid; gap: 5px; }
        .vip-credentials-account-email > span { color: #aaa4b8; font-size: 12px; }
        .vip-credentials-account-email > strong { color: #f5f2fa; font-size: 16px; line-height: 1.4; overflow-wrap: anywhere; }
        .vip-credentials-account-details .vip-credentials-credential-options { display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; }
        .vip-credentials-dropdown { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; }
        body.dancr-button-system .vip-credentials-account-details button.vip-credentials-credential-option { display: flex !important; align-items: center !important; justify-content: flex-start !important; gap: 11px !important; width: 100% !important; min-width: 0 !important; min-height: 54px !important; padding: 11px 13px !important; border: 1px solid var(--dancr-color-border) !important; border-radius: 12px !important; background: rgba(48, 48, 56, 0.06) !important; color: #f2ebfc !important; box-shadow: none !important; font-size: 14px !important; }
        .vip-credentials-credential-icon, .vip-credentials-credential-chevron { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
        .vip-credentials-credential-icon { color: #aaa6b5; }
        .vip-credentials-credential-chevron { margin-left: auto; width: 16px; }
        .vip-credentials-dropdown .vip-credentials-credential-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; margin-top: 8px; padding: 14px; border: 1px solid var(--dancr-color-border); border-radius: 12px; background: var(--dancr-color-surface-card); }
        .vip-credentials-credential-form h3 { margin: 0; font-size: 17px; }
        .vip-credentials-credential-form > p { margin: 0; color: #aaa4b8; font-size: 13px; line-height: 1.5; }
        .vip-credentials-credential-form label { display: grid; gap: 8px; font-size: 13px; color: #e3ddea; }
        .vip-credentials-credential-field { display: grid; gap: 8px; min-width: 0; }
        .vip-credentials-credential-form input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 48px; padding: 12px; border: 1px solid var(--dancr-color-border); border-radius: 10px; background: var(--dancr-color-control-secondary); color: #fff; font-size: 16px; }
        .vip-credentials-credential-form input:focus-visible, .vip-credentials-credential-options button:focus-visible { outline: 2px solid var(--dancr-color-brand-primary); outline-offset: 2px; }
        .vip-credentials-password-control { position: relative; min-width: 0; }
        .vip-credentials-credential-form .vip-credentials-password-control input { padding-right: 56px; }
        body.dancr-button-system .vip-credentials-password-control button.vip-credentials-password-toggle { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); display: grid !important; place-items: center; width: 44px !important; min-width: 44px !important; height: 44px !important; min-height: 44px !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 8px !important; background: transparent !important; box-shadow: none !important; color: #aaa6b5 !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
        .vip-credentials-password-toggle svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .vip-credentials-password-toggle:focus-visible { outline: 2px solid var(--dancr-color-brand-primary); outline-offset: -2px; }
        .vip-credentials-credential-form-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; }
        body.dancr-button-system .vip-credentials-credential-form-actions > button { min-width: 0 !important; min-height: 46px !important; padding: 10px 12px !important; border-radius: 10px !important; font-size: 13px !important; }
        .vip-credentials-credential-feedback { margin: 16px 0 0; color: #b6e6cf; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
        .vip-credentials-credential-feedback.is-error { color: #fda4af; }
        .vip-account-deletion { margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(251,113,133,.22); }
        .vip-account-deletion h3 { margin: 0; font-size: 16px; color: #fda4af; }
        .vip-account-deletion p { margin: 10px 0 16px; color: #aaa4b8; font-size: 13px; line-height: 1.6; }
        body.dancr-button-system #vip-dashboard .vip-account-deletion button.vip-delete-button { background: #30171f !important; border: 1px solid #a74b64 !important; color: #ffd4df !important; box-shadow: none !important; }
        .vip-account-deletion .vip-delete-form { margin-top: 16px; padding: 16px; border: 1px solid #734052; border-radius: 12px; background: var(--dancr-color-surface-card); gap: 12px; }
        .vip-delete-form > p { margin: 0; color: #ffd4df; }
        .vip-account-deletion .vip-delete-form input { font-size: 16px; }
        .vip-account-deletion .vip-actions > button { flex: 1 1 160px; min-width: 0; }
      `}</style>
    </article>
  );
}

function CredentialForm({ credential, busy, onSubmit, onCancel }: {
  credential: Credential; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [password, setPassword] = useState("");
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return <form id={`vip-credentials-${credential}-form`} className="vip-credentials-credential-form" aria-label={`Change ${credential}`} aria-busy={busy} onSubmit={onSubmit}>
    <h3>Change {credential}</h3>
    <p>{credential === "email" ? "Confirm the links sent to both your current and new email addresses. Keep using your current email until both are confirmed." : "Changing your password signs out your other sessions."}</p>
    <div className="vip-credentials-credential-field">
      <label htmlFor="vip-credentials-new-credential">{credential === "email" ? "New email address" : "New password"}</label>
      <div className={credential === "password" ? "vip-credentials-password-control" : undefined}>
        <input id="vip-credentials-new-credential" ref={input} name={credential} type={credential === "email" ? "email" : showPassword ? "text" : "password"} autoComplete={credential === "email" ? "email" : "new-password"} autoCapitalize="none" spellCheck={false} required minLength={credential === "password" ? 6 : undefined} maxLength={credential === "email" ? 254 : 1024} disabled={busy} onChange={credential === "password" ? event => setPassword(event.target.value) : undefined} />
        {credential === "password" ? <PasswordVisibilityButton visible={showPassword} label="new password" controls="vip-credentials-new-credential" disabled={busy} onClick={() => setShowPassword(value => !value)} /> : null}
      </div>
    </div>
    {credential === "password" ? <PasswordRequirements password={password} /> : null}
    {credential === "password" ? <div className="vip-credentials-credential-field">
      <label htmlFor="vip-credentials-confirm-password">Confirm new password</label>
      <div className="vip-credentials-password-control">
        <input id="vip-credentials-confirm-password" name="confirmPassword" type={showConfirmation ? "text" : "password"} autoComplete="new-password" autoCapitalize="none" spellCheck={false} required minLength={6} maxLength={1024} disabled={busy} />
        <PasswordVisibilityButton visible={showConfirmation} label="password confirmation" controls="vip-credentials-confirm-password" disabled={busy} onClick={() => setShowConfirmation(value => !value)} />
      </div>
    </div> : null}
    <div className="vip-credentials-credential-form-actions">
      <button className="primary-link account-form-primary" type="submit" disabled={busy} aria-busy={busy}>{busy ? credential === "email" ? "Sending confirmation…" : "Updating password…" : credential === "email" ? "Confirm email change" : "Update password"}</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

function PasswordVisibilityButton({ visible, label, controls, disabled, onClick }: {
  visible: boolean; label: string; controls: string; disabled: boolean; onClick: () => void;
}) {
  return <button type="button" className="vip-credentials-password-toggle" aria-label={`${visible ? "Hide" : "Show"} ${label}`} aria-pressed={visible} aria-controls={controls} disabled={disabled} onClick={onClick}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {visible ? <path d="m3 3 18 18" /> : null}
    </svg>
  </button>;
}
