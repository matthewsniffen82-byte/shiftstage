"use client";

import { useEffect, useState, type FormEvent } from "react";
import { DANCER_AGREEMENT_VERSION, type DancerAgreementAccess } from "@/src/lib/dancr/dancer-agreement-version";
import DancerAgreementLink from "@/app/components/DancerAgreementLink";
import { readSession, requestDashboardJson } from "./dashboard-session";

export type DancerProfileAgreementInput = { agreementAccepted: boolean; agreementVersion: string };

export default function DancerProfileAgreementReview({ profileId, busy, onSubmit }: {
  profileId: string;
  busy: boolean;
  onSubmit: (input: DancerProfileAgreementInput) => Promise<void>;
}) {
  const [agreement, setAgreement] = useState<DancerAgreementAccess | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const userId = readSession()?.account?.id;
    setAgreement(null);
    setChecked(false);
    setError("");
    void requestDashboardJson("/api/dancer/agreement", {
      cache: "no-store", signal: controller.signal, timeoutMs: 15000,
    }).then(data => {
      if (controller.signal.aborted || readSession()?.account?.id !== userId) return;
      if (data.agreement?.version !== DANCER_AGREEMENT_VERSION || typeof data.agreement.accepted !== "boolean") {
        throw new Error("The agreement has changed. Reload this page to review the current version.");
      }
      setAgreement(data.agreement);
    }).catch(failure => {
      if (!controller.signal.aborted && readSession()?.account?.id === userId) {
        setError(failure instanceof Error ? failure.message : "Unable to check your agreement. Please try again.");
      }
    });
    return () => controller.abort();
  }, [profileId, attempt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !agreement || (!agreement.accepted && !checked)) return;
    await onSubmit({ agreementAccepted: checked, agreementVersion: DANCER_AGREEMENT_VERSION });
  }

  return <div className="dancer-profile-agreement">
    <form onSubmit={event => void submit(event)}>
      {!agreement && !error && <p role="status">Checking your agreement status…</p>}
      {agreement?.accepted ? <p>Your Dancer Agreement acceptance is saved.</p> : agreement ? (
        <label className="dancer-profile-agreement-check">
          <input type="checkbox" required checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />
          <span>By checking this box, I agree to the <DancerAgreementLink />.</span>
        </label>
      ) : null}
      {error && <p role="alert">{error}</p>}
      {error && <button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Try again</button>}
      <button className="dancer-onboarding-primary" id="dancer-onboarding-agreement-button" aria-describedby="dancer-onboarding-agreement-status" aria-busy={busy} type="submit" disabled={busy || !agreement || (!agreement.accepted && !checked)}>
        {busy ? "Submitting profile…" : "Submit profile and continue"}
      </button>
    </form>
  </div>;
}
