"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { ondatoHostedUrl } from "@/src/lib/dancr/ondato-url";

export type DancerAgeVerification = { required: boolean; configured: boolean; status: string; verifiedAt: string | null };

export default function DancerAgeVerificationGate({ children, profileSubmitted = true, onVerificationChange }: {
  children: ReactNode;
  profileSubmitted?: boolean;
  onVerificationChange?: (verification: DancerAgeVerification) => void;
}) {
  const [verification, setVerification] = useState<DancerAgeVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    const data = await requestDashboardJson(`/api/dancer/age-verification${refresh ? "?action=refresh" : ""}`, {
      method: refresh ? "POST" : "GET", cache: "no-store", expectedRole: "dancer", timeoutMs: 25_000, signal,
      fallbackMessage: "We couldn't check your verification. Please try again.",
    });
    if (!signal?.aborted) {
      setVerification(data.verification);
      onVerificationChange?.(data.verification);
    }
  }, [onVerificationChange]);

  useEffect(() => {
    const controller = new AbortController();
    const returned = new URLSearchParams(window.location.search).get("age-verification") === "returned";
    void load(returned, controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("We couldn't check your verification. Please try again.");
    });
    return () => controller.abort();
  }, [load]);

  async function act(start: boolean) {
    if (busy || (start && (!consent || !profileSubmitted))) return;
    setBusy(true);
    setError("");
    try {
      if (start) {
        const data = await requestDashboardJson("/api/dancer/age-verification", {
          method: "POST", expectedRole: "dancer", timeoutMs: 25_000, fallbackMessage: "Unable to start verification.",
        });
        if (data.url) {
          const url = ondatoHostedUrl(data.url);
          if (!url) throw new Error("Unable to open verification.");
          window.location.assign(url);
          return;
        }
        await load();
      } else await load(Boolean(verification?.configured));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to complete verification.");
    } finally { setBusy(false); }
  }

  if (verification && !verification.required && !verification.configured) return <>{children}</>;
  if (verification?.status === "verified") return <>{children}</>;
  const reviewing = verification?.status === "in_review";
  const canStart = profileSubmitted && verification?.configured && !reviewing;
  return <>
    <section className="dancer-age-verification" aria-labelledby="dancer-age-heading" aria-busy={busy}>
      <div className="dancer-age-heading">
        <span className="dancer-age-eyebrow">Dancer account</span>
        <h2 id="dancer-age-heading">Verify you’re 18+</h2>
      </div>
      <p className="dancer-age-intro">{!verification ? "Checking your verification status…"
        : !profileSubmitted ? "Finish and submit your dancer profile first, then verify you are 18 or older before your first club tap."
        : !verification.configured ? "Age verification is being connected. Please check back shortly. Account settings and support remain available."
        : reviewing ? "Your verification needs review. Check your status again later or contact MyDancr support."
        : verification.status === "declined" ? "Your verification was not approved. You must be 18 or older to use dancer features. You can retry with a valid ID or contact support."
        : "Have your photo ID ready. Ondato will ask for ID photos and a live selfie."}</p>
      {canStart && <>
        <p className="dancer-age-timing">Allow a few minutes. Complete this step before your first club tap.</p>
        <p className="dancer-age-privacy">MyDancr saves your verification result, not your ID photos, selfie, or date of birth.</p>
        <label className="dancer-age-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
          <span>I understand I’ll continue to Ondato for ID and selfie verification.</span>
        </label>
      </>}
      <div className="dancer-age-actions">
        {canStart && <button type="button" className="button primary" disabled={busy || !consent} onClick={() => void act(true)}>
          {busy ? "Please wait…" : "Continue to Ondato"}
        </button>}
        <button type="button" className="button secondary" disabled={busy} onClick={() => void act(false)}>Check verification status</button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="dancer-age-footer">
        <p className="dancer-age-links">
          <a href="https://ondato.com/privacy-policy/" target="_blank" rel="noopener noreferrer" aria-label="Ondato privacy notice (opens in a new tab)">Privacy notice</a>
          <span aria-hidden="true">·</span>
          <a href="/dashboard/dancer#dancer-support">Get help</a>
        </p>
        <p className="dancer-age-note">Age verification does not replace your club’s approval.</p>
      </div>
    </section>
    {verification && !verification.required ? children : null}
  </>;
}
