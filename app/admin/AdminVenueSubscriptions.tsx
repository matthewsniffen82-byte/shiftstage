"use client";

import { useState } from "react";

export default function AdminVenueSubscriptions({ venues }: { venues?: Array<Record<string, unknown>> }) {
  const [search, setSearch] = useState("");
  const filtered = venues?.filter(venue => `${venue.name || ""} ${venue.city || ""} ${venue.state || ""}`.toLowerCase().includes(search.trim().toLowerCase()));

  return <section className="venue-subscriptions" aria-label="Venue subscriptions">
    <div className="subscription-summary">
      <article><span>Venue billing model</span><strong>Subscription only</strong><p>Club Deals, guest passes, and verified admissions are included with the venue subscription.</p></article>
      <article><span>Billing records</span><strong>Not connected</strong><p>Subscription price, payment status, renewals, and recurring revenue are unavailable until venue billing records are connected.</p></article>
    </div>
    <div className="subscription-roster">
      <h2>Venue subscription roster</h2>
      <p>Page status shows whether a venue is published on MyDancr. Subscription payment status is not yet available.</p>
      <label>Find a venue<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Venue name or city" /></label>
      {filtered ? <><small>{filtered.length} venues listed</small><ul>{filtered.map(venue => <li key={String(venue.id)}>
        <div><strong>{String(venue.name || "Venue")}</strong><span>{[venue.city, venue.state].filter(Boolean).join(", ")}</span></div>
        <span>Page: {venue.is_active === true ? "Published" : venue.is_active === false ? "Unpublished" : "Unavailable"}</span>
        <span>Subscription only</span><span>Payment status unavailable</span>
      </li>)}</ul>{!filtered.length ? <p>{venues?.length ? "No venues match your search." : "No venues are available in this roster yet."}</p> : null}</> : <p role="status">Venue roster unavailable. Refresh to try again.</p>}
    </div>
    <style>{`
      .venue-subscriptions{display:grid;gap:18px}.subscription-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
      .subscription-summary article,.subscription-roster{padding:22px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:#111018}
      .subscription-summary article>span{font-size:12px;color:#bcb1d0}.subscription-summary strong{display:block;margin-top:8px;font-size:23px;color:#fff}
      .venue-subscriptions p,.subscription-roster li>span{color:#bcb1d0;line-height:1.5}.subscription-roster h2{margin-top:0}
      .subscription-roster label{display:grid;gap:8px;margin:18px 0}.subscription-roster input{box-sizing:border-box;width:100%;padding:12px;background:#191623;color:white;border:1px solid #53475e;border-radius:10px;font:inherit}
      .subscription-roster ul{list-style:none;padding:0}.subscription-roster li{display:grid;grid-template-columns:minmax(0,1.3fr) repeat(3,minmax(0,1fr));gap:14px;padding:18px 0;border-top:1px solid #332c40;align-items:center;overflow-wrap:anywhere}
      .subscription-roster li div{display:grid;gap:6px}.subscription-roster li div span,.subscription-roster small{color:#a79ab8;font-size:13px}
      @media(max-width:680px){.subscription-summary{grid-template-columns:1fr}.subscription-roster li{grid-template-columns:1fr}.subscription-roster,.subscription-summary article{padding:18px}}
    `}</style>
  </section>;
}
