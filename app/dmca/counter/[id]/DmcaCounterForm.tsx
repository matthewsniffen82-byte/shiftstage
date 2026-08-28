"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { readBrowserAccessToken } from "@/src/lib/dancr/browser-session";

type DmcaCase = {
  id: string;
  claimantName: string;
  claimantCompany?: string | null;
  claimantEmail: string;
  copyrightedWorkDescription: string;
  originalWorkUrl?: string | null;
  infringingUrl: string;
  status: string;
  disabledAt?: string | null;
  counterReceivedAt?: string | null;
  restoreEligibleAt?: string | null;
  courtFilingReceived?: boolean;
  counterNotices?: Array<Record<string, unknown>>;
};

export default function DmcaCounterForm({ caseId }: { caseId: string }) {
  const [dmcaCase, setDmcaCase] = useState<DmcaCase | null>(null);
  const [status, setStatus] = useState("Loading copyright case…");
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadCase = useCallback(async (signal: AbortSignal) => {
    const token = readBrowserAccessToken();
    if (!token) {
      if (signal.aborted) return;
      setIsError(true);
      setStatus("Sign in to the uploader account on MyDancr, then reopen this page.");
      return;
    }

    try {
      const response = await fetch(`/api/dmca/cases/${encodeURIComponent(caseId)}`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
      });
      const data = await response.json();
      if (signal.aborted) return;
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load copyright case.");
      setDmcaCase(data.case);
      setIsError(false);
      setStatus("");
    } catch (error) {
      if (signal.aborted) return;
      setIsError(true);
      setStatus(error instanceof Error ? error.message : "Unable to load copyright case.");
    }
  }, [caseId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCase(controller.signal);
    return () => controller.abort();
  }, [loadCase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readBrowserAccessToken();
    if (!token) {
      setIsError(true);
      setStatus("Sign in to the uploader account before submitting a counter-notice.");
      return;
    }

    setIsSubmitting(true);
    setIsError(false);
    setStatus("");
    const values = new FormData(event.currentTarget);
    const payload = {
      legalName: values.get("legalName"),
      email: values.get("email"),
      phone: values.get("phone"),
      address: values.get("address"),
      removedMaterialLocation: values.get("removedMaterialLocation"),
      signature: values.get("signature"),
      mistakeBeliefConfirmed: values.get("mistakeBeliefConfirmed") === "on",
      perjuryConfirmed: values.get("perjuryConfirmed") === "on",
      jurisdictionConfirmed: values.get("jurisdictionConfirmed") === "on",
      serviceConfirmed: values.get("serviceConfirmed") === "on",
    };

    try {
      const response = await fetch(`/api/dmca/cases/${encodeURIComponent(caseId)}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to submit counter-notice.");
      setStatus(data.message || "Counter-notice submitted.");
      setDmcaCase((current) => current ? {
        ...current,
        status: "countered",
        counterReceivedAt: new Date().toISOString(),
        restoreEligibleAt: data.counterNotice?.restoreEligibleAt,
      } : current);
    } catch (error) {
      setIsError(true);
      setStatus(error instanceof Error ? error.message : "Unable to submit counter-notice.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!dmcaCase) {
    return (
      <section className="counter-card">
        <p className={`counter-status${isError ? " error" : ""}`} role="status">{status}</p>
        {isError ? <Link href="/?dancr_dashboard=dancer">Open MyDancr sign in</Link> : null}
      </section>
    );
  }

  const alreadyCountered = dmcaCase.status === "countered" || Boolean(dmcaCase.counterNotices?.length);
  const canCounter = dmcaCase.status === "disabled" && !alreadyCountered;

  return (
    <section className="counter-card">
      <h2>Case {dmcaCase.id}</h2>
      <div className="counter-summary">
        <div><span>Status</span><strong>{label(dmcaCase.status)}</strong></div>
        <div><span>Claimant</span><strong>{dmcaCase.claimantName}{dmcaCase.claimantCompany ? ` · ${dmcaCase.claimantCompany}` : ""}</strong></div>
        <div><span>Claimant email</span><a href={`mailto:${dmcaCase.claimantEmail}`}>{dmcaCase.claimantEmail}</a></div>
        <div><span>Claimed work</span><strong>{dmcaCase.copyrightedWorkDescription}</strong></div>
        {dmcaCase.originalWorkUrl ? <div><span>Original work</span><a href={dmcaCase.originalWorkUrl} target="_blank" rel="noreferrer">Open reference</a></div> : null}
        <div><span>Removed location</span><a href={dmcaCase.infringingUrl} target="_blank" rel="noreferrer">{dmcaCase.infringingUrl}</a></div>
      </div>

      {alreadyCountered ? (
        <div className="counter-status" role="status">
          Your counter-notice was received.
          {dmcaCase.restoreEligibleAt
            ? ` Restoration becomes eligible after ${new Date(dmcaCase.restoreEligibleAt).toLocaleDateString()}.`
            : " MyDancr will notify you about the outcome."}
          {dmcaCase.courtFilingReceived ? " A court filing notice is on record, so restoration is paused." : ""}
        </div>
      ) : null}

      {!canCounter && !alreadyCountered ? (
        <p className="counter-status">
          This case is not eligible for a counter-notice in its current status.
        </p>
      ) : null}

      {canCounter ? (
        <form className="counter-form" onSubmit={submit}>
          <h3>Submit counter-notice</h3>
          <p>
            The contact information below will be forwarded to the original claimant. This is a legal submission.
          </p>
          <label>
            Full legal name
            <input name="legalName" autoComplete="name" minLength={2} maxLength={160} required />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" maxLength={320} required />
          </label>
          <label>
            Phone
            <input name="phone" type="tel" autoComplete="tel" minLength={7} maxLength={50} required />
          </label>
          <label>
            Physical mailing address
            <textarea name="address" autoComplete="street-address" minLength={10} maxLength={1000} required />
          </label>
          <label>
            Location where the removed material appeared
            <input
              name="removedMaterialLocation"
              type="url"
              defaultValue={dmcaCase.infringingUrl}
              minLength={8}
              maxLength={2000}
              required
            />
          </label>
          <label className="counter-check">
            <input name="mistakeBeliefConfirmed" type="checkbox" required />
            <span>I have a good-faith belief that the material was removed or disabled because of mistake or misidentification.</span>
          </label>
          <label className="counter-check">
            <input name="perjuryConfirmed" type="checkbox" required />
            <span>I state this belief under penalty of perjury.</span>
          </label>
          <label className="counter-check">
            <input name="jurisdictionConfirmed" type="checkbox" required />
            <span>I consent to the jurisdiction of the United States Federal District Court for my address, or if outside the United States, the district where MyDancr may be found.</span>
          </label>
          <label className="counter-check">
            <input name="serviceConfirmed" type="checkbox" required />
            <span>I will accept service of process from the original claimant or the claimant&apos;s agent.</span>
          </label>
          <label>
            Electronic signature — type your full legal name
            <input name="signature" autoComplete="name" minLength={2} maxLength={160} required />
          </label>
          <button className="counter-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting counter-notice…" : "Submit legal counter-notice"}
          </button>
        </form>
      ) : null}

      {status ? (
        <p className={`counter-status${isError ? " error" : ""}`} role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
