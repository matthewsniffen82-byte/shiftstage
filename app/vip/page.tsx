import VipClient from "./VipClient";
import "./vip.css";

export const metadata = { title: "VIP Lounge | MyDancr", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function VipPage() { return <VipClient />; }
