"use client";
import RefreshButton from "../components/RefreshButton";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { clubArrivalLabel } from "@/src/lib/dancr/club-deal-transportation";
import { ADMIN_GUEST_SECTIONS, type AdminGuestAction, type AdminGuestData, type AdminGuestRow, type AdminGuestSection } from "@/src/lib/dancr/admin-guest-operations-types";
import { readAdminSession, requestAdminJson } from "./admin-session";
import "./admin-guest-operations.css";

const VenueValueAnalytics = dynamic(() => import("../dashboard/VenueValueAnalytics"));
const labels: Record<AdminGuestSection, string> = { visits: "VIP visits", members: "VIP access", invitations: "Invitations", guests: "Guest list", rides: "Ride requests", updates: "Club updates", results: "Results" };
const filters: Record<AdminGuestSection, string[]> = {
  visits: ["all", "pending", "confirmed", "declined", "cancelled"], members: ["all", "active", "revoked"], invitations: ["all", "pending", "accepted", "revoked", "expired"],
  guests: ["all", "generated", "redeemed", "voided", "expired"], rides: ["all"], updates: ["all", "active", "withdrawn", "email", "text"], results: ["all"],
};
const statusLabel = (status: string) => ({ generated: "Awaiting admission", redeemed: "Verified admission", email: "Email opt-ins", text: "Text opt-ins" }[status] || status.replace(/^./, letter => letter.toUpperCase()));
type Confirmation = { row: AdminGuestRow; action: AdminGuestAction; nextStatus?: string };

