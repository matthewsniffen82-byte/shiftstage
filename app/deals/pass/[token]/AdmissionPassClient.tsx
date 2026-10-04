"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { admissionOfferHours, clubArrivalLabel, clubDealTransportationTerms, guestListAdmissionTerms } from "@/src/lib/dancr/club-deal-transportation";
import { customerFacingDealTerms, customerFacingDealTitle } from "@/src/lib/dancr/deal-copy";

export default function AdmissionPassClient({ token, initialRedemption, qrImage }: { token: string; initialRedemption: any; qrImage: string }) {
  const [pass, setPass] = useState(initialRedemption);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  useEffect(() => {
    let controller: AbortController | null = null;
    let stopped = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || controller) return;
      setNow(Date.now());
      controller = new AbortController();
      try {
        const response = await fetch(`/api/deals/redeem/${token}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!stopped && response.ok && data.redemption) setPass(data.redemption);
      } catch { /* The venue scanner validates the live pass even if this phone is offline. */ }
      finally { controller = null; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { stopped = true; window.clearInterval(timer); controller?.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [token]);
  const expired = Date.parse(pass.expiresAt) <= now;
  const usable = pass.isAdmissionPass && pass.status === "generated" && !expired && pass.deal?.isActive;
  const status = pass.status === "redeemed" ? "Already redeemed" : expired || pass.status === "expired" ? "Pass expired" : usable ? "Ready to use" : "Pass unavailable";
  const guestListPass = pass.arrivalMethod === "guest_list";
  const terms = (guestListPass ? guestListAdmissionTerms : clubDealTransportationTerms)(customerFacingDealTerms(pass.deal?.dealTerms)
    || "Capacity, age requirements, dress code, offer hours, and house rules apply.");
  return <section className={`deal-pass-card${usable ? "" : " unavailable"}`}>
    <header className="admission-header">
      <span className="eyebrow">MyDancr admission</span>
      <p className="admission-venue">{pass.venue?.name}</p>
      <h1>{customerFacingDealTitle(pass.deal?.dealTitle || "Free Entry")}</h1>
    </header>
    <strong className="admission-status" role="status">{status}</strong>
    {usable ? <>
      {/* A server-generated QR with a reserved white quiet zone for phone cameras. */}
      <img src={qrImage} width={320} height={320} className="admission-qr" alt="Your admission QR code for venue staff to scan" />
      <p className="admission-instruction">Show this at the door</p>
    </> : null}
    <div className="admission-facts">
      <span>1 guest · {clubArrivalLabel(pass.arrivalMethod)}</span>
      <span>Expires {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: pass.venue?.timezone || "UTC" }).format(new Date(pass.expiresAt))}</span>
    </div>
    {admissionOfferHours(pass.deal) ? <small>Offer hours: {admissionOfferHours(pass.deal)} (venue local time)</small> : null}
    <small>{guestListPass ? "Staff verifies guest-list admission. Venue rules apply." : "Staff verifies arrival. Venue rules apply."}</small>
    <details className="admission-details">
      <summary>Entry details<span aria-hidden="true">⌄</span></summary>
      <p>{terms}</p>
    </details>
    <div className="admission-actions">
      {usable ? <button className="deal-pass-continue" onClick={async () => {
      try { await navigator.clipboard.writeText(window.location.href); setMessage("Pass link copied. Keep it private."); }
      catch { setMessage("Bookmark this page to keep your pass."); }
    }}>Copy pass link</button> : null}
      <Link className="deal-pass-continue is-secondary" href="/?view=venues">Back to clubs</Link>
    </div>
    {message ? <small role="status">{message}</small> : null}
  </section>;
}
