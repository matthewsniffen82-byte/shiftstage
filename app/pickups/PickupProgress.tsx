import { PICKUP_STATUS_LABELS, pickupClosed, type PickupRequest, type PickupStatus } from "@/src/lib/dancr/pickup-domain";

const guidance: Record<PickupStatus, string> = {
  requested: "Waiting for the venue to confirm pickup.",
  accepted: "Pickup accepted. Confirm the meeting spot in chat.",
  vehicle_dispatched: "The venue marked the vehicle as on the way.",
  arriving: "The venue marked the vehicle as arriving. Check chat for the meeting spot.",
  arrived: "Arrival reported. Check chat for any final details.",
  completed: "Pickup completed. Your chat history is available below.",
  cancelled: "This pickup was cancelled. Your chat history is available below.",
  no_show: "The venue marked this pickup as a no-show.",
  expired: "The pickup window has ended. This conversation is closed.",
};

export default function PickupProgress({ request }: { request: PickupRequest }) {
  const status = !pickupClosed(request.status) && Date.parse(request.expires_at) <= Date.now() ? "expired" : request.status;
  const position = ({ requested: 0, accepted: 1, vehicle_dispatched: 2, arriving: 2, arrived: 3, completed: 3 } as Partial<Record<PickupStatus, number>>)[status];
  const tone = ["cancelled", "no_show", "expired"].includes(status) ? "closed" : ["arrived", "completed"].includes(status) ? "success" : "active";
  return <section className="pickup-progress" data-tone={tone} aria-label="Pickup progress">
    <div role="status"><p className="pickup-status">{PICKUP_STATUS_LABELS[status]}</p><p className="pickup-progress-guidance">{guidance[status]}</p></div>
    {position !== undefined && <ol>
      {["Requested", "Accepted", "On the way", status === "completed" ? "Completed" : "Arrived"].map((label, index) => {
        const skipped = index === 2 && position > 2 && !request.vehicle_dispatched_at;
        const state = skipped ? "skipped" : index < position || status === "completed" ? "done" : index === position ? "current" : "next";
        return <li key={index} data-state={state} aria-current={index === position ? "step" : undefined}>
          <span className="pickup-progress-marker" aria-hidden="true">{state === "done" ? "✓" : skipped ? "–" : index + 1}</span>
          <span>{label}</span><span className="pickup-visually-hidden">{skipped ? ": no dispatch update recorded" : state === "done" ? ": reached" : state === "next" ? ": upcoming" : ": current"}</span>
        </li>;
      })}
    </ol>}
  </section>;
}
