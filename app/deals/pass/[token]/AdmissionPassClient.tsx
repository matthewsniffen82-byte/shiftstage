"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { admissionOfferHours, clubArrivalLabel, CLUB_ARRIVAL_VERIFICATION } from "@/src/lib/dancr/club-deal-transportation";
import { customerFacingDealTerms } from "@/src/lib/dancr/deal-copy";

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
  const status = pass.status === "redeemed" ? "Already redeemed" : expired || pass.status === "expired" ? "Pass expired" : usable ? "Show this pass to door staff" : "Pass unavailable";
  const terms = customerFacingDealTerms(pass.deal?.dealTerms);
  return <section className={`deal-pass-card${usable ? "" : " unavailable"}`}>
    <span className="eyebrow">MyDancr admission pass</span>
    <h1>{pass.deal?.dealTitle || "Free admission"}</h1>
    <p>{pass.venue?.name}</p>
    <strong role="status">{status}</strong>
    {usable ? <>
      {/* A server-generated QR with a reserved white quiet zone for phone cameras. */}
      <img src={qrImage} width={320} height={320} className="admission-qr" alt="Your admission QR code for venue staff to scan" />
      <small>One admission. Staff scans and confirms this pass at the door.</small>
    </> : null}
    <p className="admission-method">Arrival: {clubArrivalLabel(pass.arrivalMethod)}</p>
    <small>Valid until {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: pass.venue?.timezone || "UTC" }).format(new Date(pass.expiresAt))}</small>
    <small>{CLUB_ARRIVAL_VERIFICATION}</small>
    {admissionOfferHours(pass.deal) ? <small>Offer hours: {admissionOfferHours(pass.deal)} (venue local time)</small> : null}
    {terms ? <small>{terms}</small> : null}
    <small>Capacity, age requirements, dress code, offer hours, and house rules apply.</small>
    {usable ? <button className="deal-pass-continue" onClick={async () => {
      try { await navigator.clipboard.writeText(window.location.href); setMessage("Pass link copied. Keep it private and open it when you arrive."); }
      catch { setMessage("Bookmark this page to keep your pass."); }
    }}>Copy pass link</button> : null}
    {message ? <small role="status">{message}</small> : null}
    <Link className="deal-pass-continue" href="/?view=venues">Back to clubs</Link>
  </section>;
}
