"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

export default function VenueEmailConfirmation() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    try { setEmail(sessionStorage.getItem("dancrVenueConfirmationEmail") || ""); } catch {}
    if (new URLSearchParams(window.location.search).get("delivery") === "failed") setMessage("Your details are saved, but we couldn’t send the email. Request another link below.");
    return () => controllerRef.current?.abort();
  }, []);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setSending(true);
    setMessage("");
    try {
      const response = await fetch("/api/venue/signup-requests/confirmation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send the email.");
      setMessage(data.message);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Unable to send the email.");
      else setMessage("The request took too long. Check your inbox before requesting another link.");
    } finally {
      window.clearTimeout(timeout);
      controllerRef.current = null;
      setSending(false);
    }
  }

  return <main className="venue-confirm-page">
    <section className="venue-confirm-card">
      <p className="venue-confirm-brand">MyDancr · Club signup</p>
      <span className="venue-confirm-icon" aria-hidden="true">✉</span>
      <h1>Check your email</h1>
      <p>Your club details and login are saved. Open the confirmation link in your email to continue.</p>
      <ol><li>Club details saved</li><li aria-current="step"><strong>Confirm your email</strong></li><li>Wait for club approval</li></ol>
      <p>Confirming your email opens your waiting-for-approval screen.</p>
      <form onSubmit={resend}>
        <label htmlFor="confirmation-email">Manager email</label>
        <input id="confirmation-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={sending} />
        <small>Check spam or junk. If you need a new link, enter the email you used for your club request.</small>
        <button type="submit" disabled={sending}>{sending ? "Sending…" : "Resend confirmation email"}</button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      <Link href="/?venueAccess=1&venueMode=login" prefetch={false}>Already confirmed? Sign in</Link>
    </section>
    <style>{`
      body:has(.venue-confirm-page){margin:0}
      .venue-confirm-page{box-sizing:border-box;min-height:100dvh;display:grid;place-items:center;padding:24px 16px 112px;background:radial-gradient(circle at 50% 10%,#291346,transparent 65%),#050507;color:#f7f2ff;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
      .venue-confirm-card{box-sizing:border-box;width:min(100%,460px);padding:24px;display:grid;gap:16px;border:1px solid #514263;border-radius:24px;background:#100c19}
      .venue-confirm-card h1,.venue-confirm-card p{margin:0}.venue-confirm-card h1{font-size:32px}.venue-confirm-card p{line-height:1.55;color:#d1c7df}.venue-confirm-brand{color:#a8e6ff!important;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em}.venue-confirm-icon{font-size:40px;color:#b99bff}
      .venue-confirm-card ol{margin:0;padding-left:24px;display:grid;gap:12px;color:#b6a8c8}.venue-confirm-card li[aria-current]{color:#fff}.venue-confirm-card form{display:grid;gap:12px}.venue-confirm-card input{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #6b5b7f;border-radius:12px;padding:12px;background:#1c1529;color:#fff;font:inherit}
      .venue-confirm-card button{min-height:48px;padding:14px;border:1px solid #a47bff;border-radius:12px;background:#6b2fd3;color:#fff;font:inherit;font-weight:700;cursor:pointer}.venue-confirm-card button:disabled{opacity:.65}.venue-confirm-card small{color:#b6a8c8;line-height:1.5}.venue-confirm-card a{color:#c8b1ff;text-align:center;padding:12px}.venue-confirm-card :focus-visible{outline:3px solid #a8e6ff;outline-offset:3px}
    `}</style>
  </main>;
}
