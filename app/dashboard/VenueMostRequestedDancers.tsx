"use client";

import type { DancerPerformance } from "@/src/lib/dancr/venue-analytics";
import { VenueRosterProfileButton } from "../internal/InternalRoster";
import "./venue-dancer-grid.css";
import "./venue-requested-dancers.css";

export default function VenueMostRequestedDancers({ dancers, channel }: {
  dancers?: DancerPerformance[]; channel: "vip" | "internal";
}) {
  const headingId = `venue-most-requested-${channel}`;
  const rows = dancers?.map(dancer => ({ dancer, total: Number(channel === "vip" ? dancer.vip.scoringRequests || 0 : dancer.internal.requests || 0) }))
    .filter(row => Number.isFinite(row.total) && row.total > 0)
    .sort((a, b) => b.total - a.total || a.dancer.name.localeCompare(b.dancer.name) || a.dancer.id.localeCompare(b.dancer.id));
  return <section className="venue-demand-group venue-most-requested" aria-labelledby={headingId}>
    <h4 id={headingId}>Most requested dancers</h4>
    {rows?.length ? <div className="venue-requested-scroll venue-card-region" role="region" aria-labelledby={headingId} tabIndex={0}>
      <ol className="venue-dancer-grid" aria-label={channel === "vip" ? "Dancers ranked by VIP requests" : "Dancers ranked by table requests"}>
        {rows.map(({ dancer, total }) => {
          const profileId = dancer.profileDancerId === undefined ? dancer.id : dancer.profileDancerId;
          const portrait = <span className="venue-card-portrait">
            <span className="venue-card-photo" aria-hidden="true">{dancer.name.slice(0, 1).toUpperCase()}
              {dancer.photoUrl && <img key={dancer.photoUrl} src={dancer.photoUrl} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.style.display = "none"; }} />}
            </span>
            <span className="venue-card-caption"><strong>{dancer.name}</strong><small className="venue-requested-count">{total.toLocaleString()} {total === 1 ? "request" : "requests"}</small></span>
          </span>;
          return <li key={dancer.id} className="venue-dancer-card">
            {profileId ? <VenueRosterProfileButton dancerId={profileId} stageName={dancer.name} className="ir-profile-link venue-card-profile">{portrait}</VenueRosterProfileButton> : portrait}
          </li>;
        })}
      </ol>
    </div> : <p className="venue-value-empty">{dancers ? "No requests this period." : "Not yet available."}</p>}
  </section>;
}
