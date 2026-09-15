import { notFound } from "next/navigation";
import { pickupUuid } from "@/src/lib/dancr/pickup-validation";
import PickupConversation from "../PickupConversation";
export const dynamic = "force-dynamic";
export default async function PickupConversationPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  try { pickupUuid(requestId); } catch { notFound(); }
  return <PickupConversation requestId={requestId} />;
}
