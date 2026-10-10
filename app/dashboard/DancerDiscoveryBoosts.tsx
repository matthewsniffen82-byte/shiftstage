"use client";

import { useEffect, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";

type Boosts = { eligible: boolean; boosts: {label:string;until:string}[] };
export function DancerDiscoveryBoosts() {
  const [status,setStatus] = useState<Boosts | null>(null);
  const [error,setError] = useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    void requestDashboardJson("/api/dancer/discovery",{cache:"no-store",expectedRole:"dancer",signal:controller.signal,
      timeoutMs:15000,fallbackMessage:"Unable to load discovery boosts."}).then(result=>{
      if (!controller.signal.aborted) setStatus(result as unknown as Boosts);
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[]);
  return <section className="dancer-analytics-audience" aria-labelledby="discovery-boosts-heading">
    <h3 id="discovery-boosts-heading">Your discovery boosts</h3>
    {error ? <p>Current boosts are temporarily unavailable.</p> : !status ? <p role="status">Loading boosts…</p>
      : !status.eligible ? <p>Your profile must be approved and public to appear in discovery.</p>
      : status.boosts.length ? <ul>{status.boosts.map(boost=><li key={boost.label}><strong>{boost.label}</strong> · Until {new Date(boost.until).toLocaleString()}</li>)}</ul>
      : <p>No availability or fresh-media boost is active right now.</p>}
    <p>A verified club check-in, an upcoming shift, and fresh approved media help guests discover you. The media boost fades over seven days; extra uploads on the same day do not stack it.</p>
    <p>Visitor interest and video watch quality also count. Newer dancers get discovery opportunities, and guests’ follows and preferences personalize their feed. There is no single fixed position for every guest.</p>
  </section>;
}
