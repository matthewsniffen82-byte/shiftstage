"use client";

import { useEffect, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";

type Boosts = { eligible: boolean; score: number | null };
export function DancerDiscoveryBoosts() {
  const [status,setStatus] = useState<Boosts | null>(null);
  const [error,setError] = useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    void requestDashboardJson("/api/dancer/discovery",{cache:"no-store",expectedRole:"dancer",signal:controller.signal,
      timeoutMs:15000,fallbackMessage:"Unable to load discovery placement."}).then(result=>{
      if (!controller.signal.aborted) setStatus(result as unknown as Boosts);
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[]);
  return <section className="dancer-analytics-audience" aria-labelledby="discovery-boosts-heading">
    <h3 id="discovery-boosts-heading">Your discovery placement</h3>
    {error ? <p>Your placement score is temporarily unavailable.</p> : !status ? <p role="status">Loading placement score…</p>
      : !status.eligible ? <p>Your profile must be approved and public to appear in discovery.</p>
      : status.score !== null ? <p><strong>Overall Performance: {status.score}/100</strong> · Last 30 days</p>
      : <p>You need more recorded activity before an Overall Performance score is available.</p>}
    <p>Higher Overall Performance scores place dancers higher in external grids, internal rosters and Dancer TV. Placement uses the same 30-day score shown in the venue dashboard.</p>
    <p>Placement uses the club shown on your card, or your most recent active club affiliation when no club is shown. Internal rosters always use that club’s score. Dancers without a score appear after scored dancers.</p>
  </section>;
}
