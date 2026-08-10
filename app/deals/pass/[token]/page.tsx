import Link from "next/link";
import { notFound } from "next/navigation";
import { getRedemptionForScanner } from "@/src/lib/dancr/deals";
import { homeDiscoveryHref } from "@/src/lib/dancr/navigation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

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

  const isExpired = new Date(redemption.expiresAt).getTime() <= Date.now();
  const isAvailable = false;

  return (
    <main className="deal-pass-page">
      <DealPassStyles />
      <nav>
        <Link href="/">Mydancr</Link>
        <Link href={homeDiscoveryHref("venues")}>Clubs</Link>
      </nav>
      <section className={isAvailable ? "deal-pass-card" : "deal-pass-card unavailable"}>
        <span className="eyebrow">Legacy Club Deal pass</span>
        <h1>{redemption.deal.dealTitle}</h1>
        <p>{redemption.venue.name}</p>
        <>
          <div className="nfc-retired" aria-hidden="true">)))</div>
          <strong>{legacyPassMessage(redemption.status, isExpired)}</strong>
          <small>MyDancr Club Deals now redeem through the club&apos;s physical cashier NFC sticker. Choose a current offer in MyDancr before tapping.</small>
          {redemption.deal.dealTerms ? <small>{redemption.deal.dealTerms}</small> : null}
          <Link className="primary-action" href={homeDiscoveryHref("venues")}>Find a current NFC Club Deal</Link>
        </>
      </section>
    </main>
  );
}

function legacyPassMessage(status: string, isExpired: boolean) {
  if (status === "redeemed") return "This Club Deal has already been redeemed.";
  if (status === "voided") return "This Club Deal is no longer valid.";
  if (isExpired || status === "expired") return "This Club Deal has expired.";
  return "This older QR pass cannot be redeemed. Use the cashier NFC flow instead.";
}

function DealPassStyles() {
  return (
    <style>{`
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .deal-pass-page { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; padding: 18px; box-sizing: border-box; background: radial-gradient(circle at 80% 5%, rgba(34,199,255,.2), transparent 24rem), radial-gradient(circle at 10% 20%, rgba(109,40,217,.3), transparent 28rem), #050507; }
      nav { width: min(100%, 620px); margin: 0 auto; display: flex; justify-content: space-between; gap: 14px; }
      nav a { color: #fff; font-weight: 950; text-decoration: none; }
      .deal-pass-card { width: min(100%, 520px); margin: auto; display: grid; justify-items: center; gap: 14px; padding: clamp(22px, 6vw, 38px); box-sizing: border-box; border: 1px solid rgba(126,234,255,.42); border-radius: 20px; background: rgba(10,8,18,.94); box-shadow: 0 30px 100px rgba(0,0,0,.72), 0 0 44px rgba(109,40,217,.18); text-align: center; }
      .deal-pass-card.unavailable { border-color: rgba(255,255,255,.16); }
      .eyebrow { color: #7eeaff; font-size: 11px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(32px, 8vw, 52px); line-height: .95; }
      p { margin: 0; color: #cfc5de; font-size: 18px; font-weight: 850; }
      .nfc-retired { width: 132px; aspect-ratio: 1; display: grid; place-items: center; border: 1px solid rgba(126,234,255,.35); border-radius: 50%; color: #fff; background: radial-gradient(circle, rgba(109,40,217,.55), rgba(9,7,17,.95)); box-shadow: 0 0 36px rgba(126,234,255,.16); font-size: 30px; font-weight: 950; letter-spacing: -8px; transform: rotate(-18deg); }
      strong { font-size: 18px; }
      small { max-width: 42ch; color: #b9accd; font-size: 13px; line-height: 1.45; }
      .primary-action { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; border-radius: 999px; color: #fff; background: linear-gradient(135deg, #6d28d9, #0b94c9); font-weight: 950; text-decoration: none; }
    `}</style>
  );
}
