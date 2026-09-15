"use client";
import { offerPushNotifications } from "@/src/lib/dancr/push-invitation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PICKUP_STATUS_LABELS, PICKUP_TRANSPORT_NOTICE, type PhonePickupRequest, type PickupRequest, type PickupRole, type PickupVenue } from "@/src/lib/dancr/pickup-domain";
import { PickupAccountGate, requestPickupJson, usePickupAccount } from "./pickup-session";
import { guestPickupHref, savedGuestPickups } from "@/src/lib/dancr/pickup-guest-session";
import PickupPushNotifications from "./PickupPushNotifications";

export default function PickupInbox() {
  const account = usePickupAccount();
  if (!account.ready) return <p role="status">Loading pickup requests…</p>;
  return <><SavedGuestChats standalone={!account.identity} />{account.identity && <PickupAccountGate>{role => <Inbox role={role} />}</PickupAccountGate>}</>;
}
function SavedGuestChats({ standalone }: { standalone: boolean }) {
  const links = savedGuestPickups();
  if (!standalone && !links.length) return null;
  return <section className="pickup-card">
    {standalone && <Link href="/?view=venues">‹ Browse clubs</Link>}
    {standalone ? <h1>Pickup Requests</h1> : <h2>Guest chats on this device</h2>}
    <p>No sign-in needed. Open a saved chat below, or request pickup from a club with pickup chat enabled.</p>
    {!links.length && <p>No guest chats are saved on this device. If you already requested pickup, open your private chat link.</p>}
    <div className="pickup-list">{links.map(link => <Link prefetch={false} className="pickup-list-item" key={link.id} href={guestPickupHref(link.id, link.key)}>
      <strong>{link.venue}</strong><span>Open pickup chat</span><time dateTime={new Date(link.savedAt).toISOString()}>{new Date(link.savedAt).toLocaleString()}</time>
    </Link>)}</div>
  </section>;
}
function Inbox({ role }: { role: PickupRole }) {
  const [requests, setRequests] = useState<PickupRequest[]>([]), [venues, setVenues] = useState<PickupVenue[]>([]);
  const [phoneRequests, setPhoneRequests] = useState<PhonePickupRequest[]>([]), [morePhone, setMorePhone] = useState(false);
  const [group, setGroup] = useState("active"), [venueId, setVenueId] = useState(""), [status, setStatus] = useState("");
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true), [more, setMore] = useState(false);
  const [revision, setRevision] = useState(0), [saving, setSaving] = useState(false), [settingsError, setSettingsError] = useState("");
  const paginationLock = useRef(false), settingsLock = useRef(false), mounted = useRef(false), queryRef = useRef("");
  const query = new URLSearchParams({ group, ...(venueId ? { venueId } : {}), ...(status ? { status } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  queryRef.current = query;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (role === "customer") return;
    const controller = new AbortController();
    void requestPickupJson("/api/pickups/settings", { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setVenues(data.venues); })
      .catch(() => { if (!controller.signal.aborted) setSettingsError("Unable to load venue pickup settings."); });
    return () => controller.abort();
  }, [role]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void requestPickupJson(`/api/pickups?${query}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setRequests(data.requests); setMore(data.hasMore); setPhoneRequests(data.phoneRequests || []); setMorePhone(Boolean(data.hasMorePhoneRequests)); }
    }).catch(failure => { if (!controller.signal.aborted) { setRequests([]); setPhoneRequests([]); setError(failure instanceof Error ? failure.message : "Unable to load pickup requests."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && !paginationLock.current) setRevision(value => value + 1); };
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, []);
  async function loadMore(kind: "chat" | "phone" = "chat") {
    if (paginationLock.current) return;
    paginationLock.current = true; setLoading(true);
    const expectedQuery = query;
    try {
      const data = await requestPickupJson(`/api/pickups?${query}&${kind === "phone" ? "phoneOffset=" + phoneRequests.length : "offset=" + requests.length}`);
      if (mounted.current && expectedQuery === queryRef.current) {
        if (kind === "phone") { setPhoneRequests(current => [...new Map([...current, ...data.phoneRequests].map(r => [r.id, r])).values()]); setMorePhone(data.hasMorePhoneRequests); }
        else { setRequests(current => [...new Map([...current, ...data.requests].map(r => [r.id, r])).values()]); setMore(data.hasMore); }
      }
    } catch (failure) { if (mounted.current && expectedQuery === queryRef.current) setError(failure instanceof Error ? failure.message : "Unable to load more pickups."); }
    finally { paginationLock.current = false; if (mounted.current && expectedQuery === queryRef.current) setLoading(false); }
  }
  async function setEnabled(venue: PickupVenue) {
    if (settingsLock.current) return;
    settingsLock.current = true; setSaving(true); setSettingsError("");
    try {
      await requestPickupJson("/api/pickups/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venueId: venue.id, enabled: !venue.club_pickup_enabled }) });
      if (mounted.current) setVenues(current => current.map(item => item.id === venue.id ? { ...item, club_pickup_enabled: !venue.club_pickup_enabled } : item));
      if (mounted.current && !venue.club_pickup_enabled) offerPushNotifications("venue-pickup");
    } catch (failure) { if (mounted.current) setSettingsError(failure instanceof Error ? failure.message : "Unable to update pickup setting."); }
    finally { settingsLock.current = false; if (mounted.current) setSaving(false); }
  }
  return <section className="pickup-card">
    <Link href={role === "admin" ? "/admin" : `/dashboard/${role}`}>‹ Dashboard</Link>
    <h1>{role === "admin" ? "Pickup monitoring" : "Pickup Requests"}</h1>
    <p>{role === "customer" ? "Your private conversations with venues. Open a club page to request pickup where available." : role === "venue" ? "Manage customer pickup requests as your venue. Your venue decides availability and controls transportation." : "Review conversations, arrival attribution and immutable event history."}</p>
    {role !== "admin" && <PickupPushNotifications role={role} />}
    {role === "venue" && <details className="pickup-details"><summary>Club Pickup settings</summary><p>{PICKUP_TRANSPORT_NOTICE}</p>
      <p>Enable pickup chat if your venue can manage conversations here. Disabling chat stops new chat requests; phone requests and existing conversations remain available. Each manager must accept the chat notice before reading or sending messages.</p>
      {venues.map(venue => <div key={venue.id}><strong>{venue.name}</strong><p>{venue.club_pickup_enabled ? "Pickup chat enabled" : "Pickup chat disabled"}</p><button disabled={saving || (!venue.eligible && !venue.club_pickup_enabled)} onClick={() => void setEnabled(venue)}>{venue.club_pickup_enabled ? "Disable Club Pickup" : "Enable Club Pickup"}</button>{!venue.eligible && <p>Publish your verified venue page before enabling pickup.</p>}</div>)}
      {!venues.length && !settingsError && <p>Pickup settings are available to venue owners and managers.</p>}
    </details>}{settingsError && <p role="alert">{settingsError}</p>}
    <div className="pickup-tabs" role="group" aria-label="Pickup request groups">
      {[["active", "Active"], ["completed", "Completed"], ["closed", "Cancelled / No Show"]].map(([value, label]) => <button key={value} aria-pressed={group === value && !status} onClick={() => { setGroup(value); setStatus(""); }}>{label}</button>)}
    </div>
    {role === "admin" && <div className="pickup-filters">
      <label>Venue<select value={venueId} onChange={event => setVenueId(event.target.value)}><option value="">All venues</option>{venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></label>
      <label>Status<select value={status} onChange={event => { setStatus(event.target.value); setGroup("all"); }}><option value="">All statuses</option>{Object.entries(PICKUP_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>From date (UTC)<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Through date (UTC)<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
    </div>}
    <button onClick={() => setRevision(value => value + 1)} disabled={loading}>Refresh requests</button>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">Loading pickup requests…</p>}
    {!loading && !error && !requests.length && !phoneRequests.length && <p>No pickup requests in this group.</p>}
    {phoneRequests.length > 0 && <section aria-labelledby="phone-pickup-heading">
      <h2 id="phone-pickup-heading">Phone pickup requests</h2>
      <p>Contact these guests to arrange and confirm pickup. Phone requests are listed by submission time and do not have chat status updates.</p>
      <div className="pickup-list">{phoneRequests.map(request => <article className="pickup-list-item" key={request.id}>
        <strong>{request.venue_name} · {request.name}</strong>
        <span>{request.party_size} {request.party_size === 1 ? "guest" : "guests"} · {request.location}</span>
        <time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString()}</time>
        <a href={`tel:${request.phone}`}>Call {request.phone}</a>
        <a href={`mailto:${encodeURIComponent(request.email)}`}>Email {request.email}</a>
      </article>)}</div>
      {morePhone && <button disabled={loading} onClick={() => void loadMore("phone")}>Load more phone requests</button>}
    </section>}
    {phoneRequests.length > 0 && requests.length > 0 && <h2>Pickup chats</h2>}
    <div className="pickup-list">{requests.map(request => <Link key={request.id} className="pickup-list-item" href={`/pickups/${request.id}`}>
      <strong>{request.venue?.name || "Venue"}</strong><span>{PICKUP_STATUS_LABELS[request.status]}{Boolean(request.unread_count) && <b className="pickup-unread">{request.unread_count} unread</b>}</span>
      <span>Guest {(request.customer_user_id || request.id).slice(-6)} · {request.party_size} {request.party_size === 1 ? "guest" : "guests"}</span>
      <span>{request.pickup_location_text}</span><time dateTime={request.requested_at}>{new Date(request.requested_at).toLocaleString()}</time>
    </Link>)}</div>
    {more && <button disabled={loading} onClick={() => void loadMore()}>Load more requests</button>}
  </section>;
}
