"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import RefreshButton from "../components/RefreshButton";
import { requestDashboardJson } from "./dashboard-session";
import type { VenueCampaign } from "@/src/lib/dancr/venue-campaign-content";
import "./venue-campaigns.css";

type CampaignState = { venueName: string; channels: { in_app: boolean; email: boolean; push: boolean }; counts: { in_app: number }; history: VenueCampaign[] };
export default function VenueCampaignComposer({ active, refreshKey }: { active: boolean; refreshKey: string }) {
  const [open, setOpen] = useState(false), [state, setState] = useState<CampaignState | null>(null);
  const [subject, setSubject] = useState(""), [body, setBody] = useState("");
  const [preview, setPreview] = useState<{ campaign: VenueCampaign; preview: string } | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const sending = useRef(false), draftId = useRef(""), controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const load = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request; setLoading(true);
    try {
      const data = await requestDashboardJson("/api/venue/campaigns", { expectedRole: "venue", signal: request.signal, timeoutMs: 15000, cache: "no-store" }) as CampaignState;
      if (!request.signal.aborted && alive.current) { setState(data); setError(""); }
    } catch (reason) {
      if (!request.signal.aborted && alive.current) { setState(null); setError(reason instanceof Error ? reason.message : "Unable to load club updates."); }
    } finally { if (!request.signal.aborted && alive.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (active && open) void load();
    return () => controller.current?.abort();
  }, [active, open, refreshKey, load]);

  function edit() { draftId.current = ""; setPreview(null); setNotice(""); setError(""); }
  async function action(kind: "preview" | "send" | "cancel", id?: string) {
    if (sending.current || !active) return;
    sending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (!draftId.current) draftId.current = crypto.randomUUID();
      const data = await requestDashboardJson("/api/venue/campaigns", { method: "POST", expectedRole: "venue", timeoutMs: 20000,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: kind, id: id || preview?.campaign.id || draftId.current,
          ...(kind === "preview" ? { channel: "in_app", subject, body } : {}) }) }) as { campaign: VenueCampaign; preview: string };
      if (!alive.current) return;
      if (kind === "send" && data.campaign.status !== "published") throw new Error("This offer was not published. Edit the message and preview it again.");
      if (kind === "cancel" && data.campaign.status !== "cancelled") throw new Error("The offer withdrawal was not confirmed. Please retry.");
      if (kind === "preview") setPreview(data);
      else {
        if (kind === "send") { setPreview(null); setSubject(""); setBody(""); draftId.current = ""; }
        setNotice(kind === "send" ? `Offer added to ${data.campaign.published_count} customer Alerts. Optional delivery follows each customer's preferences.` : "Offer withdrawn from Alerts. Notifications already sent cannot be recalled.");
        await load();
      }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "Unable to save this update. Retry using the same message."); }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  const ready = Boolean(state?.channels.in_app);
  const recipients = state?.counts.in_app || 0;
  return <section className="venue-campaigns" aria-label="Club offers">
    <button type="button" className="venue-campaign-toggle" aria-expanded={open} aria-controls="venue-campaign-composer" disabled={busy} onClick={() => setOpen(value => !value)}>{open ? "Close club offers" : "+ Create club offer"}</button>
    {open && <div id="venue-campaign-composer" className="venue-campaign-content">
      <header className="venue-section-heading"><h3>Publish an offer</h3><RefreshButton label="Refresh offers" type="button" busy={loading} disabled={busy || loading} onClick={() => void load()} /></header>
      <p>Share news, events or offers in Alerts with MyDancr customers who follow {state?.venueName || "this club"} or subscribe to its updates.</p>
      <p>Customers control push and email. MyDancr combines offers from all clubs into one daily email summary for customers who allow offer emails. Up to 3 offers per club each day.</p>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      {!state && loading && <p role="status">Loading subscribers…</p>}
      {state && !preview && <form onSubmit={event => { event.preventDefault(); void action("preview"); }}>
        <p className="venue-campaign-note"><strong>{recipients} eligible {recipients === 1 ? "customer" : "customers"}</strong>. Muted club alerts are excluded. Guest contacts need a matching verified MyDancr account to receive in-app offers.</p>
        {(!state.channels.email || !state.channels.push) && <p role="status">Alerts are available. {!state.channels.email ? "Email summaries are temporarily unavailable. " : ""}{!state.channels.push ? "Push delivery is temporarily unavailable." : ""}</p>}
        <label>Offer title<input value={subject} maxLength={120} required disabled={busy} onChange={event => { edit(); setSubject(event.target.value); }} /></label>
        <label>Message<textarea value={body} maxLength={5000} rows={5} required disabled={busy} aria-describedby="venue-campaign-message-help" onChange={event => { edit(); setBody(event.target.value); }} placeholder="Write your club update…" /></label>
        <p id="venue-campaign-message-help" className="venue-campaign-note">{body.length.toLocaleString()} characters used · 5,000 maximum. Short messages are welcome.</p>
        <button type="submit" aria-describedby={!recipients ? "venue-campaign-audience-help" : undefined} disabled={busy || !ready || !recipients || !subject.trim() || !body.trim()}>{busy ? "Preparing preview…" : "Preview offer"}</button>
        {!recipients && <p id="venue-campaign-audience-help" className="venue-campaign-note">Preview is unavailable because this club has no eligible recipients yet. At least one eligible customer must follow the club or subscribe to its updates.</p>}
      </form>}
      {preview && <section className="venue-campaign-preview" aria-label="Message preview">
        <h4>Review before publishing</h4>
        <p>Up to <strong>{preview.campaign.recipient_count} customers</strong> will receive this in Alerts. Anyone who opts out before publishing is skipped.</p>
        <strong>{preview.campaign.sender_name}: {preview.campaign.subject}</strong>
        <div className="venue-campaign-message">{preview.preview}</div>
        <div className="venue-campaign-actions"><button type="button" disabled={busy} onClick={edit}>Edit message</button>
          <button type="button" className="venue-campaign-send" disabled={busy || preview.campaign.status !== "draft"} onClick={() => void action("send")}>{busy ? "Publishing…" : `Publish to ${preview.campaign.recipient_count} customer Alerts`}</button></div>
      </section>}
      {state && state.history.length > 0 && <section className="venue-campaign-history" aria-label="Recent club updates"><h4>Recent updates</h4>
        <p className="venue-campaign-note">Published counts show offers added to Alerts, not email delivery or views.</p>
        {state.history.map(item => <article key={item.id}>
          <header><strong>{item.subject}</strong><span>{item.status === "published" ? "Published" : "Withdrawn"}</span></header>
          <small>{new Date(item.queued_at || item.created_at).toLocaleString()}</small>
          <p>{item.published_count} added to Alerts · {item.skipped_count} skipped</p>
          <details><summary>View message</summary><div className="venue-campaign-message">{item.body}</div></details>
          {item.status === "published" && <button type="button" disabled={busy} onClick={() => void action("cancel", item.id)}>Withdraw offer</button>}
        </article>)}
      </section>}
    </div>}
  </section>;
}
