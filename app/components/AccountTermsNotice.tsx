"use client";
import { useEffect, useState } from "react";
import { requestDashboardJson } from "../dashboard/dashboard-session";
import { USER_TERMS_VERSION } from "@/src/lib/dancr/user-terms-version";
import { ACCESS_TERMS_VERSION } from "@/src/lib/dancr/access-terms";
import RequestTermsCheckbox from "./RequestTermsCheckbox";
import "./account-terms-notice.css";
export default function AccountTermsNotice({ accountId, vip = false }: { accountId: string; vip?: boolean }) {
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const endpoint = `/api/account/terms${vip ? "?vip=true" : ""}`;
  useEffect(() => {
    setAccepted(false); setError(""); const controller = new AbortController();
    if (accountId) void requestDashboardJson(endpoint, { expectedRole: "customer", signal: controller.signal, fallbackMessage: "Unable to check updated terms." })
      .then(data => { if (!controller.signal.aborted) setAccepted(data.terms?.accepted === true); })
      .catch(() => { if (!controller.signal.aborted) setError("Please review the updated terms to continue using request and activity features."); });
    return () => controller.abort();
  }, [accountId, endpoint]);
  if (!accountId || accepted) return null;
  return <section className="account-terms-notice" aria-label="Updated terms">
    <h2>Please review the updated terms</h2><p>The October 30, 2026 terms update the service rules, privacy disclosures, and dispute provisions. Review and accept them before making new requests or using activity features. Account, privacy, support, and withdrawal controls remain available.</p>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || new FormData(event.currentTarget).get("userTermsAccepted") !== "on") return;
      setBusy(true); setError("");
      try { const data = await requestDashboardJson(endpoint, { method: "POST", expectedRole: "customer", body: JSON.stringify({ userTermsAccepted: true, userTermsVersion: USER_TERMS_VERSION, ...(vip ? { accessTermsAccepted: true, accessTermsVersion: ACCESS_TERMS_VERSION } : {}) }), fallbackMessage: "Unable to save acceptance." }); setAccepted(data.terms?.accepted === true); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save acceptance."); }
      finally { setBusy(false); }
    }}><RequestTermsCheckbox table={vip} disabled={busy} /><button type="submit" disabled={busy}>{busy ? "Saving…" : "Accept updated terms"}</button></form>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
