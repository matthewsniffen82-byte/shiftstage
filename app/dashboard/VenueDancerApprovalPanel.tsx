"use client";

import { useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";

type JoinRequest = { dancerId: string; stageName: string; city: string; status: "pending" | "rejected"; requestedAt: string; revision: string; expired: boolean; avatarUrl: string | null };

export default function VenueDancerApprovalPanel({ active, refreshKey }: { active: boolean; refreshKey?: string | null }) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const action = useRef<AbortController | null>(null);
  useEffect(() => () => action.current?.abort(), []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    requestDashboardJson(`/api/venue/dancer-approvals?offset=${offset}`, { expectedRole: "venue", cache: "no-store", signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setRequests(data.requests); setHasMore(data.hasMore); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load requests."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, refresh, active, refreshKey]);

  async function review(request: JoinRequest, decision: "approved" | "rejected") {
    if (action.current || loading) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(request.dancerId); setMessage(""); setError("");
    try {
      await requestDashboardJson("/api/venue/dancer-approvals", { method: "POST", expectedRole: "venue", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ dancerId: request.dancerId, revision: request.revision, decision }) });
      if (controller.signal.aborted) return;
      setMessage(decision === "approved" ? `${request.stageName} is approved for this club. They must tap again to check in. Review their media separately.` : `${request.stageName}'s request was declined for this club.`);
      setRefresh(value => value + 1);
    } catch (reason) {
      if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Unable to save the decision."); setRefresh(value => value + 1); }
    } finally { if (!controller.signal.aborted) { action.current = null; setBusy(""); } }
  }

  return <section className="club-join-requests" aria-labelledby="club-join-title" aria-busy={loading || Boolean(busy)}>
    <header><h2 id="club-join-title">Dancer approval requests</h2><button type="button" disabled={loading || Boolean(busy)} onClick={() => { setError(""); setRefresh(value => value + 1); }}>Refresh</button></header>
    <p>A dancer’s first tap requests access to this club. Approve them here, then they tap again to check in. Photos and videos need separate approval in Media approvals.</p>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading requests…</p> : !requests.length && !error ? <p>No requests on this page.</p> : null}
    {requests.map(request => <article key={request.dancerId}>
      {/* Private, short-lived preview for the authorized club reviewer. */}
      {request.avatarUrl ? <img src={request.avatarUrl} alt={`${request.stageName} profile photo`} width={64} height={80} /> : null}
      <div><strong>{request.stageName}</strong><p>{request.city}</p><small>{request.expired ? "Request expired — dancer must tap again" : request.status === "rejected" ? "Declined — you can reconsider" : "Awaiting club approval"}</small></div>
      <div className="club-join-actions"><button type="button" disabled={loading || Boolean(busy) || request.expired} onClick={() => review(request, "approved")}>Approve {request.stageName}</button>
        {request.status === "pending" ? <button type="button" disabled={loading || Boolean(busy) || request.expired} onClick={() => review(request, "rejected")}>Decline {request.stageName}</button> : null}</div>
    </article>)}
    {offset > 0 || hasMore ? <nav aria-label="Approval request pages"><button type="button" disabled={!offset || loading || Boolean(busy)} onClick={() => setOffset(value => Math.max(0, value - 25))}>Previous</button><button type="button" disabled={!hasMore || loading || Boolean(busy)} onClick={() => setOffset(value => value + 25)}>Next</button></nav> : null}
    <style>{`.club-join-requests{margin:12px 0;padding:16px;border:1px solid var(--dancr-color-border);border-radius:14px}.club-join-requests header{display:flex;align-items:center;justify-content:space-between;gap:12px}.club-join-requests h2{font-size:18px}.club-join-requests p{font-size:13px;line-height:1.5}.club-join-requests article{display:flex;align-items:center;gap:12px;padding:14px 0;border-top:1px solid var(--dancr-color-border);flex-wrap:wrap}.club-join-requests img{object-fit:cover;border-radius:10px}.club-join-requests article p{margin:4px 0}.club-join-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}.club-join-requests button{min-height:44px;max-width:100%;padding:8px 12px;border:1px solid var(--dancr-color-border);border-radius:9px;background:var(--dancr-color-surface-card);color:inherit;font:inherit;cursor:pointer}.club-join-requests button:disabled{opacity:.5;cursor:default}.club-join-requests nav{display:flex;gap:8px}@media(max-width:600px){.club-join-actions{width:100%;margin-left:0}}`}</style>
  </section>;
}
