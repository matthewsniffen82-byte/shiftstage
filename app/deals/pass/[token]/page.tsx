import Link from "next/link";
import QRCode from "qrcode";
import AdmissionPassClient from "./AdmissionPassClient";
import { publicAppUrl } from "@/src/lib/dancr/public-app-url";
import { notFound } from "next/navigation";
import { getRedemptionForScanner } from "@/src/lib/dancr/deals";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function ClubDealPassPage({ params }: PageProps) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(token)) notFound();

  const admin = createAdminSupabaseClient();
  const redemption = await getRedemptionForScanner(admin, token);
  if (!redemption?.deal || !redemption.venue) notFound();

  const qrImage = await QRCode.toDataURL(new URL(`/deals/redeem/${token}`, publicAppUrl()).toString(), { width: 640, margin: 4, errorCorrectionLevel: "M" });

  return (
    <main className="deal-pass-page">
      <DealPassStyles />
      <nav>
        <Link href="/">Mydancr</Link>
        <Link href={homeDiscoveryHref("venues")}>Clubs</Link>
      </nav>
      <AdmissionPassClient token={token} initialRedemption={redemption} qrImage={qrImage} />
    </main>
  );
}

function DealPassStyles() {
  return (
    <style>{`
      body:has(> .deal-pass-page) { margin: 0; }
      .deal-pass-page { min-height: 100dvh; display: grid; align-content: start; gap: 16px; padding: 24px 16px calc(104px + env(safe-area-inset-bottom,0px)); box-sizing: border-box; background: radial-gradient(ellipse at 50% 0,#1a1026,transparent 480px),#050507; color: #f8fafc; }
      .deal-pass-page > nav { width: min(100%,440px); margin: 0 auto; display: flex; justify-content: space-between; gap: 14px; }
      .deal-pass-page > nav a { min-height: 44px; display: inline-flex; align-items: center; color: #c8bed6; font-size: 13px; font-weight: 500; text-decoration: none; }
      body .deal-pass-page .deal-pass-card { width: min(100%,440px); margin: 0 auto; display: grid; justify-items: center; gap: 16px; padding: 24px; box-sizing: border-box; border: 1px solid #51405f !important; border-radius: 16px !important; background: #100d15 !important; box-shadow: 0 12px 36px #0005 !important; text-align: center; overflow-wrap: anywhere; }
      body .deal-pass-page .deal-pass-card.unavailable { border-color: #403b48 !important; }
      .admission-header { display: grid; gap: 6px; }
      .deal-pass-page .eyebrow { color: #b99aea; font-size: 10px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; }
      .deal-pass-page .deal-pass-card h1 { margin: 0; color: #f8fafc; font-size: 30px; font-weight: 650; line-height: 1.15; letter-spacing: -.5px; }
      .deal-pass-page .admission-header .admission-venue { margin: 4px 0 0; color: #e0d9e9; font-size: 17px; font-weight: 500; }
      .deal-pass-page .admission-status { display: flex; align-items: center; gap: 6px; color: #7fdbac; font-size: 12px; font-weight: 550; }
      .admission-status::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .deal-pass-page .unavailable .admission-status { color: #e7c291; }
      .deal-pass-page .admission-qr { display: block; width: 280px; max-width: 100%; height: auto; border-radius: 8px; background: #fff; }
      .deal-pass-page .deal-pass-card .admission-instruction { margin: 0; color: #fff; font-size: 16px; font-weight: 600; }
      .deal-pass-page .admission-facts { display: grid; gap: 6px; color: #ded7e7; font-size: 13px; line-height: 1.5; }
      .deal-pass-page .deal-pass-card small { max-width: 42ch; color: #bfc0cc; font-size: 12px; line-height: 1.5; }
      .deal-pass-page .admission-details { width: 100%; border-top: 1px solid #35303d; text-align: left; font-size: 13px; }
      .admission-details summary { min-height: 48px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; list-style: none; color: #d7c8e9; }
      .admission-details summary::-webkit-details-marker { display: none; }
      .admission-details summary > span { color: #b99aea; font-size: 20px; }
      .admission-details[open] summary > span { transform: rotate(180deg); }
      .deal-pass-page .admission-details p { margin: 0; padding-bottom: 12px; color: #bfc0cc; font-size: 12px; line-height: 1.6; }
      .deal-pass-page :is(a,button,summary):focus-visible { outline: 2px solid #b99aea; outline-offset: 3px; }
      .deal-pass-page .admission-actions { width: 100%; display: grid; grid-template-columns: minmax(0,1fr); gap: 8px; }
      body .deal-pass-page .deal-pass-card .deal-pass-continue { box-sizing: border-box; min-height: 48px; display: flex; align-items: center; justify-content: center; width: 100%; margin: 0; padding: 12px; border: 1px solid #9465d1 !important; border-radius: 10px !important; background: linear-gradient(115deg,#6833c7,#5022a3) !important; color: #fff !important; font: inherit; font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; }
      body .deal-pass-page .deal-pass-card .deal-pass-continue.is-secondary { border-color: #403747 !important; background: #18131e !important; color: #d2c9df !important; }
      @media(max-width:480px) { .deal-pass-page { padding-inline: 12px; } body .deal-pass-page .deal-pass-card { padding: 20px 16px; } }
    `}</style>
  );
}
