"use client";

import { useState } from "react";
import { HAIR_COLOR_LABELS, currentPhotoHairColorLabel, type VenueHairColorReport } from "@/src/lib/dancr/hair-color";
import "./venue-hair-color.css";

const internalMetrics = [["requests", "Table requests"], ["completed", "Completed"], ["pending", "Pending"], ["acknowledged", "Acknowledged"], ["cancelled", "Cancelled"]] as const;
const externalMetrics = [["dancer_profile", "Profile opens"], ["directions", "Directions"], ["claims", "Pass claims"], ["admissions", "Verified admissions"], ["going", "I'm Going"], ["free_entry", "Offer clicks"], ["transport", "Transport clicks"], ["club_page", "Club opens"]] as const;

export default function VenueHairColorAnalytics({ report, timezone }: { report?: VenueHairColorReport; timezone: string }) {
  const [channel, setChannel] = useState<"internal" | "external">("internal");
  const rows = report?.[channel] || [];
  const currentPhotos = report?.currentPhotos?.[channel] || [];
  const scanning = currentPhotos.some(photo => photo.state === "scanning");
  const metrics = channel === "internal" ? internalMetrics : externalMetrics;
  return <details className="venue-hair-color">
    <summary>Hair-color performance <span>AI estimates</span></summary>
    {!report ? <p role="status">Hair-color metrics are unavailable. Refresh to try again.</p> : <>
      <div className="venue-hair-color-channels" role="group" aria-label="Hair-color activity channel">
        <button type="button" aria-pressed={channel === "internal"} onClick={() => setChannel("internal")}>Internal · In venue</button>
        <button type="button" aria-pressed={channel === "external"} onClick={() => setChannel("external")}>External · Public site</button>
      </div>
      {currentPhotos.length > 0 && <section className="venue-hair-color-current" aria-label="Current photo hair colors">
        <h4>Current photo colors</h4>
        <p>For dancers with activity in this period.</p>
        <ul>{currentPhotos.map(photo => <li key={`${photo.state}:${photo.color}`}>
          <strong>{currentPhotoHairColorLabel(photo)}</strong><span>{photo.dancers.toLocaleString()} {photo.dancers === 1 ? "dancer" : "dancers"}</span>
        </li>)}</ul>
        {scanning && <p role="status">Scanning existing main photos. Refresh shortly to see their colors.</p>}
      </section>}
      <p className="venue-value-note">{channel === "internal"
        ? "Table requests grouped by the main photo on the internal roster when each request was made. Outcomes show their current status."
        : "Public-site activity explicitly linked to this venue and dancer, grouped by their public main photo at the time. Admissions retain the photo from the pass claim."}</p>
      {rows.length ? <div className="venue-hair-color-groups">{rows.map(row => <section key={row.color} aria-label={`${HAIR_COLOR_LABELS[row.color]} hair`}>
        <header><h4>{row.color === "unknown" ? "Hair color not recorded" : `${HAIR_COLOR_LABELS[row.color]} hair`}</h4><span>{row.dancers.toLocaleString()} {row.dancers === 1 ? "dancer" : "dancers"}</span></header>
        {row.color === "unknown" && <p className="venue-value-note">No reliable hair-color estimate was recorded for these actions. Older activity stays here even after today’s photos are scanned.</p>}
        <dl>{metrics.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{(row.metrics[key] || 0).toLocaleString()}</dd></div>)}</dl>
      </section>)}</div> : <p className="venue-value-empty">No {channel === "internal" ? "in-venue requests" : "attributed public-site activity"} this period.</p>}
      <details className="venue-hair-color-method"><summary>How colors are counted</summary>
        <p className="venue-value-note">AI estimates describe visible hair in each photo. Current photo colors describe today’s main photos. Activity uses the photo recorded when the action happened, with tracking available since {new Date(report.trackingStartedAt).toLocaleDateString(undefined, { timeZone: timezone, month: "short", day: "numeric", year: "numeric" })}. Changing a photo keeps earlier results tied to their original photo.</p>
        <p className="venue-value-note">These are activity counts, not a rating or proof that hair color caused a result. Dancers can appear in more than one color group after changing photos. Requests, clicks and passes can overlap.</p>
      </details>
    </>}
  </details>;
}
