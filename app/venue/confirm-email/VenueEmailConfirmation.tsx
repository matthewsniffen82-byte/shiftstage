"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import "./venue-email-confirmation.css";

export default function VenueEmailConfirmation() {
  const [email, setEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [ready, setReady] = useState(false);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [sending, setSending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      const storedEmail = (sessionStorage.getItem("dancrVenueConfirmationEmail") || "").trim();
      setEmail(storedEmail);
      setSavedEmail(storedEmail);
    } catch {}
    if (new URLSearchParams(window.location.search).get("delivery") === "failed") {
      setDeliveryFailed(true);
      setHasError(true);
      setMessage("Your details are saved, but we couldn’t send the email. Request another link below.");
    }
    setReady(true);
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
    setHasError(false);
    try {
      const response = await fetch("/api/venue/signup-requests/confirmation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send the email.");
      setMessage(data.message);
    } catch (error) {
      setHasError(true);
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Unable to send the email.");
      else setMessage("The request took too long. Check your inbox before requesting another link.");
    } finally {
      window.clearTimeout(timeout);
      controllerRef.current = null;
      setSending(false);
    }
  }

  return <main className="venue-confirm-page">
    <section className="venue-confirm-card account-form-surface" aria-labelledby="venue-confirm-title" data-state={hasError ? "error" : "ready"}>
      <p className="venue-confirm-brand">MyDancr · Club signup</p>
      <h1 id="venue-confirm-title">Check your email</h1>
      <p className="venue-confirm-copy">{savedEmail ? <>{deliveryFailed ? "Confirm your club account email:" : "We sent a confirmation link to"}{" "}<strong>{savedEmail}</strong></> : "Confirm the email used for your club account."}</p>
      <form onSubmit={resend} aria-busy={sending}>
        {ready && !savedEmail ? <div className="field">
          <label htmlFor="confirmation-email">Club account email</label>
          <input id="confirmation-email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={sending} />
        </div> : null}
        <button className="account-form-primary" data-sign-in-action type="submit" aria-busy={sending} disabled={!ready || sending || !email.trim()}>{sending ? "Sending…" : "Resend confirmation email"}</button>
      </form>
      {message ? <p className="recovery-status" role={hasError ? "alert" : "status"}>{message}</p> : null}
      <Link className="account-form-back" href="/?venueAccess=1&venueMode=login" prefetch={false}>Already confirmed? Sign in</Link>
    </section>
  </main>;
}
