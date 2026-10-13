"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { isVenueDashboardDemo } from "@/src/lib/dancr/venue-dashboard-demo";
import "./venue-dashboard-demo.css";

const VenueDemoDashboard = dynamic(() => import("./VenueDemoDashboard"), { loading: () => <p role="status">Loading demo dashboard...</p> });

export default function VenueDashboardDemoSwitch({ profile, workingNow, children }: {
  profile?: Record<string, unknown> | null; workingNow: Array<Record<string, unknown>>; children: ReactNode;
}) {
  const [demo, setDemo] = useState(true);
  if (!isVenueDashboardDemo(profile)) return <>{children}</>;
  return <>
    <aside className="venue-demo-banner" aria-label="Dashboard data source">
      <div><strong>{demo ? "Demo data" : "Recorded data"}</strong>
        <p>{demo ? "Fictional, read-only samples. No messages, admissions or account changes are sent." : "Showing this venue's saved records. Normal actions are enabled."}</p></div>
      <label><input type="checkbox" role="switch" checked={demo} onChange={event => setDemo(event.target.checked)} />Demo data</label>
    </aside>
    {demo ? <VenueDemoDashboard workingNow={workingNow} /> : children}
  </>;
}
