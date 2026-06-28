import Link from "next/link";
import { notFound } from "next/navigation";
import { getRedemptionForScanner } from "@/src/lib/dancr/deals";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { RedeemDealClient } from "./RedeemDealClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function RedeemDealPage({ params }: PageProps) {
  const { token } = await params;
  const redemption = await getRedemptionForScanner(createAdminSupabaseClient(), token);
  if (!redemption) notFound();

  return (
    <main className="redeem-shell">
      <RedeemStyles />
      <nav>
        <Link href="/">Dancr</Link>
        <span>Club scanner</span>
      </nav>
      <RedeemDealClient token={token} initialRedemption={redemption} />
    </main>
  );
}

function RedeemStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .redeem-shell { min-height: 100vh; display: grid; align-content: center; gap: 24px; padding: 22px; background: radial-gradient(circle at 70% 0%, rgba(139,92,246,.22), transparent 24rem), linear-gradient(180deg, #090911, #050507 62%); }
      nav, .scanner-card { width: min(520px, 100%); margin: 0 auto; }
      nav { display: flex; justify-content: space-between; color: #b9accd; }
      nav a { color: #fff; text-decoration: none; text-transform: uppercase; font-weight: 950; letter-spacing: .08em; }
      .scanner-card { display: grid; gap: 16px; border: 1px solid rgba(139,92,246,.32); background: rgba(12,12,18,.9); border-radius: 8px; padding: clamp(18px, 5vw, 28px); box-shadow: 0 28px 80px rgba(0,0,0,.55); }
      .status-pill { width: max-content; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 6px 10px; color: #d8cfeb; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
      .status-pill.success { color: #94e5ff; border-color: rgba(148,229,255,.38); background: rgba(148,229,255,.08); }
      h1 { margin: 0; font-size: clamp(34px, 8vw, 56px); line-height: .96; }
      p, small, em, dt { margin: 0; color: #cfc5de; line-height: 1.5; }
      dl { display: grid; gap: 10px; margin: 0; }
      dl div { display: flex; justify-content: space-between; gap: 16px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 10px; }
      dd { margin: 0; color: #fff; font-weight: 900; text-align: right; }
      button { min-height: 48px; border: 0; border-radius: 8px; background: linear-gradient(135deg, #7c3aed, #22c7ff); color: #fff; font-weight: 950; font: inherit; cursor: pointer; }
      button:disabled { opacity: .62; cursor: default; }
      em { color: #94e5ff; font-style: normal; font-weight: 850; }
    `}</style>
  );
}
