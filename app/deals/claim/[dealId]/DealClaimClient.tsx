"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClubDeal } from "@/src/lib/dancr/types";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";

const SESSION_KEY = "dancrAuthSessionV1";
const DEAL_SESSION_KEY = "mydancrDealSessionV1";

export default function DealClaimClient({ campaignToken, deal }: { campaignToken: string; deal: ClubDeal }) {
  const started = useRef(false);
  const [status, setStatus] = useState("Creating your unique tracked Club Deal QR…");
  const [failed, setFailed] = useState(false);

  const claimDeal = useCallback(async () => {
    setFailed(false);
    setStatus("Creating your unique tracked Club Deal QR…");
    try {
      const session = readCustomerSession();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (session.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
      const response = await fetch("/api/deals/redemptions", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({
          clubDealId: deal.id,
          venueId: deal.venueId,
          sourceType: "club_page",
          campaignToken,
          sessionId: readOrCreateDealSessionId(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.redemption?.redemptionToken) {
        throw new Error(data.error || "Unable to create this Club Deal QR.");
      }
      window.location.replace(`/deals/pass/${encodeURIComponent(data.redemption.redemptionToken)}`);
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : "Unable to create this Club Deal QR.");
    }
  }, [campaignToken, deal.id, deal.venueId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void claimDeal();
  }, [claimDeal]);

  return (
    <main className="deal-claim-page">
      <style>{`
        body { margin: 0; background: #050507; color: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .deal-claim-page { min-height: 100vh; display: grid; place-items: center; padding: 20px; box-sizing: border-box; background: radial-gradient(circle at 50% 10%, rgba(124,58,237,.24), transparent 26rem), #050507; }
        .deal-claim-card { width: min(100%, 500px); display: grid; justify-items: center; gap: 14px; padding: clamp(24px, 7vw, 42px); box-sizing: border-box; border: 1px solid #334155; border-radius: 22px; background: #111118; text-align: center; box-shadow: 0 28px 90px rgba(0,0,0,.62); }
        .deal-claim-card::before { content: ""; width: 56px; height: 5px; border-radius: 999px; background: #7c3aed; box-shadow: 0 0 18px rgba(124,58,237,.48); }
        .deal-claim-card span { color: #c4b5fd; font-size: 12px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
        .deal-claim-card h1 { margin: 0; color: #f8fafc; font-size: clamp(30px, 8vw, 48px); line-height: 1; }
        .deal-claim-card p { margin: 0; color: #cbd5e1; line-height: 1.55; }
        .deal-claim-card button, .deal-claim-card a { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; padding: 0 20px; border: 1px solid rgba(124,58,237,.72); border-radius: 999px; color: #f8fafc; background: #7c3aed; font: inherit; font-weight: 900; text-decoration: none; cursor: pointer; }
        .deal-claim-card a { border-color: #334155; background: transparent; }
      `}</style>
      <section className="deal-claim-card" aria-live="polite">
        <span>MyDancr Club Deal</span>
        <h1>{deal.dealTitle}</h1>
        <p>{status}</p>
        {failed ? (
          <>
            <button type="button" onClick={claimDeal}>Try again</button>
            <Link href={homeDiscoveryHref("venues")}>Browse current Club Deals</Link>
          </>
        ) : null}
      </section>
    </main>
  );
}

function readCustomerSession() {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "null");
    return {
      accessToken: session?.account?.role === "customer" && typeof session?.accessToken === "string"
        ? session.accessToken
        : "",
    };
  } catch {
    return { accessToken: "" };
  }
}

function readOrCreateDealSessionId() {
  try {
    const existing = window.localStorage.getItem(DEAL_SESSION_KEY) || "";
    if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(DEAL_SESSION_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}
