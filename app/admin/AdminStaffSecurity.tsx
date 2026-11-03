"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import Link from "next/link";
import { BROWSER_AUTH_SESSION_KEY } from "@/src/lib/dancr/browser-session";
import { readAdminSession, requestAdminJson } from "./admin-session";
import styles from "./AdminStaffSecurity.module.css";

type Factor = { id: string; name: string; verified: boolean };
type Security = { userId: string; mfaVerified: boolean; factors: Factor[] };
type Enrollment = { id: string; qr: string; secret: string };

export default function AdminStaffSecurity({ accountId, children }: { accountId: string; children?: ReactNode }) {
  const [security, setSecurity] = useState<Security | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factorId, setFactorId] = useState("");
  const [name, setName] = useState("My authenticator");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const identity = useCallback(() => mounted.current && readAdminSession()?.account?.id === accountId, [accountId]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    pending.current = controller;
    setSecurity(null); setEnrollment(null); setCode(""); setError("");
    requestAdminJson("/api/admin/security", { cache: "no-store", signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted && identity() && data.userId === accountId) {
          setSecurity(data); setFactorId(data.factors.find((f: Factor) => f.verified)?.id || "");
        }
      }).catch(e => { if (!controller.signal.aborted && identity()) setError(e instanceof Error ? e.message : "Unable to check staff security."); })
      .finally(() => { if (pending.current === controller) pending.current = null; });
    const recheck = () => {
      if (document.visibilityState === "hidden" || !identity()) {
        pending.current?.abort(); pending.current = null;
        setEnrollment(null); setCode(""); setSecurity(null); setBusy(false);
      } else setReload(v => v + 1);
    };
    const storage = (event: StorageEvent) => { if (event.key === BROWSER_AUTH_SESSION_KEY) recheck(); };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("storage", storage);
    return () => { mounted.current = false; controller.abort(); pending.current?.abort(); pending.current = null; document.removeEventListener("visibilitychange", recheck); window.removeEventListener("storage", storage); };
  }, [accountId, reload, identity]);

  async function act(body: Record<string, unknown>) {
    if (pending.current || busy || !identity()) return;
    const controller = new AbortController(); pending.current = controller;
    const current = () => !controller.signal.aborted && identity();
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestAdminJson("/api/admin/security", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      if (!current() || result.userId !== accountId) return;
      if (result.enrollment) { setEnrollment(result.enrollment); setFactorId(result.enrollment.id); }
      else { setEnrollment(null); setMessage(result.message || "Security updated."); setReload(v => v + 1); }
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : "The security change could not be confirmed."); }
    finally { if (pending.current === controller) pending.current = null; if (current()) { setBusy(false); setCode(""); } }
  }
  function verify(event: FormEvent) { event.preventDefault(); void act({ action: "verify", factorId: enrollment?.id || factorId, code }); }
  if (children && security?.mfaVerified) return <>{children}</>;
  const verified = security?.factors.filter(f => f.verified) || [];
  return <section className={styles.root} aria-label="Staff security">
    <h2>Staff security</h2>
    <p>Use your own authenticator to access safety and privacy records.</p>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!security ? <><p>{error ? "Security could not be confirmed." : "Checking your staff session…"}</p><button type="button" disabled={busy} onClick={() => setReload(v => v + 1)}>Check again</button></> : <>
      {security.mfaVerified && <p role="status">MFA verified for this session.</p>}
      {enrollment ? <div className={styles.enrollment}>
        <h3>Connect your authenticator</h3>
        <p>Scan this code using your authenticator app, then enter its six-digit code below. Keep the QR code and setup key private.</p>
        {/* Locally generated PNG; never load enrollment secrets through an external image service. */}
        <img src={enrollment.qr} alt="Authenticator setup QR code" width={240} height={240} />
        <details><summary>Enter the setup key manually</summary><code className={styles.secret}>{enrollment.secret}</code></details>
        <p>If this page closes, remove the unfinished setup and start again.</p>
      </div> : <>
        {!security.mfaVerified && verified.length > 0 && <label>Authenticator<select value={factorId} onChange={e => setFactorId(e.target.value)} disabled={busy}>{verified.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
        {(security.mfaVerified || verified.length === 0) && !security.factors.some(f => !f.verified) && <form onSubmit={e => { e.preventDefault(); void act({ action: "enroll", name }); }}>
          <label>Authenticator name<input value={name} onChange={e => setName(e.target.value)} maxLength={60} required disabled={busy} autoComplete="off" /></label>
          <button type="submit" disabled={busy}>{verified.length ? "Add backup authenticator" : "Set up authenticator"}</button>
        </form>}
      </>}
      {(enrollment || (!security.mfaVerified && verified.length > 0)) && <form onSubmit={verify}>
        <label>Six-digit code<input type="text" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required disabled={busy} /></label>
        <button type="submit" disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Verify authenticator"}</button>
      </form>}
      {!enrollment && security.factors.length > 0 && <ul>{security.factors.map(f => <li key={f.id}>
        <span>{f.name} — {f.verified ? "Verified" : "Unfinished setup"}</span>
        {(!f.verified || (security.mfaVerified && verified.length > 1)) && <button type="button" disabled={busy} onClick={() => {
          if (!f.verified || window.confirm(`Remove ${f.name}? Keep access to your other verified authenticator.`)) void act({ action: "remove", factorId: f.id });
        }}>{f.verified ? "Remove" : "Remove unfinished setup"}</button>}
      </li>)}</ul>}
      {enrollment && <button type="button" disabled={busy} onClick={() => void act({ action: "remove", factorId: enrollment.id })}>Cancel unfinished setup</button>}
      <p className={styles.hint}>Add a backup authenticator before replacing your current one. If you lose access to every authenticator, contact the account owner for an identity-checked recovery; a password reset alone does not remove MFA.</p>
    </>}
  </section>;
}

export function StaffMfaBoundary({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState("");
  useEffect(() => { setAccountId(String(readAdminSession()?.account?.id || "")); }, []);
  if (!accountId) return <p>Sign in with your individual staff account. <Link href="/admin">Open staff sign in</Link></p>;
  return <AdminStaffSecurity key={accountId} accountId={accountId}>{children}</AdminStaffSecurity>;
}
