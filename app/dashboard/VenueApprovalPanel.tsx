"use client";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import type { LoadState } from "./dashboard-types";

type VenueRequest = NonNullable<LoadState["venueRequest"]>;

export default function VenueApprovalPanel({ request, onApproved }: { request: VenueRequest; onApproved: () => void }) {
  const [status, setStatus] = useState(request.status);
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const checkRef = useRef<AbortController | null>(null);

  useEffect(() => () => { checkRef.current?.abort(); }, []);

  async function checkApproval() {
    if (checkRef.current) return;
    const controller = new AbortController();
    checkRef.current = controller;
    setChecking(true);
    setFeedback("Checking approval status…");
    try {
      const result = await requestDashboardJson("/api/venue/signup-requests", {
        method: "GET", cache: "no-store", expectedRole: "venue", signal: controller.signal, timeoutMs: 12000,
        fallbackMessage: "Unable to check your club request.",
      });
      if (controller.signal.aborted) return;
      if (!result.request || result.request.status === "approved") {
        onApproved();
        return;
      }
      setStatus(result.request.status);
      setFeedback(result.request.status === "rejected"
        ? "Checked—your club request was not approved. Contact support if you need help."
        : "Checked—still waiting for approval. We’ll email you when your club is approved.");
    } catch {
      if (!controller.signal.aborted) setFeedback("Unable to check approval right now. Please try again.");
    } finally {
      if (!controller.signal.aborted) setChecking(false);
      if (checkRef.current === controller) checkRef.current = null;
    }
  }

  return <article className="info-panel venue-approval-panel">
    <h2>{status === "rejected" ? "Request not approved" : "Waiting for approval"}</h2>
    <p>{status === "rejected" ? "Your club request was reviewed and was not approved. Contact support if you need help with the decision." : "Your manager login is saved. We’ll email you when your club is approved. Your dashboard will unlock with this same account—no new password or access code needed."}</p>
    <div className="action-row">
      <button type="button" onClick={checkApproval} disabled={checking}>{checking ? "Checking…" : "Check approval status"}</button>
    </div>
    <div role="status" aria-atomic="true">{feedback && <p>{feedback}</p>}</div>
  </article>;
}
