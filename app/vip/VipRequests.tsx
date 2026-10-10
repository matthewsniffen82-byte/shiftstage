"use client";
import { useState } from "react";
import { formatVipDate, type VipRequest } from "@/src/lib/dancr/vip-types";
import { vipCalendar } from "@/src/lib/dancr/vip-calendar";

type RequestActions = {
  busy?: boolean; venueName?: string; featured?: boolean;
  onReview?: (request: VipRequest, status: string, note: string) => Promise<void>;
  onRepeat?: (request: VipRequest) => void;
  onWithdraw?: (request: VipRequest) => Promise<boolean>;
};
export default function VipRequests({ requests, ...actions }: RequestActions & { requests: VipRequest[] }) {
  return <div className="vip-request-list">{requests.length ? requests.map(request =>
    <RequestCard key={request.id} request={request} {...actions} />
  ) : <p className="vip-empty">{actions.onReview ? "No visit requests yet." : "No requests yet. Your requests and venue responses will appear here."}</p>}</div>;
}
function RequestCard({ request, onReview, busy = false, venueName, featured, onRepeat, onWithdraw }: { request: VipRequest } & RequestActions) {
  const [note, setNote] = useState("");
  const [confirmWithdrawal, setConfirmWithdrawal] = useState(false);
  return <article className={`vip-request${featured ? " vip-request-featured" : ""}`}>
    <div className="vip-row"><strong>{onReview ? request.nickname || request.guest_name : featured ? "Your night is confirmed" : "Your visit"}</strong><span className={`vip-badge vip-status-${request.status}`}>{request.status}</span></div>
    {onReview && request.nickname && <small>Guest: {request.guest_name}</small>}
    <p className="vip-request-time"><time dateTime={request.starts_at}>{featured ? <><span>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: request.timezone }).format(new Date(request.starts_at))}</span><strong>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: request.timezone }).format(new Date(request.starts_at))}</strong></> : formatVipDate(request.starts_at, request.timezone)}</time><small>{request.timezone.replaceAll("_", " ")}</small></p>
    <p><strong>Requested dancers</strong><br />{request.dancers.map(dancer => dancer.stageName).join(", ")}</p>
    {request.notes && <p className="vip-note">{request.notes}</p>}
    {request.response_note && <p className="vip-note"><strong>Venue response</strong><br />{request.response_note}</p>}
    {request.status === "pending" && !onReview && <small>Awaiting venue review. Dancer availability is subject to confirmation.</small>}
    {!onReview && <div className="vip-request-actions">
      {request.status === "confirmed" && venueName && <a className="vip-link-action" download={`mydancr-visit-${request.id}.ics`} href={`data:text/calendar;charset=utf-8,${encodeURIComponent(vipCalendar(request, venueName))}`}>Add to calendar <span aria-hidden="true">↗</span></a>}
      {onRepeat && <button type="button" disabled={busy} onClick={() => onRepeat(request)}>Request these dancers again</button>}
      {request.status === "pending" && onWithdraw && !confirmWithdrawal && <button type="button" disabled={busy} onClick={() => setConfirmWithdrawal(true)}>Withdraw request</button>}
    </div>}
    {request.status === "pending" && onWithdraw && confirmWithdrawal && <div className="vip-withdraw-confirm" role="group" aria-label="Confirm withdrawal"><p>Withdraw this pending request? Your venue will be notified.</p><div className="vip-actions"><button type="button" disabled={busy} onClick={async () => { if (await onWithdraw(request)) setConfirmWithdrawal(false); }}>{busy ? "Withdrawing…" : "Yes, withdraw"}</button><button type="button" disabled={busy} onClick={() => setConfirmWithdrawal(false)}>Keep request</button></div></div>}
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
