"use client";

import { useEffect, useState } from "react";
import { readSession, requestDashboardJson } from "../dashboard/dashboard-session";

export default function InternalLiveEntry() {
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const accountId = readSession()?.account?.id;
    void requestDashboardJson("/api/venue/internal-entry", {
      expectedRole: "venue", cache: "no-store", signal: controller.signal, timeoutMs: 15_000,
      fallbackMessage: "Unable to open your club’s live internal page.",
    }).then(data => {
      if (controller.signal.aborted) return;
      const account = readSession()?.account;
      if (!accountId || account?.id !== accountId || account?.role !== "venue") {
        throw new Error("Your sign-in changed. Return to the club dashboard and try again.");
      }
      if (typeof data.href !== "string" || !/^\/internal\/club\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.href)) {
        throw new Error("Your club’s live internal page is unavailable.");
      }
      // Preserve the dashboard origin for the explicit return button; QR links stay unchanged.
      window.location.replace(`${data.href}?from=club-dashboard`);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to open your club’s live internal page.");
    });
    return () => controller.abort();
  }, [attempt]);

  return <div className="ir-shell ir-staff">
    {error ? <section className="ir-panel" role="alert">
      <h1>Unable to open internal</h1>
      <p>{error}</p>
      <div className="ir-actions">
        <button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Try again</button>
        <a className="ir-secondary" href="/dashboard/venue">Back to club dashboard</a>
      </div>
    </section> : <p role="status">Opening live internal page…</p>}
  </div>;
}
