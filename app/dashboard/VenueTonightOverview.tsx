"use client";
import type { MouseEvent } from "react";
import type { VenueOperations } from "@/src/lib/dancr/venue-operations";

export default function VenueTonightOverview({ operations, error, working, manager, published, reviewReady, onOpen }: {
  operations: VenueOperations | null; error: string; working: number | null; manager: boolean; published: boolean; reviewReady: boolean;
  onOpen: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const queues = [
    { label: "Table requests", id: "table-requests", attentionCount: operations?.tablePending },
    { label: "Guest list", id: "venue-guest-list", attentionCount: operations?.guestExpected },
    ...(manager ? [
      { label: "VIP requests", id: "venue-vip", attentionCount: operations?.vipPending },
      { label: "Ride requests", id: "venue-pickups", attentionCount: operations?.ridesOpen },
    ] : []),
  ];
  const pending = queues.filter(queue => Number(queue.attentionCount) > 0);
  const needsReview = !published && manager;
  return <section className="venue-tonight-overview" aria-labelledby="venue-tonight-heading">
    <div className="venue-tonight-summary">
      <h2 id="venue-tonight-heading">Tonight</h2>
      <a className={working ? "is-live" : undefined} href="#venue-working-now" onClick={event => onOpen(event, "venue-working-now")}><strong>{working ?? "—"}</strong> working now</a>
      <span><strong>{operations?.admitted ?? "—"}</strong> admitted today</span>
    </div>
    {error && <p role="status">{error}</p>}
    {(pending.length > 0 || needsReview) && <div className="venue-attention"><h3>Needs attention</h3>
      {pending.map(queue => <a key={queue.id} href={`#${queue.id}`} onClick={event => onOpen(event, queue.id)}><span>{queue.attentionCount} {queue.id === "venue-guest-list" ? "awaiting admission" : queue.label.toLowerCase()}</span><strong>Review →</strong></a>)}
      {!published && manager && <a href="#venue-publication" onClick={event => onOpen(event, "venue-publication")}><span>{reviewReady ? "Your club page is ready to approve" : "Your club page is not live"}</span><strong>View status →</strong></a>}
    </div>}
  </section>;
}
