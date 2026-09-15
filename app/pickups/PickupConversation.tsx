"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { readBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { PICKUP_CHAT_NOTICE, PICKUP_CHAT_POLICY, PICKUP_CONSENT_VERSION, PICKUP_STATUS_LABELS, PICKUP_TRANSPORT_NOTICE,
  pickupClosed, pickupStatusActions, type PickupDetail, type PickupMessage, type PickupStatus } from "@/src/lib/dancr/pickup-domain";
import { PickupAccountGate, requestPickupJson } from "./pickup-session";

export default function PickupConversation({ requestId }: { requestId: string }) {
  return <PickupAccountGate>{() => <Conversation requestId={requestId} />}</PickupAccountGate>;
}
function mergeMessages(previous: PickupMessage[], incoming: PickupMessage[]) {
  return [...new Map([...previous, ...incoming].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence);
}
export function pickupTime(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function Conversation({ requestId }: { requestId: string }) {
  const [detail, setDetail] = useState<PickupDetail | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [text, setText] = useState(""), [connected, setConnected] = useState(false), [reportOpen, setReportOpen] = useState(false), [notice, setNotice] = useState("");
  const [statusChoice, setStatusChoice] = useState<PickupStatus | "">(""), [reason, setReason] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null), nearBottom = useRef(true), locked = useRef(false), mounted = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {}), retry = useRef<{ id: string; text: string } | null>(null);
  const latestRead = useRef(0), olderLoaded = useRef(false);
  const path = `/api/pickups/${requestId}`;
  useEffect(() => {
    mounted.current = true;
    let cancelled = false, fetching = false, queued = false, controller: AbortController | null = null;
    const refresh = async () => {
      if (cancelled) return;
      if (fetching) { queued = true; return; }
      fetching = true; controller = new AbortController();
      try {
        const next: PickupDetail = await requestPickupJson(path, { signal: controller.signal });
        if (!cancelled) {
          setDetail(previous => {
            // A long disconnect can span more than one page. Start from the latest
            // contiguous page in that case so Load older can recover every message.
            const gap = Boolean(previous?.messages.length && next.hasOlderMessages &&
              !next.messages.some(message => previous.messages.some(old => old.id === message.id)));
            if (gap) olderLoaded.current = false;
            return { ...next, messages: next.consented ? mergeMessages(gap ? [] : previous?.messages || [], next.messages) : [],
              hasOlderMessages: olderLoaded.current ? previous?.hasOlderMessages || false : next.hasOlderMessages };
          });
          setError("");
        }
      } catch (failure) {
        if (!cancelled) {
          const status = (failure as { status?: number })?.status;
          if (status === 401 || status === 403 || status === 404) setDetail(null);
          setError(failure instanceof Error ? failure.message : "Unable to refresh pickup conversation.");
        }
      } finally { fetching = false; if (!cancelled && queued) { queued = false; void refresh(); } }
    };
    refreshRef.current = refresh; void refresh();
    const resume = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", resume); document.addEventListener("visibilitychange", resume);
    const timer = window.setInterval(resume, 15000);
    return () => { cancelled = true; mounted.current = false; controller?.abort(); window.clearInterval(timer); window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, [path]);
  const consented = detail?.consented === true;
  useEffect(() => {
    if (!consented) return;
    let cancelled = false, subscription: Awaited<ReturnType<typeof import("@/src/lib/dancr/pickup-realtime").subscribePickup>> | null = null;
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    const reconcile = () => { clearTimeout(changeTimer); changeTimer = setTimeout(() => { if (!cancelled && document.visibilityState === "visible") void refreshRef.current(); }, 100); };
    const syncToken = () => { const token = readBrowserAuthSession()?.accessToken; if (token && subscription) void subscription.setToken(token).catch(() => { if (!cancelled) setConnected(false); }); };
    void import("@/src/lib/dancr/pickup-realtime").then(async ({ subscribePickup }) => {
      const token = readBrowserAuthSession()?.accessToken;
      if (cancelled || !token) return;
      const result = await subscribePickup(requestId, token, reconcile, state => { if (!cancelled) setConnected(state); });
      if (cancelled) await result.close(); else subscription = result;
    }).catch(() => { if (!cancelled) setConnected(false); });
    const timer = window.setInterval(syncToken, 15000);
    return () => { cancelled = true; clearTimeout(changeTimer); window.clearInterval(timer); void subscription?.close(); };
  }, [requestId, consented]);
  const lastSequence = detail?.messages.at(-1)?.sequence || 0;
  useEffect(() => {
    if (!consented) return;
    const node = messagesRef.current;
    if (!node) return;
    if (nearBottom.current) node.scrollTop = node.scrollHeight;
    const markViewed = () => {
      const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
      if (atBottom && lastSequence > latestRead.current && detail?.role !== "admin" && document.visibilityState === "visible") {
        latestRead.current = lastSequence;
        void requestPickupJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "read", sequence: lastSequence }) }).catch(() => { latestRead.current = 0; });
      }
    };
    markViewed(); node.addEventListener("scroll", markViewed, { passive: true }); document.addEventListener("visibilitychange", markViewed);
    return () => { node.removeEventListener("scroll", markViewed); document.removeEventListener("visibilitychange", markViewed); };
  }, [lastSequence, consented, path, detail?.role]);
  async function act(body: Record<string, unknown>) {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await requestPickupJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!mounted.current) return false;
      await refreshRef.current(); return true;
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Action failed. Check the conversation before retrying."); return false; }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault(); if (!text.trim() || locked.current) return;
    if (!retry.current || retry.current.text !== text) retry.current = { id: crypto.randomUUID(), text };
    nearBottom.current = true;
    if (await act({ action: "message", messageId: retry.current.id, text })) { setText(""); retry.current = null; }
  }
  async function loadOlder() {
    if (!detail || locked.current) return;
    locked.current = true; setBusy(true);
    const node = messagesRef.current, height = node?.scrollHeight || 0, top = node?.scrollTop || 0;
    try {
      const next: PickupDetail = await requestPickupJson(`${path}?before=${detail.messages[0]?.sequence || 0}`);
      if (!mounted.current) return;
      olderLoaded.current = true; nearBottom.current = false;
      setDetail(current => current ? { ...current, messages: mergeMessages(next.messages, current.messages), hasOlderMessages: next.hasOlderMessages } : current);
      requestAnimationFrame(() => { if (node) node.scrollTop = top + node.scrollHeight - height; });
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Unable to load older messages."); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  if (!detail) return <section className="pickup-card"><Link href="/pickups">‹ Pickup requests</Link><h1>Club Pickup</h1>{error ? <><p role="alert">{error}</p><button onClick={() => void refreshRef.current()}>Retry</button></> : <p role="status">Loading your conversation…</p>}</section>;
  const r = detail.request, closed = pickupClosed(r.status) || Date.parse(r.expires_at) <= Date.now();
  const venueName = r.venue?.name || "Venue";
  return <section className="pickup-card pickup-conversation">
    <header><Link href="/pickups">‹ Pickup requests</Link><h1>{venueName}</h1><p className="pickup-status">{PICKUP_STATUS_LABELS[r.status]}</p>
      <p className="pickup-subtle">{closed ? "Conversation closed · history remains available" : connected ? "Live conversation" : "Reconnecting · checking for updates"}</p>
    </header>
    <details className="pickup-details"><summary>Pickup details · {r.party_size} {r.party_size === 1 ? "guest" : "guests"}</summary>
      <p>{r.pickup_location_text}</p>{r.pickup_location_details && <p>{r.pickup_location_details}</p>}{r.customer_notes && <p>{r.customer_notes}</p>}
      <p>Requested {pickupTime(r.requested_at)} · Expires {pickupTime(r.expires_at)}</p><p>{PICKUP_TRANSPORT_NOTICE}</p>
      {r.cancellation_reason && <p>Cancellation reason: {r.cancellation_reason}</p>}
    </details>
    {detail.consented && detail.role !== "admin" && <section className="pickup-notice">
      <p>{r.referral_outcome === "arrival_verified" ? "Arrival verified by venue NFC deal redemption." : r.referral_outcome === "arrival_disputed" ? "The linked redemption was reversed. Arrival attribution is under review." : "Arrival confirmations are recorded separately from verified venue NFC deal redemption."}</p>
      {r.venue?.slug && <Link href={`/?venue=${encodeURIComponent(r.venue.slug)}`}>Open venue page &amp; Club Deals</Link>}
      {["arrived", "completed"].includes(r.status) && !detail.evidence.some(e => e.source === `${detail.role}_confirmation`) &&
        <button disabled={busy} onClick={() => void act({ action: "confirm_arrival" })}>{detail.role === "customer" ? "Confirm I arrived" : "Confirm customer arrived"}</button>}
    </section>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!detail.consented ? <section className="pickup-notice"><h2>MyDancr Pickup Chat</h2><p>{PICKUP_CHAT_NOTICE}</p><p>{PICKUP_CHAT_POLICY}</p>
      <button className="pickup-primary" disabled={busy} onClick={() => void act({ action: "consent", version: PICKUP_CONSENT_VERSION })}>Agree &amp; Continue</button></section> : <>
      <div className="pickup-messages" ref={messagesRef} aria-label="Pickup messages" onScroll={() => { const node = messagesRef.current; if (node) nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
        {detail.hasOlderMessages && <button disabled={busy} onClick={() => void loadOlder()}>Load older messages</button>}
        {detail.messages.map(message => <article key={message.id} className={`pickup-message pickup-message-${message.sender_type}`}>
          <strong>{message.sender_type === "system" ? "Pickup update" : message.sender_type === "venue" ? venueName : detail.role === "customer" ? "You" : "Customer"}</strong>
          <p>{message.message_text}</p><time dateTime={message.created_at}>{pickupTime(message.created_at)}</time>
        </article>)}
      </div>
      {!closed && detail.role !== "admin" && <form className="pickup-composer" onSubmit={send}>
        <label htmlFor="pickup-message">Message {detail.role === "customer" ? venueName : "customer"}</label>
        <textarea id="pickup-message" maxLength={2000} rows={2} value={text} onChange={event => setText(event.target.value)} disabled={busy} required />
        <button className="pickup-primary" type="submit" disabled={busy || !text.trim()}>{busy ? "Sending…" : "Send message"}</button>
      </form>}
      {!closed && detail.role !== "admin" && <section className="pickup-actions"><h2>Update pickup</h2>
        <label>Status<select aria-label="Status" value={statusChoice} disabled={busy} onChange={event => setStatusChoice(event.target.value as PickupStatus | "")}>
          <option value="">Choose an action</option>{pickupStatusActions(detail.role, r.status).map(status => <option key={status} value={status}>
            {status === "cancelled" ? (detail.role === "venue" && r.status === "requested" ? "Decline request" : "Cancel request") : status === "arrived" ? (detail.role === "customer" ? "I have arrived" : "Confirm customer arrived") : PICKUP_STATUS_LABELS[status]}</option>)}
        </select></label>
        {statusChoice === "cancelled" && <label>Reason<input required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>}
        <button disabled={busy || !statusChoice || (statusChoice === "cancelled" && reason.trim().length < 3)} onClick={async () => {
          if (await act({ action: "status", status: statusChoice, expectedStatus: r.status, reason })) { setStatusChoice(""); setReason(""); }
        }}>Confirm update</button>
      </section>}
      <details className="pickup-details"><summary>Chat notice &amp; policies</summary><p>{PICKUP_CHAT_NOTICE}</p><p>{PICKUP_CHAT_POLICY}</p><p>For immediate danger, contact emergency services. This chat is not an emergency service.</p></details>
    </>}
    {detail.role !== "admin" && <section className="pickup-report"><button onClick={() => setReportOpen(!reportOpen)} aria-expanded={reportOpen}>Report Conversation</button>
      {reportOpen && <form className="pickup-form" onSubmit={async event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        if (await act({ action: "report", reason: data.get("reason"), details: data.get("details") })) { setReportOpen(false); setNotice("Your report was sent to MyDancr for review."); }
      }}><label>Reason<select name="reason"><option value="harassment">Harassment</option><option value="threats">Threats</option><option value="sexual_services">Sexual-service arrangements</option><option value="illegal_drugs">Illegal drugs</option><option value="private_information">Private dancer information</option><option value="other">Other</option></select></label>
        <label>Details <small>(optional)</small><textarea name="details" maxLength={1000} rows={3} /></label><button disabled={busy} type="submit">Send report</button></form>}
    </section>}
    {detail.role === "admin" && <PickupAudit detail={detail} path={path} act={act} busy={busy} />}
  </section>;
}
function PickupAudit({ detail, path, act, busy }: { detail: PickupDetail; path: string; act: (body: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const [older, setOlder] = useState<PickupDetail["events"]>([]), [hasMore, setHasMore] = useState(detail.hasMoreEvents), [loading, setLoading] = useState(false), [error, setError] = useState("");
  return <section className="pickup-audit"><h2>Admin audit</h2><p>Customer: {detail.request.customer_user_id}<br />Venue: {detail.request.venue_id}<br />Request: {detail.request.id}</p>
    <p>Referral source: {detail.request.referral_source} · Outcome: {detail.request.referral_outcome}</p>
    <h3>Arrival evidence</h3>{detail.evidence.length ? detail.evidence.map(e => <p key={e.id}>{e.source} · {pickupTime(e.created_at)}{e.redemption_id && <> · Redemption {e.redemption_id}</>}</p>) : <p>No arrival evidence recorded.</p>}
    <h3>Reports</h3>{detail.reports.length ? detail.reports.map(report => <article key={report.id}><strong>{report.reason}</strong><p>{report.details}</p><p>{report.reporter_user_id} · {pickupTime(report.created_at)}</p></article>) : <p>No conversation reports.</p>}
    <h3>Event history</h3>{[...new Map([...detail.events, ...older].map(e => [e.id, e])).values()].map(event => <article key={event.id}><strong>{event.event_type}</strong><p>{pickupTime(event.created_at)} · {event.actor_user_id || "System"}</p><pre>{JSON.stringify(event.metadata, null, 2)}</pre></article>)}
    {hasMore && <button disabled={loading} onClick={async () => { setLoading(true); setError(""); try {
      const next: PickupDetail = await requestPickupJson(`${path}?eventOffset=${detail.events.length + older.length}`); setOlder(current => [...current, ...next.events]); setHasMore(next.hasMoreEvents);
    } catch { setError("Unable to load older audit events."); } finally { setLoading(false); } }}>Load older events</button>}
    {error && <p role="alert">{error}</p>}
    <form className="pickup-form" onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (await act({ action: "admin_note", note: data.get("note") })) form.reset(); }}>
      <label>Append an admin audit note<textarea name="note" minLength={3} maxLength={1000} rows={3} required /></label><p className="pickup-subtle">Notes are recorded separately. Original messages and history cannot be edited.</p><button disabled={busy}>Record audit note</button>
    </form>
  </section>;
}
