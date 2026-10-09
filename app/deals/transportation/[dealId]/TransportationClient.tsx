"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicClubDeal, DealSourceType } from "@/src/lib/dancr/types";
import { AUTONOMOUS_ADMISSION_OPTIONS, admissionOfferHours, normalizeShuttlePhone, type AdmissionMethod, type EligibleClubTransportation } from "@/src/lib/dancr/club-deal-transportation";
import { readBrowserAuthSession, persistRefreshedBrowserAuthSession } from "@/src/lib/dancr/browser-session";
import { normalizeGuestListDetails, type GuestListDetails } from "@/src/lib/dancr/guest-list";
import "./transportation.css";

function EntryChevron() {
  return <span className="club-entry-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>;
}

function EntryIcon({ kind }: { kind: "arrival" | "transport" | "guest" | "club" }) {
  return <span className="club-entry-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === "arrival" ? <><path d="m5 11 2-6h10l2 6M4 11h16v7H4zM6 18v2m12-2v2M7 14h.01M17 14h.01" /></>
      : kind === "transport" ? <><rect x="4" y="3" width="16" height="16" rx="3" /><path d="M4 11h16M8 19v2m8-2v2M8 15h.01M16 15h.01" /></>
      : kind === "guest" ? <><circle cx="9" cy="7" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-10 2 2 4-4" /></>
      : <><path d="M4 21V7l8-4 8 4v14M9 21v-7h6v7M8 8h.01M16 8h.01M8 11h.01M16 11h.01" /></>}
  </svg></span>;
}

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
  deal?: PublicClubDeal; venue: { id: string; name: string; slug: string; address?: string | null; logoImageUrl?: string | null };
  shuttleAvailable: boolean;
  initialTransportation?: "" | "club_shuttle";
  sourceType?: DealSourceType; dancerId?: string; attributionToken?: string;
}) {
  const [openForm, setOpenForm] = useState<"" | "arrival" | "club_shuttle">(deal ? initialTransportation : "club_shuttle");
  // Keep the pass/pickup context when Guest List hides the other mounted forms.
  const [expandedSection, setExpandedSection] = useState<"" | "arrival" | "club_shuttle" | "guest_list">(deal ? initialTransportation : "club_shuttle");
  const [arrivalChoice, setArrivalChoice] = useState<"" | EligibleClubTransportation | "rideshare_taxi">("");
  const choice = openForm === "club_shuttle" ? "club_shuttle" : arrivalChoice;
  const [issuedMethod, setIssuedMethod] = useState<AdmissionMethod | null>(null);
  const passMethod = issuedMethod || choice;
  const autonomousArrival = AUTONOMOUS_ADMISSION_OPTIONS.find(option => option.value === passMethod);
  const showingShuttleForm = expandedSection === "club_shuttle";
  const showingArrivalForm = expandedSection === "arrival";
  const offerHours = deal ? admissionOfferHours({ ...deal, validDays: deal.validDays || undefined }) : "";
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [passUrl, setPassUrl] = useState("");
  const [passError, setPassError] = useState("");
  const [guestListJoined, setGuestListJoined] = useState(false);
  const guestOpen = expandedSection === "guest_list";
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState("");
  const [addressCopyStatus, setAddressCopyStatus] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [logoFailed, setLogoFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = useRef(false);
  const guestPending = useRef(false);
  const attemptedRequest = useRef<{ requestId: string; name: string; location: string; phone: string; email: string; partySize: number; handoffAccepted: boolean } | null>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [complete]);

  function fieldFeedback(section: "pickup" | "guest", name: string) {
    const key = `${section}-${name}`;
    return {
      id: key,
      "aria-invalid": Boolean(fieldErrors[key]),
      "aria-describedby": fieldErrors[key] ? `${key}-error` : undefined,
      onInvalid: (event: React.InvalidEvent<HTMLInputElement>) => {
        const validationMessage = event.currentTarget.validationMessage;
        setFieldErrors(current => ({ ...current, [key]: validationMessage }));
      },
      onInput: () => { if (fieldErrors[key]) setFieldErrors(current => ({ ...current, [key]: "" })); },
    };
  }

  function fieldError(section: "pickup" | "guest", name: string) {
    const key = `${section}-${name}`;
    return fieldErrors[key] ? <small className="club-field-error" id={`${key}-error`}>{fieldErrors[key]}</small> : null;
  }

  function toggleForm(form: "arrival" | "club_shuttle") {
    if (pending.current || guestPending.current || complete || attemptedRequest.current) return;
    const next = expandedSection === form ? "" : form;
    setOpenForm(next);
    setExpandedSection(next);
    setError("");
  }

  function toggleGuestList() {
    // An unresolved pickup must keep its existing retry control visible.
    if (pending.current || guestPending.current || (!complete && attemptedRequest.current)) return;
    setExpandedSection(guestOpen ? "" : "guest_list");
  }

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
    setArrivalChoice("rideshare_taxi");
    setError("");
    try {
      const saved = JSON.parse(localStorage.getItem("mydancrPendingNfcDealV2") || "null");
      if (saved?.venueId === venue.id) localStorage.removeItem("mydancrPendingNfcDealV2");
    } catch {
      setError("Your previous admission selection could not be cleared. Allow site storage and select your arrival method again. Other rideshares and taxis do not qualify for free admission.");
    }
  }

  async function prepareAdmissionPass(transportation: AdmissionMethod, guest?: GuestListDetails) {
    if (!deal) return;
    setPassError("");
    const browserAuth = readBrowserAuthSession();
    const auth = browserAuth?.account?.role === "customer" ? browserAuth : null;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth?.accessToken) headers.authorization = `Bearer ${auth.accessToken}`;
    if (auth?.refreshToken) headers["x-dancr-refresh-token"] = auth.refreshToken;
    const response = await fetch("/api/deals/redemptions", { method: "POST", credentials: "same-origin", headers,
      body: JSON.stringify({ dealId: deal.id, sourceType, dancerId, attributionToken, transportation, ...(guest ? { guest } : {}) }), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to generate your admission pass.");
    if (!/^\/deals\/pass\/[A-Za-z0-9_-]{43}$/.test(result.passUrl || "")) throw new Error("Invalid pass receipt.");
    if (guest && result.guestListJoined !== true) throw new Error("Your guest-list entry could not be confirmed. Please try again.");
    if (auth) persistRefreshedBrowserAuthSession(result.session, auth);
    setPassUrl(result.passUrl);
    setIssuedMethod(transportation);
    if (guest) setGuestListJoined(true);
    try { localStorage.setItem("mydancrPendingNfcDealV2", JSON.stringify({
      admissionPassVersion: 1, passUrl: result.passUrl, venueId: venue.id, dealId: deal.id, sourceType, dancerId, transportation,
      savedAt: Date.now(), expiresAt: Date.parse(result.expiresAt),
    })); } catch { /* The pass link remains available without local storage. */ }
  }

  async function retryPass() {
    if (pending.current || guestPending.current || !choice || choice === "rideshare_taxi") return;
    pending.current = true; setBusy(true);
    try { await prepareAdmissionPass(choice); }
    catch (reason) { setPassError(reason instanceof Error ? reason.message : "Unable to generate your pass."); }
    finally { pending.current = false; setBusy(false); }
  }

  async function submitGuestList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deal || !guestOpen || pending.current || guestPending.current || guestListJoined) return;
    setGuestError("");
    const fields = new FormData(event.currentTarget);
    const guest = normalizeGuestListDetails({ name: fields.get("name"), phone: fields.get("phone"), email: fields.get("email"), consent: fields.get("guestConsent") === "on" });
    if (!guest) {
      const errors: Record<string, string> = {};
      if (String(fields.get("name") || "").trim().length < 2) errors["guest-name"] = "Enter your full name.";
      if (!normalizeShuttlePhone(fields.get("phone"))) errors["guest-phone"] = "Enter a valid phone number, including your country code outside the US.";
      const email = String(fields.get("email") || "").trim();
      if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) errors["guest-email"] = "Enter a valid email, or leave it blank.";
      if (fields.get("guestConsent") !== "on") errors["guest-guestConsent"] = "Agree to share your details with the club to continue.";
      setFieldErrors({ ...fieldErrors, ...errors });
      setGuestError("Check your details below before joining the guest list.");
      return;
    }
    guestPending.current = true; setGuestBusy(true);
    try { await prepareAdmissionPass(issuedMethod || (complete && choice === "club_shuttle" ? "club_shuttle" : "guest_list"), guest); setComplete(true); }
    catch (reason) { setGuestError(reason instanceof Error ? reason.message : "Unable to join the guest list. Please try again."); }
    finally { guestPending.current = false; setGuestBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!showingArrivalForm && !showingShuttleForm) || !choice || choice === "rideshare_taxi" || pending.current || guestPending.current || complete || (choice === "club_shuttle" && !shuttleAvailable)) return;
    setError("");
    if (choice !== "club_shuttle") {
      pending.current = true; setBusy(true);
      try { await prepareAdmissionPass(choice); setComplete(true); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to generate your pass."); }
      finally { pending.current = false; setBusy(false); }
      return;
    }
    const fields = new FormData(event.currentTarget);
    const contactPhone = normalizeShuttlePhone(fields.get("phone"));
    if (!contactPhone) {
      setFieldErrors({ ...fieldErrors, "pickup-phone": "Enter a valid contact phone number, including the country code for numbers outside the US." });
      return;
    }
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
      setComplete(true);
      try { await prepareAdmissionPass("club_shuttle"); }
      catch (reason) { setPassError(reason instanceof Error ? reason.message : "Your pickup request was sent, but your pass could not be generated."); }
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "The connection timed out. Retry to check the same request without sending duplicate alerts.");
    } finally { pending.current = false; setBusy(false); }
  }

  return <main className={`club-transport-page${deal ? " is-free-entry" : ""}`}>
    <section className="club-transport-card" aria-labelledby="club-transport-heading">
      <Link className="club-transport-back" href={`/venues/${encodeURIComponent(venue.slug)}`}>‹ {venue.name} details</Link>
      <header className="club-entry-header">
        <div className="club-entry-brand">
          {venue.logoImageUrl && !logoFailed ? <img src={venue.logoImageUrl} alt="" width={48} height={48} onError={() => setLogoFailed(true)} /> : <EntryIcon kind="club" />}
          <div><span className="club-entry-eyebrow">MyDancr admission</span><p className="club-entry-venue">{venue.name}</p></div>
        </div>
        <h1 id="club-transport-heading" ref={heading} tabIndex={-1}>{complete ? passMethod === "club_shuttle" ? "Pickup requested" : "Your admission pass is ready" : deal ? "Free Entry" : "Request a free ride"}</h1>
        {!complete ? <p className="club-entry-intro">{deal ? "Choose how you’d like to get your pass." : "Send your pickup details directly to the club."} No sign-in needed.</p> : null}
      </header>
      {deal && !complete ? <div className="club-entry-essentials">
        <span>One guest per admission pass</span>
        {offerHours ? <span>Offer hours: {offerHours} · club local time</span> : null}
      </div> : null}
      {deal ? <ol className="club-entry-steps" aria-label="Free entry progress">
        {["Choose", "Details", "Pass"].map((label, index) => {
          const step = complete && passUrl ? 2 : expandedSection || complete ? 1 : 0;
          return <li key={label} aria-current={index === step ? "step" : undefined} data-complete={index < step}><span>{index + 1}</span>{label}</li>;
        })}
      </ol> : null}
      {!deal ? <p className="club-transport-terms">Free entry is currently unavailable. You can still request a free ride.</p> : null}
      {complete ? <div className="club-entry-complete" aria-live="polite">
        {passMethod === "guest_list" ? <p>Your guest-list details have been sent to {venue.name}.</p> : passMethod === "club_shuttle" ? <div className="club-transport-confirmation" role="status">
          <span className="club-entry-status is-pending">Request sent</span>
          <p><strong>Awaiting club confirmation</strong></p>
          <p>{message || "The club will call you to arrange and confirm pickup."}</p>
          <p className="club-transport-note">Your ride is not booked yet.</p>
        </div> : autonomousArrival ? <>
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
        {deal ? <div className="club-transport-ready">
          <p>{passMethod === "guest_list" ? "Show your admission pass to door staff. Staff verifies your guest-list admission and scans the pass for free entry." : "Show your admission pass to door staff. Staff verifies your arrival method and scans the pass for free entry."}</p>
          {passUrl ? <Link className="club-transport-submit" href={passUrl}>Show admission pass</Link> : <button className="club-transport-submit" type="button" disabled={busy} onClick={retryPass}>{busy ? "Generating pass…" : "Get admission pass"}</button>}
          {passError ? <p role="alert">{passError} Your pickup request will not be sent again.</p> : null}
          <p className="club-transport-note">One admission per pass. Each guest needs their own pass. Keep your pass link to reopen it at the door.</p>
        </div> : null}
      </div> : <>
        <form id="club-transport-form" onSubmit={submit} aria-labelledby="club-transport-heading">
          {deal ? <section className="club-entry-option">
            <h2><button className="club-entry-toggle" type="button" aria-expanded={showingArrivalForm} aria-controls="club-arrival-form" data-entry-option="arrival" disabled={busy || guestBusy || !!attemptedRequest.current} onClick={() => toggleForm("arrival")}>
              <EntryIcon kind="arrival" /><span className="club-entry-toggle-copy"><strong>Arriving on your own</strong><small>Choose your arrival method</small></span><EntryChevron />
            </button></h2>
            <fieldset className="club-entry-form" id="club-arrival-form" hidden={!showingArrivalForm} disabled={!showingArrivalForm || busy || guestBusy}>
          <fieldset className="club-transport-options">
            <legend>How will you arrive?</legend>
            <label className={arrivalChoice === "self_drive" ? "selected" : ""}><input required type="radio" name="transportation" value="self_drive" checked={arrivalChoice === "self_drive"} onChange={() => { setArrivalChoice("self_drive"); setError(""); }} /><span><strong>Private car</strong><small>Eligible for free entry</small></span></label>
            {AUTONOMOUS_ADMISSION_OPTIONS.map(option => <label key={option.value} className={arrivalChoice === option.value ? "selected" : ""}><input required type="radio" name="transportation" value={option.value} checked={arrivalChoice === option.value} onChange={() => { setArrivalChoice(option.value); setError(""); }} /><span><strong>{option.label}</strong><small>Free entry. Ride fare not included.</small></span></label>)}
            <label className={choice === "rideshare_taxi" ? "selected" : ""}><input required type="radio" name="transportation" value="rideshare_taxi" checked={choice === "rideshare_taxi"} onChange={chooseRideshare} /><span><strong>Other rideshare or taxi</strong><small>Uber, Lyft, and other taxis don’t qualify.</small></span></label>
          </fieldset>
          {arrivalChoice === "rideshare_taxi" ? <div className="club-transport-ineligible" role="status"><strong>This arrival method does not qualify for free entry.</strong><p>Choose free club transport to qualify when you arrive in the club’s vehicle.</p><button className="club-transport-submit" type="button" onClick={() => toggleForm("club_shuttle")}>Request free club transport</button></div> : null}
          {showingArrivalForm && error ? <p role="alert" className="club-transport-error">{error}</p> : null}
          {showingArrivalForm && arrivalChoice !== "rideshare_taxi" ? <button className="club-transport-submit" type="submit" disabled={!arrivalChoice || busy} aria-busy={busy}>{busy ? "Generating pass…" : "Get free entry pass"}</button> : null}
            </fieldset>
          </section> : null}
          <section className="club-entry-option">
            <h2><button className="club-entry-toggle" type="button" aria-expanded={showingShuttleForm} aria-controls="club-shuttle-form" data-entry-option="club_shuttle" disabled={busy || guestBusy || !!attemptedRequest.current} onClick={() => toggleForm("club_shuttle")}>
              <EntryIcon kind="transport" /><span className="club-entry-toggle-copy"><strong>Free club transport</strong><small>{deal ? "Request pickup and get your entry pass" : "Request a free pickup"}</small></span><EntryChevron />
            </button></h2>
            <fieldset className="club-entry-form" id="club-shuttle-form" hidden={!showingShuttleForm} disabled={!showingShuttleForm || busy || guestBusy}>
            <p className="club-transport-handoff">Your ride is confirmed only when the club accepts. They’ll call to arrange pickup.</p>
            {!shuttleAvailable ? <p className="club-transport-availability" role="status">Shuttle requests are currently unavailable at this club.</p> : null}
            <div className="club-transport-fields">
              <div className="club-entry-field-group"><h3>Pickup details</h3>
                <label>Pickup location<input {...fieldFeedback("pickup", "location")} name="location" autoComplete="street-address" placeholder="Hotel or address, city and entrance" required minLength={5} maxLength={300} readOnly={busy || !!attemptedRequest.current} />{fieldError("pickup", "location")}</label>
                <label>Guests for pickup<input {...fieldFeedback("pickup", "partySize")} name="partySize" type="number" inputMode="numeric" required min={1} max={100} step={1} defaultValue={1} readOnly={busy || !!attemptedRequest.current} />{fieldError("pickup", "partySize")}</label>
              </div>
              <div className="club-entry-field-group"><h3>Contact details</h3>
                <label>Name<input {...fieldFeedback("pickup", "name")} name="name" autoComplete="name" required minLength={2} maxLength={100} readOnly={busy || !!attemptedRequest.current} />{fieldError("pickup", "name")}</label>
                <label>Phone<input {...fieldFeedback("pickup", "phone")} name="phone" type="tel" autoComplete="tel" placeholder="(555) 555-0123" onChange={formatContactPhoneInput} onCompositionEnd={formatContactPhoneInput} required maxLength={40} readOnly={busy || !!attemptedRequest.current} />{fieldError("pickup", "phone")}</label>
                <label>Email<input {...fieldFeedback("pickup", "email")} name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} readOnly={busy || !!attemptedRequest.current} />{fieldError("pickup", "email")}</label>
              </div>
              <label className="club-transport-consent"><input {...fieldFeedback("pickup", "handoffAccepted")} name="handoffAccepted" type="checkbox" required onClick={event => { if (busy || attemptedRequest.current) event.preventDefault(); }} /><span>I agree to share my details with {venue.name} to arrange pickup.{fieldError("pickup", "handoffAccepted")}</span></label>
            </div>
          {showingShuttleForm && error ? <p role="alert" className="club-transport-error">{error}</p> : null}
          {showingShuttleForm ? <button className="club-transport-submit" type="submit" disabled={busy || !shuttleAvailable} aria-busy={busy}>{busy ? "Sending to the club…" : attemptedRequest.current ? "Retry shuttle request" : "Request free pickup"}</button> : null}
            </fieldset>
          </section>
        </form>
      </>}
    {deal ? <section className="club-entry-option club-guest-list-section" aria-labelledby="club-guest-list-heading">
      <h2 id="club-guest-list-heading"><button className="club-entry-toggle" type="button" aria-expanded={guestOpen} aria-controls="club-guest-list-panel" data-entry-option="guest_list" disabled={guestBusy || busy || (!complete && !!attemptedRequest.current)} onClick={toggleGuestList}>
        <EntryIcon kind="guest" /><span className="club-entry-toggle-copy"><strong>Guest list</strong><small>{guestListJoined ? "Your details are with the club" : "Join the list. Cover may apply."}</small></span><EntryChevron />
      </button></h2>
      {guestListJoined ? <p role="status">You’re on the guest list. Your details are saved with {venue.name}.</p> : null}
      <div id="club-guest-list-panel" hidden={!guestOpen}>
        {!guestListJoined ? <>
          <p>One guest per form. Use the name you’ll give at the door.</p>
          <form id="club-guest-list-form" onSubmit={submitGuestList} aria-labelledby="club-guest-list-heading">
            <fieldset className="club-entry-form" disabled={!guestOpen || guestBusy || busy}>
              <div className="club-transport-fields">
                <label>Full name<input {...fieldFeedback("guest", "name")} name="name" autoComplete="name" required minLength={2} maxLength={100} readOnly={guestBusy} />{fieldError("guest", "name")}</label>
                <label>Phone<input {...fieldFeedback("guest", "phone")} name="phone" type="tel" autoComplete="tel" placeholder="(555) 555-0123" onChange={formatContactPhoneInput} onCompositionEnd={formatContactPhoneInput} required maxLength={40} readOnly={guestBusy} />{fieldError("guest", "phone")}</label>
                <label>Email (optional)<input {...fieldFeedback("guest", "email")} name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} readOnly={guestBusy} />{fieldError("guest", "email")}</label>
                <label className="club-transport-consent"><input {...fieldFeedback("guest", "guestConsent")} name="guestConsent" type="checkbox" required disabled={guestBusy} /><span>I agree to share my details with {venue.name} for the guest list.{fieldError("guest", "guestConsent")}</span></label>
              </div>
              {guestError ? <p role="alert" className="club-transport-error">{guestError}</p> : null}
              <button className="club-transport-submit" type="submit" disabled={guestBusy || busy} aria-busy={guestBusy}>{guestBusy ? "Joining guest list…" : "Join guest list"}</button>
            </fieldset>
          </form>
        </> : null}
      </div>
    </section> : null}
      {!complete && deal ? <p className="club-transport-note">Each guest needs their own pass. Staff verify admission requirements. Capacity, age, dress code, and house rules apply.</p> : null}
      {!complete && deal && deal.dealTerms ? <details className="club-transport-note club-entry-terms"><summary>Entry details<EntryChevron /></summary>
        {deal.dealTerms ? <p>{deal.dealTerms}</p> : null}
      </details> : null}
    </section>
  </main>;
}
