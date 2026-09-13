"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicClubDeal, DealSourceType } from "@/src/lib/dancr/types";
import { CLUB_TRANSPORTATION_TERMS, CLUB_ARRIVAL_VERIFICATION, CLUB_SHUTTLE_HANDOFF, normalizeShuttlePhone } from "@/src/lib/dancr/club-deal-transportation";
import NfcIcon from "@/app/components/NfcIcon";
import "./transportation.css";

export default function TransportationClient({ deal, venue, shuttleAvailable, initialTransportation = "", sourceType = "club_page", dancerId = "", attributionToken = "" }: {
  deal?: PublicClubDeal; venue: { id: string; name: string; slug: string };
  shuttleAvailable: boolean;
  initialTransportation?: "" | "club_shuttle";
  sourceType?: DealSourceType; dancerId?: string; attributionToken?: string;
}) {
  const [choice, setChoice] = useState<"" | "self_drive" | "club_shuttle" | "rideshare_taxi">(deal ? initialTransportation : "club_shuttle");
  const showingShuttleForm = choice === "club_shuttle";
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef(false);
  const attemptedRequest = useRef<{ requestId: string; name: string; location: string; phone: string; email: string; partySize: number; handoffAccepted: boolean } | null>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [showingShuttleForm, complete]);

  function chooseRideshare() {
    setChoice("rideshare_taxi");
    setError("");
    try {
      const saved = JSON.parse(localStorage.getItem("mydancrPendingNfcDealV2") || "null");
      if (saved?.venueId === venue.id) localStorage.removeItem("mydancrPendingNfcDealV2");
    } catch {
      setError("Your previous admission selection could not be cleared. Allow site storage and select your arrival method again. Rideshare and taxi arrivals do not qualify for free admission.");
    }
  }

  function prepareCashier(transportation: "self_drive" | "club_shuttle", shuttleRequestId?: string) {
    if (!deal) return true;
    const savedAt = Date.now();
    try {
      localStorage.setItem("mydancrPendingNfcDealV2", JSON.stringify({
        venueId: deal.venueId, dealId: deal.id, sourceType,
        dancerId: sourceType === "dancer_profile" ? dancerId || null : null,
        attributionToken: sourceType === "dancer_profile" ? attributionToken || null : null,
        transportation, shuttleRequestId: shuttleRequestId || null,
        savedAt, expiresAt: savedAt + 12 * 60 * 60 * 1000,
      }));
      setStorageError(false);
      return true;
    } catch { setStorageError(true); return false; }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice || choice === "rideshare_taxi" || pending.current || complete || (choice === "club_shuttle" && !shuttleAvailable)) return;
    setError("");
    if (choice === "self_drive") {
      if (!prepareCashier(choice)) {
        setError("Your transportation choice could not be saved. Allow site storage, then try again.");
        return;
      }
      setComplete(true);
      return;
    }
    const fields = new FormData(event.currentTarget);
    const contactPhone = normalizeShuttlePhone(fields.get("phone"));
    if (!contactPhone) { setError("Enter a valid contact phone number, including the country code for numbers outside the US."); return; }
    pending.current = true;
    setBusy(true);
    try {
      if (!attemptedRequest.current) {
        attemptedRequest.current = {
          requestId: crypto.randomUUID(), name: String(fields.get("name") || "").trim(),
          location: String(fields.get("location") || "").trim(), phone: contactPhone,
          email: String(fields.get("email") || "").trim(),
          partySize: Number(fields.get("partySize")), handoffAccepted: fields.get("handoffAccepted") === "on",
        };
      }
      const endpoint = deal ? `/api/deals/${encodeURIComponent(deal.id)}/shuttle` : `/api/venues/${encodeURIComponent(venue.id)}/shuttle`;
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attemptedRequest.current), signal: AbortSignal.timeout(45_000),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (response.status === 400) attemptedRequest.current = null;
        throw new Error(result.error || "Unable to send your request.");
      }
      setMessage(result.message);
      prepareCashier("club_shuttle", result.requestId);
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "The connection timed out. Retry to check the same request without sending duplicate alerts.");
    } finally { pending.current = false; setBusy(false); }
  }

  return <main className="club-transport-page">
    <section className="club-transport-card">
      <Link className="club-transport-back" href={`/venues/${encodeURIComponent(venue.slug)}`}>‹ {venue.name}</Link>
      <p className="club-transport-eyebrow">{deal ? "FREE ENTRY" : "CLUB TRANSPORT"}</p>
      <h1 ref={heading} tabIndex={-1}>{complete ? choice === "club_shuttle" ? "Pickup requested" : "Ready for your cashier tap" : choice === "club_shuttle" ? deal ? "Free Ride + Entry" : "Request a free ride" : "Free Entry"}</h1>
      <p className="club-transport-venue">{venue.name}</p>
      {deal ? <p className="club-transport-terms">{CLUB_TRANSPORTATION_TERMS}</p> : <p className="club-transport-terms">Free entry is currently unavailable for this club. You can still request club transport.</p>}
      {complete ? <div aria-live="polite">
        {choice === "club_shuttle" ? <><p><strong>Awaiting club confirmation.</strong></p><p>{message}</p><p>The club will contact you to arrange your pickup. Your ride is not booked yet.</p></> : <p>You confirmed you will arrive in a private car. Uber, Lyft, other rideshares, and taxis do not qualify.</p>}
        {deal ? <><div className="club-transport-ready"><NfcIcon /><p>When you arrive, have staff verify your arrival method, then unlock your phone and tap the MyDancr sticker at the cashier to redeem free admission.</p></div>
        {storageError ? <><p role="alert">Your shuttle request was sent. Allow site storage, then save your deal selection for the cashier. This does not send another shuttle request.</p><button className="club-transport-submit" type="button" onClick={() => prepareCashier("club_shuttle", attemptedRequest.current?.requestId)}>Save deal for cashier</button></> : <p className="club-transport-note">Your deal selection stays ready for 12 hours. Admission is subject to the club’s capacity, age requirements, dress code, and house rules.</p>}</> : null}
      </div> : <>
        {deal && choice === "club_shuttle" ? <button className="club-transport-change" type="button" disabled={busy || !!attemptedRequest.current} onClick={() => { setChoice(""); setError(""); }}>‹ Change transportation</button> : null}
        <form onSubmit={submit}>
          {deal && choice !== "club_shuttle" ? <fieldset className="club-transport-options" disabled={busy || !!attemptedRequest.current}>
            <legend>How will you get to the club?</legend>
            <label className={choice === "self_drive" ? "selected" : ""}><input required type="radio" name="transportation" value="self_drive" checked={choice === "self_drive"} onChange={() => { setChoice("self_drive"); setError(""); }} /><span><strong>Private car</strong><small>Free entry with your own car or a private car. Rideshares and taxis are excluded.</small></span></label>
            <label><input required type="radio" name="transportation" value="club_shuttle" checked={false} onChange={() => { setChoice("club_shuttle"); setError(""); }} /><span><strong>Free club transport</strong><small>Request pickup. Free entry is included when you arrive in club transport.</small></span></label>
            <label className={choice === "rideshare_taxi" ? "selected" : ""}><input required type="radio" name="transportation" value="rideshare_taxi" checked={choice === "rideshare_taxi"} onChange={chooseRideshare} /><span><strong>Rideshare or taxi</strong><small>Uber, Lyft, other rideshares, or taxi. Free entry is unavailable.</small></span></label>
          </fieldset> : null}
          {choice === "rideshare_taxi" ? <div className="club-transport-ineligible" role="status"><strong>This arrival method does not qualify for free entry.</strong><p>Choose free club transport to qualify when you arrive in the club’s vehicle.</p><button className="club-transport-submit" type="button" onClick={() => { setChoice("club_shuttle"); setError(""); }}>Request free club transport</button></div> : null}
          {choice === "club_shuttle" ? <>
            <div className="club-transport-handoff"><strong>The club handles your ride</strong><p>{CLUB_SHUTTLE_HANDOFF}</p></div>
            {!shuttleAvailable ? <p role="status">This club isn’t accepting shuttle requests yet. You can fill out the form, but your request can’t be sent yet.</p> : null}
            <div className="club-transport-fields">
              <label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100} readOnly={busy || !!attemptedRequest.current} /></label>
              <label>Pickup location<input name="location" autoComplete="street-address" placeholder="Hotel or street address, city, and pickup entrance" required minLength={5} maxLength={300} readOnly={busy || !!attemptedRequest.current} /></label>
              <label>Number of people<input name="partySize" type="number" inputMode="numeric" required min={1} max={100} step={1} defaultValue={1} readOnly={busy || !!attemptedRequest.current} /></label>
              <label>Contact phone number<input name="phone" type="tel" autoComplete="tel" placeholder="(555) 555-0123" required maxLength={40} readOnly={busy || !!attemptedRequest.current} /></label>
              <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} readOnly={busy || !!attemptedRequest.current} /></label>
              <label className="club-transport-consent"><input name="handoffAccepted" type="checkbox" required onClick={event => { if (busy || attemptedRequest.current) event.preventDefault(); }} /><span>I agree that MyDancr will send my details to {venue.name} so its manager can contact me and arrange the club’s free shuttle.</span></label>
            </div>
          </> : null}
          {error ? <p role="alert" className="club-transport-error">{error}</p> : null}
          {choice !== "rideshare_taxi" ? <button className="club-transport-submit" type="submit" disabled={!choice || busy || (choice === "club_shuttle" && !shuttleAvailable)} aria-busy={busy}>{busy ? "Sending to the club…" : attemptedRequest.current ? "Retry shuttle request" : choice === "club_shuttle" ? "Send pickup request" : "Confirm private-car arrival"}</button> : null}
        </form>
        {deal ? <p className="club-transport-note">One free general-admission entry per guest, subject to capacity, age requirements, dress code, and house rules.</p> : null}
      </>}
      {deal ? <p className="club-transport-note">{CLUB_ARRIVAL_VERIFICATION}</p> : null}
    </section>
  </main>;
}
