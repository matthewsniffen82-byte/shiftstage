"use client";
import { useDashboardHelpArea } from "../components/dashboard-help-scope";
import type { HelpContext } from "../../src/lib/dancr/dashboard-help-context";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { readSession, requestDashboardJson } from "./dashboard-session";
import { ondatoHostedUrl } from "@/src/lib/dancr/ondato-url";

export type DancerAgeVerification = { required: boolean; configured: boolean; status: string; verifiedAt: string | null };

function captureVerificationAccount() {
  const owner = readSession()?.account?.id;
  // Token refresh is allowed; a response for another dancer or a signed-out
  // session must never update this gate or redirect to a previous account's IDV.
  return () => Boolean(owner && readSession()?.account?.id === owner && readSession()?.account?.role === "dancer");
}

export default function DancerAgeVerificationGate({ children, profileSubmitted = true, onVerificationChange, loadingLabel = "Checking account status…", helpContext = "dancer-verification" }: {
  children: ReactNode;
  profileSubmitted?: boolean;
  onVerificationChange?: (verification: DancerAgeVerification) => void;
  loadingLabel?: string;
  helpContext?: HelpContext;
}) {
  const [verification, setVerification] = useState<DancerAgeVerification | null>(null);
  useDashboardHelpArea(helpContext, Boolean(verification?.required && verification.status !== "verified"));
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const requestSequence = useRef(0);
  const actionController = useRef<AbortController | null>(null);
  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    const isCurrentAccount = captureVerificationAccount();
    let data;
    try {
      data = await requestDashboardJson(`/api/dancer/age-verification${refresh ? "?action=refresh" : ""}`, {
        method: refresh ? "POST" : "GET", cache: "no-store", expectedRole: "dancer", timeoutMs: 25_000, signal,
        fallbackMessage: "We couldn't check your verification. Please try again.",
      });
    } catch (failure) {
      if (mounted.current && !signal?.aborted && sequence === requestSequence.current && isCurrentAccount()) throw failure;
      return;
    }
    if (mounted.current && !signal?.aborted && sequence === requestSequence.current && isCurrentAccount()) {
      setVerification(data.verification);
      onVerificationChange?.(data.verification);
      setError("");
      return data.verification as DancerAgeVerification;
    }
  }, [onVerificationChange]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const isCurrentAccount = captureVerificationAccount();
    const returned = new URLSearchParams(window.location.search).get("age-verification") === "returned";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waiting = (value?: DancerAgeVerification) => value?.configured
      && ["creating", "pending", "in_review"].includes(value.status);
    async function check(refresh: boolean, remaining: number) {
      try {
        if (controller.signal.aborted || !isCurrentAccount()) return;
        if (inFlight.current || (refresh && document.visibilityState === "hidden")) {
          // Pausing must not consume the remaining checks or leave a tab that
          // was opened in the background permanently stuck on "Checking".
          timer = setTimeout(() => void check(refresh, remaining), 15_000);
          return;
        }
        const value = await load(refresh, controller.signal);
        if (controller.signal.aborted || !isCurrentAccount() || !value) return;
        // Read saved approval first so an Ondato outage cannot hide it. A
        // returned or previously unfinished check then gets fresh evidence.
        if (!refresh && profileSubmitted && value.status !== "verified" && value.configured && (returned || waiting(value))) {
          await check(true, remaining);
        } else if (profileSubmitted && waiting(value) && remaining > 0) {
          timer = setTimeout(() => void check(true, remaining - 1), 15_000);
        }
      } catch {
        if (!controller.signal.aborted && isCurrentAccount()) setError("We couldn't check your verification. Please try again.");
      }
    }
    void check(false, 8);
    return () => {
      mounted.current = false;
      controller.abort();
      actionController.current?.abort();
      requestSequence.current += 1;
      clearTimeout(timer);
    };
  }, [load, profileSubmitted]);

  async function act(start: boolean) {
    if (!mounted.current || inFlight.current || (start && (!consent || !profileSubmitted))) return;
    inFlight.current = true;
    requestSequence.current += 1;
    const controller = new AbortController();
    actionController.current = controller;
    const isCurrentAccount = captureVerificationAccount();
    const current = () => mounted.current && !controller.signal.aborted && isCurrentAccount();
    setBusy(true);
    setError("");
    try {
      if (start) {
        const data = await requestDashboardJson("/api/dancer/age-verification", {
          method: "POST", expectedRole: "dancer", timeoutMs: 25_000, signal: controller.signal, fallbackMessage: "Unable to start verification.",
        });
        if (!current()) return;
        if (data.url) {
          const url = ondatoHostedUrl(data.url);
          if (!url) throw new Error("Unable to open verification.");
          window.location.assign(url);
          return;
        }
        await load(false, controller.signal);
      } else await load(Boolean(verification?.configured && profileSubmitted), controller.signal);
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : "Unable to complete verification.");
    } finally {
      inFlight.current = false;
      if (actionController.current === controller) actionController.current = null;
      if (current()) setBusy(false);
    }
  }

  if (verification && !verification.required && !verification.configured) return <>{children}</>;
  if (verification?.status === "verified") return <>{children}</>;
  // An unanswered check is not evidence that the dancer needs to verify again.
  // Keep protected content gated while showing loading or a recoverable error.
  if (!verification) return <section className="dancer-age-verification" aria-label="Account status" aria-busy={!error || busy}>
    {error ? <>
      <p role="alert">{error}</p>
      <button type="button" className="button secondary" disabled={busy} onClick={() => void act(false)}>Try again</button>
    </> : <p className="dancer-age-intro" role="status">{loadingLabel}</p>}
  </section>;
  const reviewing = verification?.status === "in_review";
  const pending = verification?.status === "pending";
  const canStart = profileSubmitted && verification?.configured && !reviewing;
  return <>
    <section className="dancer-age-verification" aria-labelledby="dancer-age-heading" aria-busy={busy}>
      <div className="dancer-age-heading">
        <span className="dancer-age-eyebrow">Dancer account</span>
        <h2 id="dancer-age-heading">Verify you’re 18+</h2>
      </div>
      <p className="dancer-age-intro">{!profileSubmitted ? "Finish and submit your dancer profile first, then verify you are 18 or older before your first club tap."
        : !verification.configured ? "Age verification is being connected. Please check back shortly. Account settings and support remain available."
        : reviewing ? "Your verification needs review. Check your status again later or contact MyDancr support."
        : pending ? "Your verification is unfinished. Continue in Ondato to finish your ID photos and live selfie."
        : verification.status === "expired" ? "Your verification session ended. Start again when you have your photo ID ready."
        : verification.status === "declined" ? "Your verification was not approved. You must be 18 or older to use dancer features. You can retry with a valid ID or contact support."
        : "Have your photo ID ready. Ondato will ask for ID photos and a live selfie."}</p>
      {canStart && <>
        <p className="dancer-age-timing">Required for MyDancr · Allow a few minutes.</p>
        <details className="dancer-age-explanation">
          <summary>Why we verify</summary>
          <p>Verify you’re 18 or older before your first club tap. Ondato checks your photo ID and a live selfie.</p>
          <p className="dancer-age-privacy">MyDancr saves your verification result, not your ID photos, selfie, or date of birth.</p>
        </details>
        <label className="dancer-age-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
          <span>I understand I’ll continue to Ondato for ID and selfie verification.</span>
        </label>
      </>}
      <div className="dancer-age-actions">
        {canStart && <button type="button" className="button primary" disabled={busy || !consent} onClick={() => void act(true)}>
          {busy ? "Please wait…" : pending ? "Continue verification" : "Verify age"}
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
