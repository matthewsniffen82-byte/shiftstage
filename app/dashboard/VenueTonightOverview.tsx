"use client";
import type { MouseEvent, ReactNode } from "react";
import type { VenueOperations } from "@/src/lib/dancr/venue-operations";

export default function VenueTonightOverview({ operations, error, working, manager, published, reviewReady, onOpen, notificationPrompt }: {
  operations: VenueOperations | null; error: string; working: number | null; manager: boolean; published: boolean; reviewReady: boolean;
  onOpen: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
  notificationPrompt?: ReactNode;
}) {
  const queues = [
    { label: "Working now", count: working, id: "venue-working-now", note: "Checked-in dancers" },
    { label: "Table requests", count: operations?.tablePending, id: "table-requests", note: "Pending · last 6 hours", attention: true },
    { label: "Guest list", count: operations?.guestExpected, id: "venue-guest-list", note: "Valid passes awaiting admission" },
    ...(manager ? [
      { label: "VIP requests", count: operations?.vipPending, id: "venue-vip", note: "Awaiting a response", attention: true },
      { label: "Ride requests", count: operations?.ridesOpen, id: "venue-pickups", note: "Open · last 48 hours", attention: true },
    ] : []),
  ];
  return <section className="venue-tonight-overview" aria-labelledby="venue-tonight-heading">
    {notificationPrompt}
    <div className="venue-section-heading"><h2 id="venue-tonight-heading">Tonight</h2><span>{operations ? `${operations.admitted} verified pass admissions today` : "Live queues"}</span></div>
    <div className="venue-queue-grid">{queues.map(queue => <a key={queue.id} href={`#${queue.id}`} onClick={event => onOpen(event, queue.id)}><span>{queue.label}</span><strong>{queue.count ?? "—"}</strong><small>{queue.note}</small></a>)}</div>
    {error && <p role="status">{error}</p>}
    <div className="venue-attention"><h3>Needs attention</h3>
      {queues.filter(queue => queue.attention && Number(queue.count) > 0).map(queue => <a key={queue.id} href={`#${queue.id}`} onClick={event => onOpen(event, queue.id)}><span>{queue.count} {queue.label.toLowerCase()}</span><strong>Review →</strong></a>)}
      {!published && manager && <a href="#venue-publication" onClick={event => onOpen(event, "venue-publication")}><span>{reviewReady ? "Your club page is ready to approve" : "Your club page is not live"}</span><strong>View status →</strong></a>}
      {operations && !queues.some(queue => queue.attention && Number(queue.count) > 0) && (published || !manager) && <p>No requests waiting for your attention.</p>}
    </div>
  </section>;
}
