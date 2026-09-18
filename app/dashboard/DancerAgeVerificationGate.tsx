"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { requestDashboardJson } from "./dashboard-session";

type Verification = { required: boolean; configured: boolean; status: string; verifiedAt: string | null };

export default function DancerAgeVerificationGate({ children }: { children: ReactNode }) {
  const [verification, setVerification] = useState<Verification | null>(null);
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
      // Reload the dashboard once so a saved first club tap can now finalize.
      if (refresh && data.verification?.status === "verified") window.location.replace("/dashboard/dancer");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const returned = new URLSearchParams(window.location.search).get("age-verification") === "returned";
    void load(returned, controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("We couldn't check your verification. Please try again.");
    });
    return () => controller.abort();
  }, [load]);

  async function act(start: boolean) {
    if (busy || (start && !consent)) return;
    setBusy(true);
    setError("");
    try {
      if (start) {
        const data = await requestDashboardJson("/api/dancer/age-verification", {
          method: "POST", expectedRole: "dancer", timeoutMs: 25_000, fallbackMessage: "Unable to start verification.",
        });
        if (data.url) {
          const url = new URL(data.url);
          if (url.protocol !== "https:" || url.hostname !== "verify.didit.me" || url.username || url.password || url.port) throw new Error("Unable to open verification.");
          window.location.assign(url.href);
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
  return <>
    <section className="dancer-age-verification" aria-labelledby="dancer-age-heading" aria-busy={busy}>
      <span className="dancer-age-eyebrow">Dancer account · 18+ only</span>
      <h2 id="dancer-age-heading">Verify your age</h2>
      <p>{!verification ? "Checking your verification status…"
        : !verification.configured ? "Age verification is being connected. Please check back shortly. Account settings and support remain available."
        : reviewing ? "Your verification needs review. Check your status again after Didit finishes reviewing it."
        : verification.status === "declined" ? "Your verification was not approved. You must be 18 or older to use dancer features. You can retry with a valid ID or contact support."
        : "Confirm you are 18 or older before setting up your dancer profile. You'll need a government-issued photo ID and a live selfie."}</p>
      {verification?.configured && !reviewing && <>
        <p>Didit checks your ID and selfie. MyDancr keeps the verification result and reference, without storing your ID images, selfie, or date of birth.</p>
        <label className="dancer-age-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
          <span>I understand that I’ll continue to Didit for ID and selfie verification. I’ll review its privacy notice and consent choices before submitting.</span>
        </label>
        <button type="button" className="button primary" disabled={busy || !consent} onClick={() => void act(true)}>
          {busy ? "Please wait…" : verification.status === "pending" ? "Continue verification" : "Verify I'm 18+"}
        </button>
      </>}
      <button type="button" className="button secondary" disabled={busy} onClick={() => void act(false)}>Check verification status</button>
      {error && <p role="alert">{error}</p>}
      <p className="dancer-age-note">Age verification does not replace your club’s approval.</p>
    </section>
    {verification && !verification.required ? children : null}
  </>;
}
