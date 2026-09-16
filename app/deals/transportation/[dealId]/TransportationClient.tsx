"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicClubDeal, DealSourceType } from "@/src/lib/dancr/types";
import { AUTONOMOUS_ADMISSION_OPTIONS, CLUB_TRANSPORTATION_TERMS, normalizeShuttlePhone, type EligibleClubTransportation } from "@/src/lib/dancr/club-deal-transportation";
import NfcIcon from "@/app/components/NfcIcon";
import "./transportation.css";

function formatContactPhoneInput(event: React.SyntheticEvent<HTMLInputElement>) {
  if ((event.nativeEvent as InputEvent).isComposing) return;
  const input = event.currentTarget, previous = input.value;
  // Preserve international numbers, extensions and extra digits for validation.
  if (/[^\d\s()+.-]/.test(previous) || (previous.trim().startsWith("+") && !previous.trim().startsWith("+1"))) return;
  const digits = previous.replace(/\D/g, "");
  const hasCountryCode = previous.trim().startsWith("+1") || (digits.length === 11 && digits.startsWith("1"));
  const national = hasCountryCode ? digits.slice(1) : digits;
  if (national.length > 10) return;
  const number = national.length <= 3 ? national : `(${national.slice(0, 3)}) ${national.slice(3, 6)}${national.length > 6 ? "-" + national.slice(6) : ""}`;
  const prefix = hasCountryCode ? (previous.trim().startsWith("+") ? "+1" : "1") : "";
  const formatted = [prefix, number].filter(Boolean).join(" ");
  if (formatted === previous) return;
  const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection || "none";
  const positionAfterDigits = (position: number) => {
    const count = previous.slice(0, position).replace(/\D/g, "").length;
    if (!count) return formatted.startsWith("(") ? 1 : Math.min(position, formatted.startsWith("+") ? 1 : 0);
    let seen = 0;
    for (let index = 0; index < formatted.length; index++) {
      if (/\d/.test(formatted[index]) && ++seen === count) return index + 1;
    }
    return formatted.length;
  };
  input.value = formatted;
  if (start !== null && end !== null) input.setSelectionRange(positionAfterDigits(start), positionAfterDigits(end), direction);
}

