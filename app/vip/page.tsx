import VipClient from "./VipClient";
import "./vip.css";

export const metadata = { title: "VIP Lounge | MyDancr", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function VipPage({ searchParams }: { searchParams: Promise<{ venueId?: string }> }) {
  const { venueId = "" } = await searchParams;
  return <VipClient initialVenueId={typeof venueId === "string" ? venueId : ""} />;
}
