"use client";

import { useState } from "react";
import { HAIR_COLOR_LABELS, type VenueHairColorReport } from "@/src/lib/dancr/hair-color";
import "./venue-hair-color.css";

const internalMetrics = [["requests", "Table requests"], ["completed", "Completed"], ["pending", "Pending"], ["acknowledged", "Acknowledged"], ["cancelled", "Cancelled"]] as const;
const externalMetrics = [["dancer_profile", "Profile opens"], ["directions", "Directions"], ["claims", "Pass claims"], ["admissions", "Verified admissions"], ["going", "I'm Going"], ["free_entry", "Offer clicks"], ["transport", "Transport clicks"], ["club_page", "Club opens"]] as const;

export default function VenueHairColorAnalytics({ report, timezone }: { report?: VenueHairColorReport; timezone: string }) {
  const [channel, setChannel] = useState<"internal" | "external">("internal");
  const rows = report?.[channel] || [];
  const metrics = channel === "internal" ? internalMetrics : externalMetrics;
  return <details className="venue-hair-color">
    <summary>Hair-color performance <span>AI estimates</span></summary>
    {!report ? <p role="status">Hair-color metrics are unavailable. Refresh to try again.</p> : <>
      <div className="venue-hair-color-channels" role="group" aria-label="Hair-color activity channel">
        <button type="button" aria-pressed={channel === "internal"} onClick={() => setChannel("internal")}>Internal · In venue</button>
        <button type="button" aria-pressed={channel === "external"} onClick={() => setChannel("external")}>External · Public site</button>
      </div>
      <p className="venue-value-note">{channel === "internal"
        ? "Table requests grouped by the main photo on the internal roster when each request was made. Outcomes show their current status."
        : "Public-site activity explicitly linked to this venue and dancer, grouped by their public main photo at the time. Admissions retain the photo from the pass claim."}</p>
      {rows.length ? <div className="venue-hair-color-groups">{rows.map(row => <section key={row.color} aria-label={`${HAIR_COLOR_LABELS[row.color]} hair`}>
        <header><h4>{HAIR_COLOR_LABELS[row.color]}</h4><span>{row.dancers.toLocaleString()} {row.dancers === 1 ? "dancer" : "dancers"}</span></header>
        <dl>{metrics.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{(row.metrics[key] || 0).toLocaleString()}</dd></div>)}</dl>
      </section>)}</div> : <p className="venue-value-empty">No {channel === "internal" ? "in-venue requests" : "attributed public-site activity"} this period.</p>}
      <p className="venue-value-note">Estimates describe visible hair in the photo. Unknown includes unclear photos, pending scans and activity before tracking began on {new Date(report.trackingStartedAt).toLocaleDateString(undefined, { timeZone: timezone, month: "short", day: "numeric", year: "numeric" })}. Changing a photo starts new tracking; earlier results keep their original photo.</p>
      <p className="venue-value-note">These are activity counts, not a rating or proof that hair color caused a result. Dancers can appear in more than one color group after changing photos. Requests, clicks and passes can overlap.</p>
    </>}
  </details>;
}