const defaultFilter = (section: AdminGuestSection) => section === "visits" || section === "invitations" ? "pending" : section === "guests" ? "generated" : "all";
export default function AdminGuestOperations({ venues, onActionConfirmed, initialVenueId = "", initialSection = "visits", onVenueChange }: { venues: Array<Record<string, unknown>>; onActionConfirmed: (message: string) => void; initialVenueId?: string; initialSection?: AdminGuestSection; onVenueChange?: (id: string) => void }) {
  const [venueId, setVenueId] = useState(initialVenueId);
  useEffect(() => { setVenueId(initialVenueId); setOffset(0); }, [initialVenueId]);
  const [section, setSection] = useState<AdminGuestSection>(initialSection);
  const [filter, setFilter] = useState(defaultFilter(initialSection)), [offset, setOffset] = useState(0);
  const [period, setPeriod] = useState<"tonight" | "7d" | "30d">("30d");
  const [loadedData, setData] = useState<AdminGuestData | null>(null);
  const data = loadedData?.venue.id === venueId && loadedData.section === section ? loadedData : null;
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [note, setNote] = useState(""), [nickname, setNickname] = useState("");
  const [email, setEmail] = useState(""), [invitationNickname, setInvitationNickname] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const mounted = useRef(false), inFlight = useRef(false);
  const read = useRef<AbortController | null>(null), write = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; read.current?.abort(); write.current?.abort(); };
  }, []);
  const load = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    setError("");
    if (!venueId) { setLoading(false); return; }
    const accountId = readAdminSession()?.account?.id;
    setLoading(true);
    try {
      const params = new URLSearchParams({ venueId, section, status: filter, offset: String(offset), period });
      const result = await requestAdminJson(`/api/admin/guest-operations?${params}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: "no-store", fallbackMessage: "Unable to load guest operations. Try refreshing.",
      });
      if (!mounted.current || controller.signal.aborted || readAdminSession()?.account?.id !== accountId) return;
      if (result.venue?.id !== venueId || result.section !== section || !Array.isArray(result.rows)) throw new Error("Guest operations could not be confirmed.");
      setData(result);
    } catch (reason) {
      if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load guest operations.");
    } finally { if (mounted.current && !controller.signal.aborted) setLoading(false); }
  }, [venueId, section, filter, offset, period]);
  useEffect(() => { setConfirmation(null); setStatus(""); setInvitationUrl(""); void load(); return () => read.current?.abort(); }, [load]);

  async function save(action: AdminGuestAction, fields: Record<string, unknown>) {
    if (inFlight.current || !venueId || !data) return;
    inFlight.current = true; setSaving(true); setError(""); setStatus(""); setInvitationUrl("");
    const controller = new AbortController(); write.current = controller;
    const accountId = readAdminSession()?.account?.id;
    try {
      const result = await requestAdminJson("/api/admin/guest-operations", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fields, venueId, action }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
        fallbackMessage: "Unable to save. Refresh to confirm the current state before trying again.",
      });
      if (!mounted.current || controller.signal.aborted || readAdminSession()?.account?.id !== accountId) return;
      const message = result.deliveryWarning || (action === "invite" ? "VIP invitation created and email sent." : "Guest operation saved.");
      setStatus(message); onActionConfirmed(message); setConfirmation(null);
      if (result.invitationUrl) setInvitationUrl(result.invitationUrl);
      if (action === "invite") { setEmail(""); setInvitationNickname(""); }
      await load();
    } catch (reason) {
      if (mounted.current && !controller.signal.aborted) {
        setData(null); setConfirmation(null);
        setError(`${reason instanceof Error ? reason.message : "Unable to save."} Refresh before trying again.`);
      }
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  function prepare(row: AdminGuestRow, action: AdminGuestAction, nextStatus?: string) {
    setConfirmation({ row, action, nextStatus }); setNote(""); setNickname(row.nickname || "");
  }
  function confirm(event: FormEvent) {
    event.preventDefault(); if (!confirmation) return;
    const { row, action, nextStatus } = confirmation;
    void save(action, { id: row.id, status: nextStatus, expectedStatus: row.status, expectedUpdatedAt: row.updatedAt,
      expectedConsentedAt: row.consentedAt, nickname, expectedNickname: row.nickname || "", note });
  }
  const formatTime = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: data?.venue.timezone || "UTC", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const busy = loading || saving;
  return <section className="admin-guest-operations" aria-labelledby="admin-guest-title">
    <header><div><span className="eyebrow">Guest operations</span><h2 id="admin-guest-title">VIP, guests & club results</h2></div>
      <RefreshButton label="Refresh guest operations" busy={loading} type="button" disabled={!venueId || busy} onClick={() => void load()} /></header>
    <label className="admin-guest-venue">Club<select value={venueId} disabled={saving} onChange={event => { setVenueId(event.target.value); onVenueChange?.(event.target.value); setOffset(0); }}>
      <option value="">Choose a club</option>{venues.map(venue => <option key={String(venue.id)} value={String(venue.id)}>{String(venue.name || "Club")}{venue.is_active === false ? " · inactive" : ""}</option>)}
    </select></label>
    <nav aria-label="Guest operation sections">{ADMIN_GUEST_SECTIONS.map(id => <button key={id} type="button" aria-pressed={section === id} disabled={saving}
      onClick={() => { setSection(id); setFilter(defaultFilter(id)); setOffset(0); }}>{labels[id]}</button>)}</nav>
    {venueId ? <>
      <div className="admin-guest-filters"><h3>{labels[section]}</h3>
        {filters[section].length > 1 && <label>Status<select value={filter} disabled={saving} onChange={event => { setFilter(event.target.value); setOffset(0); }}>{filters[section].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>}
        {section === "results" && <label>Period<select value={period} disabled={saving} onChange={event => setPeriod(event.target.value as typeof period)}><option value="tonight">Tonight</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>}
      </div>
      {data && <p className="admin-guest-help">Times shown in {data.venue.timezone.replaceAll("_", " ")}. {section === "guests" ? "Passes must be scanned to verify admission." : section === "rides" ? "These are contact requests, not confirmed rides. Coordinate pickup with the guest." : section === "updates" ? "Email and text choices are separate. Only guests can opt in; admins can withdraw an existing subscription." : section === "members" || section === "invitations" ? "Nicknames are private club records and are never shown to guests or dancers." : ""}</p>}
      {section === "invitations" && data && <form className="admin-guest-invite" onSubmit={event => { event.preventDefault(); void save("invite", { email, nickname: invitationNickname }); }}>
        <label>Guest email<input type="email" maxLength={254} value={email} disabled={busy} required onChange={event => setEmail(event.target.value)} /></label>
        <label>Private nickname (optional)<input maxLength={80} value={invitationNickname} disabled={busy} onChange={event => setInvitationNickname(event.target.value)} /></label>
        <button type="submit" disabled={busy || !data.venue.is_active}>Send VIP invitation</button>
      </form>}
      {loading && <p role="status">Loading {labels[section].toLowerCase()}…</p>}
      {error && <p className="admin-guest-error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {invitationUrl && <label>Invitation link<input readOnly value={invitationUrl} onFocus={event => event.target.select()} /></label>}
      {data?.results && <VenueValueAnalytics report={data.results.report} period={period} periodStart={data.results.periodStart} periodEnd={data.results.periodEnd}
        timezone={data.venue.timezone} totalFollowers={data.results.totalFollowers} conversion={null} />}
      {data && section !== "results" && !data.rows.length && <p>No {labels[section].toLowerCase()} match this filter.</p>}
      <div className="admin-guest-records">{data?.rows.map(row => <article key={row.id}>
        <div className="admin-guest-record-heading"><strong>{row.nickname || row.name}</strong><span>{statusLabel(row.status)}</span></div>
        {row.nickname && <p>{row.name}</p>}
        <dl><div><dt>{section === "updates" ? "Consented" : "Created"}</dt><dd>{formatTime(row.createdAt)}</dd></div>
          {row.startsAt && <div><dt>Visit</dt><dd>{formatTime(row.startsAt)}</dd></div>}
          {row.expiresAt && <div><dt>Expires</dt><dd>{formatTime(row.expiresAt)}</dd></div>}
          {row.phone && <div><dt>Phone</dt><dd><a href={`tel:${row.phone}`}>{row.phone}</a></dd></div>}
          {row.email && <div><dt>Email</dt><dd>{row.email}</dd></div>}
          {row.location && <div><dt>Pickup</dt><dd>{row.location} · {row.partySize} guests</dd></div>}
          {row.arrivalMethod && <div><dt>Arrival</dt><dd>{clubArrivalLabel(row.arrivalMethod)}</dd></div>}
          {row.dancers?.length ? <div><dt>Dancers requested</dt><dd>{row.dancers.join(", ")}</dd></div> : null}
          {row.note && <div><dt>Guest note</dt><dd>{row.note}</dd></div>}
          {row.channel && <div><dt>{row.channel === "email" ? "Email updates" : "Text updates"}</dt><dd>{row.destination}</dd></div>}
          {row.withdrawnAt && <div><dt>Withdrawn</dt><dd>{formatTime(row.withdrawnAt)}</dd></div>}
        </dl>
        <div className="admin-guest-actions">
          {section === "visits" && row.status === "pending" && <><button disabled={busy} type="button" onClick={() => prepare(row, "request_status", "confirmed")}>Confirm visit</button><button disabled={busy} type="button" onClick={() => prepare(row, "request_status", "declined")}>Decline</button></>}
          {section === "visits" && row.status === "confirmed" && <button disabled={busy} type="button" onClick={() => prepare(row, "request_status", "cancelled")}>Cancel visit</button>}
          {section === "members" && row.status === "active" && <><button disabled={busy} type="button" onClick={() => prepare(row, "set_nickname")}>Edit private nickname</button><button disabled={busy} type="button" onClick={() => prepare(row, "revoke_member")}>Revoke VIP access</button></>}
          {section === "invitations" && row.status === "pending" && <button disabled={busy} type="button" onClick={() => prepare(row, "revoke_invitation")}>Revoke invitation</button>}
          {section === "updates" && row.status === "active" && <button disabled={busy} type="button" onClick={() => prepare(row, "unsubscribe")}>Unsubscribe {row.channel}</button>}
        </div>
        {confirmation?.row.id === row.id && <form className="admin-guest-confirm" onSubmit={confirm}>
          <strong>{confirmation.action === "set_nickname" ? "Edit private nickname" : confirmation.action === "request_status" ? `Set visit to ${confirmation.nextStatus}?` : confirmation.action === "unsubscribe" ? `Unsubscribe this ${row.channel} address?` : "Revoke this VIP access?"}</strong>
          {confirmation.action === "set_nickname" ? <label>Private nickname<input maxLength={80} disabled={saving} value={nickname} onChange={event => setNickname(event.target.value)} /></label>
            : <label>{confirmation.action === "request_status" ? "Reply to VIP (optional)" : "Admin note (optional)"}<input maxLength={500} disabled={saving} value={note} onChange={event => setNote(event.target.value)} /></label>}
          <div><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save change"}</button><button type="button" disabled={saving} onClick={() => setConfirmation(null)}>Keep unchanged</button></div>
        </form>}
      </article>)}</div>
      {section !== "results" && <div className="admin-guest-pagination"><button type="button" disabled={busy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous</button>
        <span>Page {offset / 50 + 1}{data ? ` · ${data.rows.length} records` : ""}</span><button type="button" disabled={busy || !data?.hasMore} onClick={() => setOffset(value => value + 50)}>Next</button></div>}
    </> : <p>Select a club to manage its guests and see current results.</p>}
  </section>;
}
