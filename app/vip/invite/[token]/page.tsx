import VipClient from "../../VipClient";
import "../../vip.css";

export const metadata = { title: "Private VIP Invitation | MyDancr", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function VipInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VipClient token={token} />;
}
