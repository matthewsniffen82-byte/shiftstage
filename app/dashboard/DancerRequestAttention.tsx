"use client";

import { useState } from "react";
import type { DancerPendingRequestSummary, DancerRequestWindow } from "@/src/lib/dancr/dancer-request-types";
import { useVisibleAutoRefresh } from "../components/useVisibleAutoRefresh";
import { DancerRequestDialog } from "./DancerRequestDialog";
import { requestDashboardJson } from "./dashboard-session";

export function DancerRequestAttention() {
  const [summary, setSummary] = useState<DancerPendingRequestSummary | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [requestWindow, setRequestWindow] = useState<DancerRequestWindow | null>(null);
  useVisibleAutoRefresh({ intervalMs: 15_000, refreshOnMount: true, refresh: async (signal, isCurrent) => {
    try {
      const result = await requestDashboardJson("/api/dancer/requests?summary=pending", {
        expectedRole: "dancer", cache: "no-store", signal, timeoutMs: 12_000,
      });
      if (isCurrent()) { setSummary(result.summary); setUnavailable(false); }
    } catch {
      if (isCurrent()) { setSummary(null); setUnavailable(true); }
    }
  } });

  return <>
    {unavailable && <p role="status">Request alerts are temporarily unavailable.</p>}
    {summary && (summary.table > 0 || summary.vip > 0) && <section className="dancer-request-attention" aria-labelledby="dancer-request-attention-heading" aria-live="polite">
      <h2 id="dancer-request-attention-heading"><span aria-hidden="true">!</span> Needs attention</h2>
      {(["table", "vip"] as const).map(kind => {
        const count = summary[kind];
        if (!count) return null;
        const table = kind === "table";
        const label = `${count.toLocaleString()} pending ${table ? "table" : "VIP"} request${count === 1 ? "" : "s"}`;
        return <button key={kind} type="button" aria-label={`View ${label}`} onClick={() => setRequestWindow({
          channel: table ? "internal" : "vip", pending: true, since: table ? summary.tableSince : summary.vipSince, until: summary.until,
          label: table ? "Last 6 hours · All clubs" : "All time · All clubs",
        })}><span>{label}</span><strong>View →</strong></button>;
      })}
    </section>}
    {requestWindow && <DancerRequestDialog window={requestWindow} onClose={() => setRequestWindow(null)} />}
  </>;
}
