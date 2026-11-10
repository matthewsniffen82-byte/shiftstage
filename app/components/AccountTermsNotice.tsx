"use client";
import { useEffect, useState } from "react";
import { requestDashboardJson } from "../dashboard/dashboard-session";
import { USER_TERMS_VERSION } from "@/src/lib/dancr/user-terms-version";
import { ACCESS_TERMS_VERSION } from "@/src/lib/dancr/access-terms";
import RequestTermsCheckbox from "./RequestTermsCheckbox";
import "./account-terms-notice.css";

type TermsStatus = "checking" | "accepted" | "required" | "unavailable";

export default function AccountTermsNotice({ accountId, vip = false }: { accountId: string; vip?: boolean }) {
  const [status, setStatus] = useState<TermsStatus>("checking");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/account/terms${vip ? "?vip=true" : ""}`;
  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    setStatus("checking");
    setError("");
    void requestDashboardJson(endpoint, { expectedRole: "customer", signal: controller.signal, timeoutMs: 15000, fallbackMessage: "Unable to check updated terms." })
      .then(data => {
        if (controller.signal.aborted) return;
        if (typeof data.terms?.accepted !== "boolean") throw new Error("Missing terms status");
        setStatus(data.terms.accepted ? "accepted" : "required");
      })
      .catch(() => { if (!controller.signal.aborted) setStatus("unavailable"); });
    return () => controller.abort();
  }, [accountId, endpoint, attempt]);
  if (!accountId || status === "checking" || status === "accepted") return null;
  if (status === "unavailable") return <section className="account-terms-notice" aria-label="Terms status">
    <p role="status">We couldn’t check whether you’ve accepted the current terms.</p>
    <button type="button" onClick={() => setAttempt(previous => previous + 1)}>Try again</button>
  </section>;
  return <section className="account-terms-notice" aria-label="Updated terms">
    <h2>Please review the updated terms</h2><p>The October 30, 2026 terms update the service rules, privacy disclosures, and dispute provisions. Review and accept them before making new requests or using activity features. Account, privacy, support, and withdrawal controls remain available.</p>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || new FormData(event.currentTarget).get("userTermsAccepted") !== "on") return;
      setBusy(true); setError("");
      try {
        const data = await requestDashboardJson(endpoint, { method: "POST", expectedRole: "customer", body: JSON.stringify({ userTermsAccepted: true, userTermsVersion: USER_TERMS_VERSION, ...(vip ? { accessTermsAccepted: true, accessTermsVersion: ACCESS_TERMS_VERSION } : {}) }), fallbackMessage: "Unable to save acceptance." });
        if (data.terms?.accepted !== true) throw new Error("Unable to save acceptance.");
        setStatus("accepted");
      }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save acceptance."); }
      finally { setBusy(false); }
    }}><RequestTermsCheckbox table={vip} disabled={busy} /><button type="submit" disabled={busy}>{busy ? "Saving…" : "Accept updated terms"}</button></form>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
