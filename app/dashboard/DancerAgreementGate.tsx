"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { DANCER_AGREEMENT_HREF, DANCER_AGREEMENT_VERSION, type DancerAgreementAccess } from "@/src/lib/dancr/dancer-agreement-version";
import { readSession, requestDashboardJson } from "./dashboard-session";
import "./dancer-agreement-gate.css";

export default function DancerAgreementGate({ children }: { children: ReactNode }) {
  const [agreement, setAgreement] = useState<DancerAgreementAccess | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  function accountGuard() {
    const userId = readSession()?.account?.id;
    return () => userId ? readSession()?.account?.id === userId : !readSession()?.accessToken;
  }

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    const guard = accountGuard();
    inFlightRef.current = false;
    setBusy(false);
    setAgreement(null);
    setChecked(false);
    setError("");
    void requestDashboardJson("/api/dancer/agreement", {
      cache: "no-store", signal: controller.signal, timeoutMs: 15000,
    }).then(data => {
      if (!controller.signal.aborted && guard()) setAgreement(data.agreement);
    }).catch(failure => {
      if (!controller.signal.aborted && guard()) setError(failure instanceof Error ? failure.message : "Unable to check your agreement. Please try again.");
    });
    const checkAccount = () => {
      if (!guard()) {
        requestRef.current?.abort();
        setAgreement(null);
        setAttempt(value => value + 1);
      }
    };
    window.addEventListener("storage", checkAccount);
    window.addEventListener("pageshow", checkAccount);
    window.addEventListener("focus", checkAccount);
    return () => {
      controller.abort(); requestRef.current?.abort();
      window.removeEventListener("storage", checkAccount);
      window.removeEventListener("pageshow", checkAccount);
      window.removeEventListener("focus", checkAccount);
    };
  }, [attempt]);

  async function accept(event: FormEvent) {
    event.preventDefault();
    if (!checked || inFlightRef.current) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    const guard = accountGuard();
    setBusy(true);
    setError("");
    try {
      const data = await requestDashboardJson("/api/dancer/agreement", {
        method: "POST", signal: controller.signal, timeoutMs: 15000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agreementAccepted: true, agreementVersion: DANCER_AGREEMENT_VERSION }),
      });
      if (!controller.signal.aborted && guard()) setAgreement(data.agreement);
    } catch (failure) {
      if (!controller.signal.aborted && guard()) setError(failure instanceof Error ? failure.message : "Unable to save your acceptance. Please try again.");
    } finally {
      inFlightRef.current = false;
      if (!controller.signal.aborted && guard()) setBusy(false);
    }
  }

  if (agreement?.version === DANCER_AGREEMENT_VERSION && (agreement.required === false || agreement.accepted === true)) return <>{children}</>;

  return <main className="dancer-agreement-gate">
    <nav><Link href="/">mydancr</Link><Link href="/account">Account settings</Link></nav>
    <section aria-labelledby="agreement-heading" aria-busy={busy}>
      <span className="dancer-agreement-eyebrow">Dancer account</span>
      <h1 id="agreement-heading">Review your Dancer Agreement</h1>
      {!agreement ? <p role="status">{error ? "Your agreement status could not be confirmed." : "Checking your agreement status…"}</p> : <>
        <p>Please read and accept the Dancer Agreement before continuing to your dancer dashboard, profile, videos, or club features.</p>
        <p><a href={DANCER_AGREEMENT_HREF} target="_blank" rel="noopener">Read the Dancer Agreement (opens in a new tab)</a></p>
        <form onSubmit={accept}>
          <label className="dancer-agreement-check">
            <input type="checkbox" required checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />
            <span>I agree to the <a href={DANCER_AGREEMENT_HREF} target="_blank" rel="noopener">Dancer Agreement</a>.</span>
          </label>
          <button type="submit" disabled={!checked || busy}>{busy ? "Saving acceptance…" : "Accept and continue"}</button>
        </form>
        <p className="dancer-agreement-note">See how your information is handled in our <Link href="/privacy">Privacy Policy</Link>.</p>
      </>}
      {error && <p role="alert">{error}</p>}
      {error && !agreement && <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
      <p className="dancer-agreement-note"><Link href="/">Back to MyDancr</Link>{" · "}<a href="mailto:support@mydancr.com">Contact support</a></p>
    </section>
  </main>;
}
