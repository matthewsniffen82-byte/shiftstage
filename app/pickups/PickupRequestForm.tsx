"use client";
import { offerPushNotifications } from "@/src/lib/dancr/push-invitation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PICKUP_CHAT_NOTICE, PICKUP_CHAT_POLICY, PICKUP_CONSENT_VERSION, PICKUP_TRANSPORT_NOTICE, type PickupVenue } from "@/src/lib/dancr/pickup-domain";
import { CLUB_TRANSPORTATION_TERMS } from "@/src/lib/dancr/club-deal-transportation";
import { PickupAccountGate, pickupSessionIdentity, requestPickupJson } from "./pickup-session";
import { guestPickupHref, newGuestPickupKey, rememberGuestPickup } from "@/src/lib/dancr/pickup-guest-session";

type RequestProps = { venue: PickupVenue; embedded?: boolean; returnTo?: string; saveAdmission?: (requestId: string) => boolean; onBusyChange?: (busy: boolean) => void };
export default function PickupRequestForm(props: RequestProps) {
  return <PickupAccountGate customerOnly allowGuest returnTo={props.returnTo}>{() => <RequestForm {...props} />}</PickupAccountGate>;
}
function RequestForm({ venue, embedded = false, saveAdmission, onBusyChange }: RequestProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [createdId, setCreatedId] = useState("");
  const pending = useRef<{ id: string; fingerprint: string; key: string } | null>(null), locked = useRef(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  function openConversation(id: string) {
    if (saveAdmission && !saveAdmission(id)) { setBusy(false); return; }
    router.replace(guestPickupHref(id, pending.current?.key || ""));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked.current) return;
    const data = new FormData(event.currentTarget);
    const fields = { venueId: venue.id, location: String(data.get("location") || ""), locationDetails: String(data.get("locationDetails") || ""),
      partySize: Number(data.get("partySize")), notes: String(data.get("notes") || ""), consentVersion: PICKUP_CONSENT_VERSION };
    if (!data.get("consent")) { setError("Agree to the pickup chat notice to continue."); return; }
    const fingerprint = JSON.stringify(fields);
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = {
      id: crypto.randomUUID(), fingerprint, key: pickupSessionIdentity() ? "" : newGuestPickupKey(),
    };
    locked.current = true; setBusy(true); setError("");
    try {
      const { id, key } = pending.current;
      if (key) rememberGuestPickup({ id, key, venue: venue.name, savedAt: Date.now() });
      const result = await requestPickupJson("/api/pickups", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-pickup-guest-key": key } : {}) }, body: JSON.stringify({ ...fields, requestId: id }) });
      setCreatedId(result.id);
      offerPushNotifications("customer-pickup");
      openConversation(result.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to request pickup. Retry to check the same request."); locked.current = false; setBusy(false); }
  }
  if (createdId) return <section className="pickup-card" aria-live="polite">
    <h2>Pickup requested</h2><p>Your ride still needs venue confirmation. Message {venue.name} and follow pickup updates in your chat.</p>
    {!busy && <><p role="alert">Your request was sent, but your free-entry selection could not be saved. Allow site storage and retry, or open your chat now.</p>
      <button className="pickup-primary" onClick={() => openConversation(createdId)}>Save free entry and open chat</button></>}
    <Link prefetch={false} className="pickup-primary" href={guestPickupHref(createdId, pending.current?.key || "")}>Message {venue.name}</Link>
  </section>;
  return <section className="pickup-card pickup-request">
    {!embedded && <><Link href={`/?venue=${encodeURIComponent(venue.slug)}`}>‹ {venue.name}</Link><h1>Request Club Pickup</h1></>}
    <p className="pickup-request-intro">Your ride needs club confirmation. Chat opens after you send.{!pickupSessionIdentity() && <> <strong>No sign-in needed.</strong></>}</p>
    <form className="pickup-form" onSubmit={submit}>
      <fieldset disabled={busy}><legend className="pickup-visually-hidden">Pickup details</legend>
        <div className="pickup-request-fields">
          <label>Pickup location<input name="location" required minLength={3} maxLength={300} autoComplete="off" placeholder="Hotel or address" /></label>
          <label>Party size<input name="partySize" type="number" inputMode="numeric" required min={1} max={30} defaultValue={1} /></label>
        </div>
        <details className="pickup-request-options">
          <summary>Add pickup details <span>(optional)</span></summary>
          <div>
            <label><span>Meeting spot <small>(optional)</small></span><input name="locationDetails" maxLength={500} autoComplete="off" placeholder="Lobby or pickup entrance" /></label>
            <label><span>Note to the club <small>(optional)</small></span><textarea name="notes" maxLength={1000} rows={2} /></label>
          </div>
        </details>
        <section className="pickup-request-consent" aria-label="Pickup chat consent">
          <p id="pickup-consent-summary">Pickup chat only. MyDancr stores messages and may monitor or review them.</p>
          <details className="pickup-request-terms">
            <summary>Pickup &amp; chat terms</summary>
            <p>{PICKUP_TRANSPORT_NOTICE}</p><p>{PICKUP_CHAT_NOTICE}</p><p>{PICKUP_CHAT_POLICY}</p>
            {!pickupSessionIdentity() && <p>Save your private chat link to return on another device.</p>}
            {saveAdmission && <>
              <p>Free entry is saved for 12 hours. On arrival, have staff verify your club transport, then tap the MyDancr sticker at the cashier.</p>
              <p>{CLUB_TRANSPORTATION_TERMS}</p>
              <p>One free general admission per guest. Capacity, age requirements, dress code, and house rules apply.</p>
            </>}
          </details>
          <label className="pickup-check"><input name="consent" type="checkbox" required aria-describedby="pickup-consent-summary" /><span>I agree to the pickup &amp; chat terms.</span></label>
        </section>
        <button className="pickup-primary" type="submit">{busy ? "Sending request…" : "Request pickup"}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
