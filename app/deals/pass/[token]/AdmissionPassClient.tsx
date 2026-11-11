"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { admissionOfferHours, isAdmissionOfferOpen, clubArrivalLabel, clubDealTransportationTerms, guestListAdmissionTerms } from "@/src/lib/dancr/club-deal-transportation";
import { customerFacingDealTerms, customerFacingDealTitle } from "@/src/lib/dancr/deal-copy";
import AdmissionPassSaveButton from "./AdmissionPassSaveButton";

export default function AdmissionPassClient({ token, initialRedemption, qrImage }: { token: string; initialRedemption: any; qrImage: string }) {
  const [pass, setPass] = useState(initialRedemption);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  const expiresAt = Date.parse(pass.expiresAt);
  const expired = expiresAt <= now;
  const offerHours = admissionOfferHours(pass.deal);
  useEffect(() => {
    if (pass.status !== "generated" || expired) return;
    const tick = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    const expiryTimer = window.setTimeout(tick, Math.max(0, expiresAt - Date.now()));
    const scheduleTimer = offerHours ? window.setInterval(tick, 1000) : undefined;
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearTimeout(expiryTimer); window.clearInterval(scheduleTimer); document.removeEventListener("visibilitychange", tick); };
  }, [pass.status, expired, expiresAt, offerHours]);
  useEffect(() => {
    if (pass.status !== "generated" || expired) return;
    let controller: AbortController | null = null;
    let stopped = false;
    let nextRead = Date.now() + 30_000;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || controller || Date.now() < nextRead) return;
      nextRead = Date.now() + 30_000;
      controller = new AbortController();
      const deadline = window.setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch(`/api/deals/redeem/${token}`, { cache: "no-store", signal: controller.signal });
        if (stopped) return;
        if (response.status === 429) {
          const retry = Number(response.headers.get("retry-after")) || 60;
          nextRead = Date.now() + Math.max(30, retry) * 1000;
          return;
        }
        if (response.status === 404) {
          setPass((current: typeof initialRedemption) => ({ ...current, status: "unavailable" }));
          return;
        }
        const data = await response.json();
        if (!stopped && response.ok && data.redemption) setPass(data.redemption);
      } catch { /* The venue scanner validates the live pass even if this phone is offline. */ }
      finally { window.clearTimeout(deadline); controller = null; }
    };
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { stopped = true; window.clearInterval(timer); controller?.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [token, pass.status, expired]);
  const available = pass.isAdmissionPass && pass.status === "generated" && !expired && pass.deal?.isActive;
  const usable = available && isAdmissionOfferOpen(pass.deal, pass.venue?.timezone || "UTC", now);
  const status = pass.status === "redeemed" ? "Already redeemed" : expired || pass.status === "expired" ? "Pass expired" : usable ? "Ready to use" : available ? "Outside offer hours" : "Pass unavailable";
  const guestListPass = pass.arrivalMethod === "guest_list";
  const terms = (guestListPass ? guestListAdmissionTerms : clubDealTransportationTerms)(customerFacingDealTerms(pass.deal?.dealTerms)
    || "Capacity, age requirements, dress code, offer hours, and house rules apply.");
  return <section className={`deal-pass-card${usable ? "" : " unavailable"}`}>
    <header className="admission-header">
      <span className="eyebrow">MyDancr admission</span>
      <p className="admission-venue">{pass.venue?.name}</p>
      <h1>{guestListPass ? "Guest list" : customerFacingDealTitle(pass.deal?.dealTitle || "Free Entry")}</h1>
    </header>
    <strong className="admission-status" role="status">{status}</strong>
    {usable ? <>
      {/* A server-generated QR with a reserved white quiet zone for phone cameras. */}
      <img src={qrImage} width={320} height={320} className="admission-qr" alt="Your admission QR code for club staff to scan" />
      <p className="admission-instruction">Show this at the door</p>
    </> : null}
    <div className="admission-facts">
      <span>1 guest · {clubArrivalLabel(pass.arrivalMethod)}</span>
      <span>Expires {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: pass.venue?.timezone || "UTC" }).format(new Date(pass.expiresAt))}</span>
    </div>
    {offerHours ? <small>Offer hours: {offerHours} (club local time)</small> : null}
    <small>{guestListPass ? "Staff verifies guest-list registration. The club determines any cover charge." : "Staff verifies arrival. Club rules apply."}</small>
    <details className="admission-details">
      <summary>Entry details<span aria-hidden="true">⌄</span></summary>
      <p>{terms}</p>
    </details>
    <div className="admission-actions">
      {usable ? <AdmissionPassSaveButton key={token} qrImage={qrImage} venueName={pass.venue?.name || "Club"}
        title={guestListPass ? "Guest list" : customerFacingDealTitle(pass.deal?.dealTitle || "Free Entry")}
        arrivalLabel={clubArrivalLabel(pass.arrivalMethod)} expiresAt={pass.expiresAt}
        timezone={pass.venue?.timezone || "UTC"} offerHours={offerHours} /> : null}
      {usable ? <button className="deal-pass-continue is-secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(window.location.href); setMessage("Pass link copied. Keep it private."); }
      catch { setMessage("Bookmark this page to keep your pass."); }
    }}>Copy pass link</button> : null}
      <Link className="deal-pass-continue is-secondary" href="/?view=venues">Back to clubs</Link>
    </div>
    {message ? <small role="status">{message}</small> : null}
  </section>;
}
