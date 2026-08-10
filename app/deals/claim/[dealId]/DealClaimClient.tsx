"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ClubDeal } from "@/src/lib/dancr/types";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

const DEAL_INTENT_KEY = "mydancrPendingNfcDealV1";

export default function DealClaimClient({ deal }: { campaignToken: string; deal: ClubDeal }) {
  const [status, setStatus] = useState("Preparing this offer for cashier NFC…");

  useEffect(() => {
    try {
      window.localStorage.setItem(DEAL_INTENT_KEY, JSON.stringify({
        venueId: deal.venueId,
        dealId: deal.id,
        sourceType: "club_page",
        dancerId: null,
        attributionToken: null,
        savedAt: Date.now(),
      }));
      setStatus("Offer ready. At the venue, tap the physical MyDancr cashier NFC sticker to redeem it.");
    } catch {
      setStatus("Open this offer again at the venue, then tap the cashier NFC sticker.");
    }
  }, [deal.id, deal.venueId]);

  return (
    <main className="deal-claim-page">
      <style>{`
        body { margin: 0; background: #050507; color: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .deal-claim-page { min-height: 100vh; display: grid; place-items: center; padding: 20px; box-sizing: border-box; background: radial-gradient(circle at 50% 10%, rgba(124,58,237,.24), transparent 26rem), #050507; }
        .deal-claim-card { width: min(100%, 500px); display: grid; justify-items: center; gap: 14px; padding: clamp(24px, 7vw, 42px); box-sizing: border-box; border: 1px solid #334155; border-radius: 22px; background: #111118; text-align: center; box-shadow: 0 28px 90px rgba(0,0,0,.62); }
        .nfc-mark { width: 84px; aspect-ratio: 1; display: grid; place-items: center; border: 1px solid rgba(196,181,253,.45); border-radius: 50%; background: radial-gradient(circle, rgba(124,58,237,.58), rgba(17,17,24,.96)); font-size: 24px; font-weight: 950; letter-spacing: -7px; transform: rotate(-18deg); }
        .deal-claim-card span { color: #c4b5fd; font-size: 12px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
        .deal-claim-card h1 { margin: 0; color: #f8fafc; font-size: clamp(30px, 8vw, 48px); line-height: 1; }
        .deal-claim-card p { margin: 0; color: #cbd5e1; line-height: 1.55; }
        .deal-claim-card a { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; padding: 0 20px; border: 1px solid #334155; border-radius: 999px; color: #f8fafc; background: transparent; font: inherit; font-weight: 900; text-decoration: none; }
      `}</style>
      <section className="deal-claim-card" aria-live="polite">
        <div className="nfc-mark" aria-hidden="true">)))</div>
        <span>MyDancr cashier NFC</span>
        <h1>{deal.dealTitle}</h1>
        <p>{status}</p>
        <Link href={homeDiscoveryHref("venues")}>Browse current Club Deals</Link>
      </section>
    </main>
  );
}
