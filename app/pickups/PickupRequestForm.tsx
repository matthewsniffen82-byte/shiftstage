"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PICKUP_CHAT_NOTICE, PICKUP_CHAT_POLICY, PICKUP_CONSENT_VERSION, PICKUP_TRANSPORT_NOTICE, type PickupVenue } from "@/src/lib/dancr/pickup-domain";
import { PickupAccountGate, requestPickupJson } from "./pickup-session";

export default function PickupRequestForm({ venue }: { venue: PickupVenue }) {
  return <PickupAccountGate customerOnly>{() => <RequestForm venue={venue} />}</PickupAccountGate>;
}
function RequestForm({ venue }: { venue: PickupVenue }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<{ id: string; fingerprint: string } | null>(null), locked = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked.current) return;
    const data = new FormData(event.currentTarget);
    const fields = { venueId: venue.id, location: String(data.get("location") || ""), locationDetails: String(data.get("locationDetails") || ""),
      partySize: Number(data.get("partySize")), notes: String(data.get("notes") || ""), consentVersion: PICKUP_CONSENT_VERSION };
    if (!data.get("consent")) { setError("Agree to the pickup chat notice to continue."); return; }
    const fingerprint = JSON.stringify(fields);
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { id: crypto.randomUUID(), fingerprint };
    locked.current = true; setBusy(true); setError("");
    try {
      const result = await requestPickupJson("/api/pickups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields, requestId: pending.current.id }) });
      router.replace(`/pickups/${result.id}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to request pickup. Retry to check the same request."); locked.current = false; setBusy(false); }
  }
  return <section className="pickup-card">
    <Link href={`/?venue=${encodeURIComponent(venue.slug)}`}>‹ {venue.name}</Link>
    <h1>Request Club Pickup</h1><p>Send your pickup request directly to {venue.name}. The venue will confirm whether pickup is available.</p>
    <form className="pickup-form" onSubmit={submit}>
      <fieldset disabled={busy}><legend className="pickup-visually-hidden">Pickup details</legend>
        <label>Pickup location<input name="location" required minLength={3} maxLength={300} autoComplete="off" placeholder="Hotel or meeting location" /></label>
        <label>Meeting details <small>(optional)</small><input name="locationDetails" maxLength={500} autoComplete="off" placeholder="Lobby or pickup entrance" /></label>
        <label>Party size<input name="partySize" type="number" inputMode="numeric" required min={1} max={30} defaultValue={1} /></label>
        <label>Short note <small>(optional)</small><textarea name="notes" maxLength={1000} rows={3} /></label>
        <p className="pickup-notice">{PICKUP_TRANSPORT_NOTICE}</p>
        <section className="pickup-notice" aria-labelledby="pickup-consent-title"><h2 id="pickup-consent-title">MyDancr Pickup Chat</h2><p>{PICKUP_CHAT_NOTICE}</p><p>{PICKUP_CHAT_POLICY}</p>
          <label className="pickup-check"><input name="consent" type="checkbox" required />Agree &amp; Continue</label>
        </section>
        <button className="pickup-primary" type="submit">{busy ? "Sending request…" : "Request Pickup From Venue"}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
