"use client";
import { useDashboardHelpArea } from "../components/dashboard-help-scope";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { readAdminSession, requestAdminJson } from "./admin-session";
import styles from "./AdminAccountSettings.module.css";

type SignInDetails = { userId: string; email: string | null; username: string | null; usernameOnly: boolean };

export default function AdminAccountSettings({ accountId }: { accountId: string }) {
  const [opened, setOpened] = useState(false);
  useDashboardHelpArea("admin-account", opened);
  return (
    <section className={`admin-panel ${styles.panel}`} aria-label="Admin account settings">
      <button type="button" className={styles.toggle} aria-expanded={opened} aria-controls="admin-account-settings"
        onClick={() => setOpened(value => !value)}>
        <span>Account settings</span><span aria-hidden="true">{opened ? "−" : "+"}</span>
      </button>
      <div id="admin-account-settings" hidden={!opened}>
        {opened && <ChangeAdminEmail key={accountId} accountId={accountId} />}
      </div>
    </section>
  );
}

function ChangeAdminEmail({ accountId }: { accountId: string }) {
  const [details, setDetails] = useState<SignInDetails | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    const current = () => !controller.signal.aborted && readAdminSession()?.account?.id === accountId;
    requestAdminJson("/api/admin/account", { signal: controller.signal, cache: "no-store", fallbackMessage: "Unable to load your sign-in details." })
      .then(data => { if (current() && data.userId === accountId) setDetails(data); })
      .catch(reason => { if (current()) setError(reason instanceof Error ? reason.message : "Unable to load your sign-in details."); })
      .finally(() => { if (requestRef.current === controller) requestRef.current = null; });
    return () => { controller.abort(); requestRef.current?.abort(); };
  }, [accountId, reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details || busy || requestRef.current || readAdminSession()?.account?.id !== accountId) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const current = () => !controller.signal.aborted && readAdminSession()?.account?.id === accountId;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await requestAdminJson("/api/admin/account", { method: "PATCH", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ email, currentPassword: password }),
        fallbackMessage: "Unable to send your email confirmation.",
      });
      if (current() && data.userId === accountId) setMessage(data.message);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : "Unable to send your email confirmation.");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (current()) { setBusy(false); setPassword(""); }
    }
  }

  return (
    <div className={styles.body}>
      <h2>Change email</h2>
      {!details ? <>
        {error ? <><p role="alert">{error}</p><button type="button" onClick={() => { setError(""); setReload(value => value + 1); }}>Try again</button></>
          : <p role="status">Loading sign-in details…</p>}
      </> : <form onSubmit={submit} className={styles.form}>
        <p className={styles.current}>{details.usernameOnly ? <>Current username: <strong>{details.username}</strong><br />No sign-in email has been added yet.</>
          : <>Current email: <strong>{details.email}</strong></>}</p>
        <p id="admin-email-guidance">{details.usernameOnly
          ? "Enter your current password and verify your new inbox to add your admin email."
          : "Enter your current password, then confirm the links in both your current and new inboxes."}</p>
        <label htmlFor="admin-new-email">New email
          <input id="admin-new-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254}
            value={email} onChange={event => { setEmail(event.target.value); setMessage(""); }} disabled={busy} aria-describedby="admin-email-guidance" />
        </label>
        <label htmlFor="admin-current-password">Current password
          <input id="admin-current-password" type="password" autoComplete="current-password" required maxLength={1024}
            value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
        </label>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <button type="submit" disabled={busy}>{busy ? "Sending confirmation…" : "Send confirmation"}</button>
        <p className={styles.hint}>After confirming, use your new email and existing password to sign in.</p>
      </form>}
    </div>
  );
}
