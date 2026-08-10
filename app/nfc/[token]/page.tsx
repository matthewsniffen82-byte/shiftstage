import type { Metadata } from "next";
import { NfcTapClient } from "./NfcTapClient";

export const metadata: Metadata = {
  title: "Venue NFC tap | MyDancr",
  description: "Complete a venue-verified MyDancr NFC action.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function NfcTapPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <NfcTapClient token={token} />;
}
