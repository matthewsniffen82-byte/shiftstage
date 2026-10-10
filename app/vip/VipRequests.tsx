"use client";
import { useState } from "react";
import { formatVipDate, type VipRequest } from "@/src/lib/dancr/vip-types";

export default function VipRequests({ requests, onReview, busy = false }: {
  requests: VipRequest[]; busy?: boolean;
  onReview?: (request: VipRequest, status: string, note: string) => Promise<void>;
}) {
  return <div className="vip-request-list">{requests.length ? requests.map(request =>
    <RequestCard key={request.id} request={request} onReview={onReview} busy={busy} />
  ) : <p className="vip-empty">{onReview ? "No visit requests yet." : "No requests yet. Your requests and venue responses will appear here."}</p>}</div>;
}
function RequestCard({ request, onReview, busy }: { request: VipRequest; busy: boolean; onReview?: (request: VipRequest, status: string, note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  return <article className="vip-request">
    <div className="vip-row"><strong>{onReview ? request.nickname || request.guest_name : "Your visit"}</strong><span className={`vip-badge vip-status-${request.status}`}>{request.status}</span></div>
    {onReview && request.nickname && <small>Guest: {request.guest_name}</small>}
    <p className="vip-request-time"><time dateTime={request.starts_at}>{formatVipDate(request.starts_at, request.timezone)}</time><small>{request.timezone.replaceAll("_", " ")}</small></p>
    <p><strong>Requested dancers</strong><br />{request.dancers.map(dancer => dancer.stageName).join(", ")}</p>
    {request.notes && <p className="vip-note">{request.notes}</p>}
    {request.response_note && <p className="vip-note"><strong>Venue response</strong><br />{request.response_note}</p>}
    {request.status === "pending" && !onReview && <small>Awaiting venue review. Dancer availability is subject to confirmation.</small>}
    {onReview && ["pending", "confirmed"].includes(request.status) && <div className="vip-review">
      <label>Message to VIP (optional)<textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} disabled={busy} rows={2} /></label>
      {request.status === "pending" && <small>Check dancer availability before confirming.</small>}
      <div className="vip-actions">{request.status === "pending" ? <>
        <button type="button" className="vip-primary" disabled={busy} onClick={() => void onReview(request, "confirmed", note)}>Confirm request</button>
        <button type="button" disabled={busy} onClick={() => void onReview(request, "declined", note)}>Decline</button>
      </> : <button type="button" disabled={busy} onClick={() => void onReview(request, "cancelled", note)}>Cancel confirmed request</button>}</div>
    </div>}
  </article>;
}
