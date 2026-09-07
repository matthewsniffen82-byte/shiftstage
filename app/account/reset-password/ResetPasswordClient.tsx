"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  readBrowserAuthSession,
  persistRefreshedBrowserAuthSession,
} from "@/src/lib/dancr/browser-session";

export default function ResetPasswordClient() {
  const [phase, setPhase] = useState<"loading" | "ready" | "expired" | "complete">("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [destination, setDestination] = useState("/account");
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const session = readBrowserAuthSession();
    if (new URLSearchParams(window.location.search).get("error") || !session?.accessToken) {
      setPhase("expired");
      return;
    }
    void fetch("/api/account", {
      headers: sessionHeaders(),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !data.ok) throw new Error("Unable to verify this reset session.");
      persistRefreshedBrowserAuthSession(data.session);
      const role = data.account?.role;
      setDestination(role === "admin" ? "/admin" : ["dancer", "customer", "venue"].includes(role) ? `/dashboard/${role}` : "/account");
      setPhase("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setPhase("expired");
    });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || phase !== "ready") return;
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("The passwords do not match."); return; }
    if (!readBrowserAuthSession()?.accessToken) { setPhase("expired"); return; }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: sessionHeaders(),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to update your password. Please try again.");
      persistRefreshedBrowserAuthSession(data.session);
      setPassword("");
      setConfirmPassword("");
      setPhase("complete");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update your password. Please try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <main className="reset-page">
      <section className="reset-card">
        <p className="reset-brand">MyDancr</p>
        <h1>{phase === "complete" ? "Password updated" : "Reset your password"}</h1>
        {phase === "loading" ? <p role="status">Checking your reset link…</p> : null}
        {phase === "expired" ? <>
          <p role="alert">This reset link is unavailable or has expired. Request a new email using Forgot password.</p>
          <a href="/account?mode=login">Request a new reset link</a>
        </> : null}
        {phase === "ready" ? <form onSubmit={submit}>
          <p>Choose a new password to finish resetting your account.</p>
          <label>New password<input type="password" autoComplete="new-password" minLength={8} maxLength={1024} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={saving} /></label>
          <small>Use at least 8 characters.</small>
          <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} maxLength={1024} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={saving} /></label>
          {error ? <p className="reset-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={saving}>{saving ? "Updating password…" : "Update password"}</button>
        </form> : null}
        {phase === "complete" ? <>
          <p role="status">Your new password has been saved.</p>
          <a href={destination}>Continue to your account</a>
        </> : null}
      </section>
      <style>{`
        .reset-page{min-height:100dvh;box-sizing:border-box;display:grid;place-items:center;padding:24px 16px;background:radial-gradient(circle at 50% 10%,#221143,transparent 60%),#050507;color:#f7f2ff;font-family:Arial,sans-serif}
        .reset-card{box-sizing:border-box;width:min(100%,440px);padding:28px;display:grid;gap:18px;border:1px solid #514263;border-radius:24px;background:#100c19}
        .reset-card h1,.reset-card p{margin:0}.reset-card h1{font-size:30px}.reset-card p{line-height:1.5}.reset-brand{color:#94e5ff;font-weight:900;letter-spacing:.12em}
        .reset-card form,.reset-card label{display:grid;gap:10px}.reset-card form{gap:18px}.reset-card input{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #6b5b7f;border-radius:10px;padding:12px;background:#1c1529;color:#fff;font:inherit}
        .reset-card button,.reset-card a{box-sizing:border-box;min-height:48px;padding:14px;border:1px solid #a47bff;border-radius:12px;background:#6b2fd3;color:white;font:inherit;font-weight:700;text-align:center;text-decoration:none;cursor:pointer}.reset-card button:disabled{opacity:.65;cursor:wait}
        .reset-card small{color:#c5bfd3}.reset-error{color:#ffbac7}.reset-card :focus-visible{outline:3px solid #94e5ff;outline-offset:3px}
      `}</style>
    </main>
  );
}

function sessionHeaders(): Record<string, string> {
  const session = readBrowserAuthSession();
  return {
    "content-type": "application/json",
    ...(session?.accessToken ? { authorization: `Bearer ${session.accessToken}` } : {}),
    ...(session?.refreshToken ? { "x-dancr-refresh-token": session.refreshToken } : {}),
  };
}