export default function TransportationClient({ deal, venue, shuttleAvailable, initialTransportation = "", sourceType = "club_page", dancerId = "", attributionToken = "" }: {
  deal?: PublicClubDeal; venue: { id: string; name: string; slug: string; address?: string | null };
  shuttleAvailable: boolean;
  initialTransportation?: "" | "club_shuttle";
  sourceType?: DealSourceType; dancerId?: string; attributionToken?: string;
}) {
  const [choice, setChoice] = useState<"" | EligibleClubTransportation | "rideshare_taxi">(deal ? initialTransportation : "club_shuttle");
  const autonomousArrival = AUTONOMOUS_ADMISSION_OPTIONS.find(option => option.value === choice);
  const showingShuttleForm = choice === "club_shuttle";
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [addressCopyStatus, setAddressCopyStatus] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef(false);
  const attemptedRequest = useRef<{ requestId: string; name: string; location: string; phone: string; email: string; partySize: number; handoffAccepted: boolean } | null>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [showingShuttleForm, complete]);

  async function copyClubAddress() {
    if (!venue.address) return;
    try {
      await navigator.clipboard.writeText(venue.address);
      setAddressCopyStatus("Club address copied.");
    } catch {
      setAddressCopyStatus("Select and copy the club address above.");
    }
  }

  function chooseRideshare() {
    setChoice("rideshare_taxi");
    setError("");
    try {
      const saved = JSON.parse(localStorage.getItem("mydancrPendingNfcDealV2") || "null");
      if (saved?.venueId === venue.id) localStorage.removeItem("mydancrPendingNfcDealV2");
    } catch {
      setError("Your previous admission selection could not be cleared. Allow site storage and select your arrival method again. Other rideshares and taxis do not qualify for free admission.");
    }
  }

  function prepareCashier(transportation: EligibleClubTransportation, shuttleRequestId?: string) {
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
    if (choice !== "club_shuttle") {
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
      <h1 ref={heading} tabIndex={-1}>{complete ? choice === "club_shuttle" ? "Pickup requested" : "Ready for your cashier tap" : choice === "club_shuttle" ? deal ? "Free Ride + Entry" : "Request a free ride" : "Free Entry"}</h1>
      <p className="club-transport-venue">{venue.name}</p>
      {deal ? <p className="club-transport-terms">{CLUB_TRANSPORTATION_TERMS}</p> : <p className="club-transport-terms">Free entry is currently unavailable. You can still request a free ride.</p>}
      {complete ? <div aria-live="polite">
        {choice === "club_shuttle" ? <><p><strong>Awaiting club confirmation.</strong></p><p>{message}</p><p>The club will follow up using your contact details. Your ride is not booked yet.</p></> : autonomousArrival ? <>
          <p>You confirmed you will arrive by Waymo, Zoox, or Cybercab.</p>
          <section className="club-transport-booking" aria-labelledby="club-transport-booking-heading">
            <h2 id="club-transport-booking-heading">Book your ride</h2>
            <p>Free admission. Book your ride separately; ride fare isn’t included.</p>
            {venue.address ? <label className="club-transport-address">Club address<textarea aria-label="Club address" value={venue.address} readOnly rows={2} onFocus={event => event.currentTarget.select()} /></label> : <p className="club-transport-note">Club address unavailable. Check with the club before booking.</p>}
            <div className="club-transport-booking-links">
              <a className="club-transport-provider-button" href="https://waymo.com/rides/" target="_blank" rel="noopener noreferrer">Open Waymo</a>
              <a className="club-transport-provider-button" href="https://zoox.com/how-to-ride" target="_blank" rel="noopener noreferrer">Open Zoox</a>
              <a className="club-transport-provider-button" href="https://www.tesla.com/support/robotaxi" target="_blank" rel="noopener noreferrer"><span>Tesla Robotaxi<small>Check availability</small></span></a>
              {venue.address ? <button className="club-transport-provider-button" type="button" onClick={copyClubAddress}>Copy club address</button> : null}
            </div>
            {addressCopyStatus ? <p className="club-transport-note" role="status">{addressCopyStatus}</p> : null}
            <p className="club-transport-note">Check service coverage and pickup/drop-off locations in the provider’s app. Tesla assigns the vehicle; a Cybercab isn’t guaranteed.</p>
          </section>
        </> : <p>You confirmed you will arrive in a private car.</p>}
        {deal ? <><div className="club-transport-ready"><NfcIcon /><p>Have staff verify your arrival method, then unlock your phone and tap the MyDancr sticker at the cashier for free entry.</p></div>
        {storageError ? <><p role="alert">Your shuttle request was sent. Allow site storage, then save your deal selection for the cashier. This does not send another shuttle request.</p><button className="club-transport-submit" type="button" onClick={() => prepareCashier("club_shuttle", attemptedRequest.current?.requestId)}>Save deal for cashier</button></> : <p className="club-transport-note">Your deal selection stays ready for 12 hours. Admission is subject to the club’s capacity, age requirements, dress code, and house rules.</p>}</> : null}
      </div> : <>
        {deal && choice === "club_shuttle" ? <button className="club-transport-change" type="button" disabled={busy || !!attemptedRequest.current} onClick={() => { setChoice(""); setError(""); }}>‹ Change transportation</button> : null}
        <form onSubmit={submit}>
          {deal && choice !== "club_shuttle" ? <fieldset className="club-transport-options" disabled={busy || !!attemptedRequest.current}>
            <legend>How will you arrive?</legend>
            <label className={choice === "self_drive" ? "selected" : ""}><input required type="radio" name="transportation" value="self_drive" checked={choice === "self_drive"} onChange={() => { setChoice("self_drive"); setError(""); }} /><span><strong>Private car</strong><small>Free entry. No rideshares or taxis.</small></span></label>
            <label><input required type="radio" name="transportation" value="club_shuttle" checked={false} onChange={() => { setChoice("club_shuttle"); setError(""); }} /><span><strong>Free club transport</strong><small>Free pickup + entry when you arrive in club transport.</small></span></label>
            {AUTONOMOUS_ADMISSION_OPTIONS.map(option => <label key={option.value} className={choice === option.value ? "selected" : ""}><input required type="radio" name="transportation" value={option.value} checked={choice === option.value} onChange={() => { setChoice(option.value); setError(""); }} /><span><strong>{option.label}</strong><small>Free entry. Ride fare not included.</small></span></label>)}
            <label className={choice === "rideshare_taxi" ? "selected" : ""}><input required type="radio" name="transportation" value="rideshare_taxi" checked={choice === "rideshare_taxi"} onChange={chooseRideshare} /><span><strong>Other rideshare or taxi</strong><small>Uber, Lyft, and other taxis: free entry isn’t included.</small></span></label>
          </fieldset> : null}
          {choice === "rideshare_taxi" ? <div className="club-transport-ineligible" role="status"><strong>This arrival method does not qualify for free entry.</strong><p>Choose free club transport to qualify when you arrive in the club’s vehicle.</p><button className="club-transport-submit" type="button" onClick={() => { setChoice("club_shuttle"); setError(""); }}>Request free club transport</button></div> : null}
          {choice === "club_shuttle" ? <>
            <div className="club-transport-handoff"><p><strong>No sign-in needed.</strong> MyDancr sends your contact details and pickup request to the club manager. The club arranges your ride and contacts you by phone to confirm availability, pickup location, and timing.</p><p>Your ride is confirmed only when the club accepts.</p></div>
            {!shuttleAvailable ? <p role="status">Shuttle requests are currently unavailable at this club.</p> : null}
            <div className="club-transport-fields">
              <label>Name<input name="name" autoComplete="name" required minLength={2} maxLength={100} readOnly={busy || !!attemptedRequest.current} /></label>
              <label>Pickup location<input name="location" autoComplete="street-address" placeholder="Hotel/address, city, and pickup entrance" required minLength={5} maxLength={300} readOnly={busy || !!attemptedRequest.current} /></label>
              <label>Guests<input name="partySize" type="number" inputMode="numeric" required min={1} max={100} step={1} defaultValue={1} readOnly={busy || !!attemptedRequest.current} /></label>
              <label>Phone<input name="phone" type="tel" autoComplete="tel" placeholder="(555) 555-0123" onChange={formatContactPhoneInput} onCompositionEnd={formatContactPhoneInput} required maxLength={40} readOnly={busy || !!attemptedRequest.current} /></label>
              <label>Email<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} readOnly={busy || !!attemptedRequest.current} /></label>
              <label className="club-transport-consent"><input name="handoffAccepted" type="checkbox" required onClick={event => { if (busy || attemptedRequest.current) event.preventDefault(); }} /><span>I agree to let MyDancr share my details with {venue.name} so the club can contact me to arrange my free shuttle.</span></label>
            </div>
          </> : null}
          {error ? <p role="alert" className="club-transport-error">{error}</p> : null}
          {choice !== "rideshare_taxi" ? <button className="club-transport-submit" type="submit" disabled={!choice || busy || (choice === "club_shuttle" && !shuttleAvailable)} aria-busy={busy}>{busy ? "Sending to the club…" : attemptedRequest.current ? "Retry shuttle request" : choice === "club_shuttle" ? "Send pickup request" : "Continue to free entry"}</button> : null}
        </form>
        {deal ? <p className="club-transport-note">One free general admission per guest. Capacity, age requirements, dress code, and house rules apply.</p> : null}
      </>}
      {deal ? <p className="club-transport-note">Staff must verify your arrival method before granting free entry.</p> : null}
    </section>
  </main>;
}
