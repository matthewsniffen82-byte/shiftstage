"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { VENUE_SHARING_CONSENT_VERSION, type VenueShare } from "@/src/lib/dancr/venue-customers";
import "./venue-customers.css";

export default function VenueCustomerSharing({ venueId, venueName, disabled }: { venueId: string; venueName: string; disabled: boolean }) {
  const [open, setOpen] = useState(false), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [share, setShare] = useState<VenueShare | null>(null), [email, setEmail] = useState("");
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setLoaded(false); setError(""); setStatus(""); setShare(null); setEmail("");
    void requestDashboardJson(`/api/customer/venue-sharing?venueId=${encodeURIComponent(venueId)}`, {
      expectedRole: "customer", signal: request.signal, cache: "no-store", fallbackMessage: "Unable to load sharing preferences.",
    }).then(data => { if (!request.signal.aborted) { setShare(data.share); setEmail(data.email); setLoaded(true); } })
      .catch(reason => { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load sharing preferences."); })
      .finally(() => { if (!request.signal.aborted) setBusy(false); });
    return () => controller.current?.abort();
  }, [open, venueId]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await update({ sharing: true, name: form.get("name"), city: form.get("city"), email, consent: form.get("consent") === "on", consentVersion: VENUE_SHARING_CONSENT_VERSION });
  }
  async function update(body: Record<string, unknown>) {
    if (busy || disabled) return;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(""); setStatus("");
    try {
      const data = await requestDashboardJson("/api/customer/venue-sharing", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venueId, ...body }),
        expectedRole: "customer", signal: request.signal, fallbackMessage: "Unable to update sharing preferences.",
      });
      if (request.signal.aborted) return;
      setShare(data.share);
      setStatus(data.share ? "Your details are now shared with this club." : "Follower details are no longer shared. Any active guest-list registration remains available for your visit.");
    } catch (reason) { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to update sharing preferences."); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <details className="venue-customer-sharing" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Share details with this club</summary>
    <p>Following stays private. You can choose to share your details with {venueName} and stop sharing here at any time. Unfollowing also removes your follower details.</p>
    {busy ? <p role="status">Loading…</p> : null}{error ? <p role="alert">{error}</p> : null}{status ? <p role="status">{status}</p> : null}
    {loaded && share ? <div><p>Shared with {venueName}: {share.name} · {share.email}{share.city ? ` · ${share.city}` : ""}</p>
      <button type="button" disabled={busy || disabled} onClick={() => void update({ sharing: false })}>Stop sharing</button></div> : null}
    {loaded && !share ? <form className="account-form" onSubmit={save}>
      <label>Your name<input name="name" required minLength={2} maxLength={100} autoComplete="name" disabled={busy || disabled} /></label>
      <label>Account email<input type="email" value={email} readOnly /></label>
      <label>Your city (optional)<input name="city" maxLength={100} autoComplete="address-level2" disabled={busy || disabled} /></label>
      <label><input type="checkbox" name="consent" required disabled={busy || disabled} />I agree to share my name, account email, and city with {venueName} for its customer list. This does not subscribe me to marketing.</label>
      <button type="submit" disabled={busy || disabled || !email}>Share my details</button>
    </form> : null}
  </details>;
}
