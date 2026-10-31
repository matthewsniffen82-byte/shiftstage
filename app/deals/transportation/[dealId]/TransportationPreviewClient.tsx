"use client";

import { useEffect, useState } from "react";
import type { PublicClubDeal } from "@/src/lib/dancr/types";
import { readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { requestDashboardJson } from "@/app/dashboard/dashboard-session";
import TransportationClient from "./TransportationClient";

type Preview = { deal: PublicClubDeal; venue: { id: string; name: string; slug: string; address: string; logoImageUrl?: string | null }; shuttleAvailable: boolean; returnHref: string };

export default function TransportationPreviewClient({ dealId }: { dealId: string }) {
  const [data, setData] = useState<Preview | null>(null), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [dashboardHref, setDashboardHref] = useState("/dashboard/venue");
  useEffect(() => {
    const controller = new AbortController(), account = readBrowserAuthSession()?.account;
    setData(null); setError(""); setDashboardHref(account?.role === "admin" ? "/admin" : "/dashboard/venue");
    const unchanged = () => {
      const current = readBrowserAuthSession()?.account;
      return current?.id === account?.id && current?.role === account?.role;
    };
    const checkAccount = () => { if (!unchanged()) { controller.abort(); setData(null); setError("Your account changed. Reload the preview to continue."); } };
    window.addEventListener("storage", checkAccount); window.addEventListener("focus", checkAccount); window.addEventListener("pageshow", checkAccount);
    void requestDashboardJson(`/api/deals/transportation-preview/${encodeURIComponent(dealId)}`, {
      cache: "no-store", signal: controller.signal, timeoutMs: 15000, fallbackMessage: "Unable to load this free-entry preview.",
    }).then(result => {
      if (controller.signal.aborted || !unchanged()) return;
      if (result.deal?.id !== dealId || result.deal?.venueId !== result.venue?.id || typeof result.returnHref !== "string" || !result.returnHref.startsWith("/?")) {
        throw new Error("The preview could not be confirmed. Please try again.");
      }
      setData(result);
    }).catch(reason => { if (!controller.signal.aborted && unchanged()) setError(reason instanceof Error ? reason.message : "Unable to load preview."); });
    return () => { controller.abort(); window.removeEventListener("storage", checkAccount); window.removeEventListener("focus", checkAccount); window.removeEventListener("pageshow", checkAccount); };
  }, [dealId, revision]);

  if (data) return <TransportationClient deal={data.deal} venue={data.venue} shuttleAvailable={data.shuttleAvailable} preview={{ returnHref: data.returnHref }} />;
  return <main className="club-transport-page"><section className="club-transport-card">
    <a className="club-transport-back dancr-home-back" href={dashboardHref}><span aria-hidden="true">‹</span> Back to dashboard</a><h1>Free Entry preview</h1>
    {error ? <><p role="alert">{error}</p><button className="club-transport-submit" type="button" onClick={() => setRevision(value => value + 1)}>Reload preview</button></> : <p role="status">Loading your club’s customer experience…</p>}
  </section></main>;
}
