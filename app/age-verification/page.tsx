import type { Metadata } from "next";
import { getYotiAgeVerificationPublicState } from "@/src/lib/dancr/yoti-age-verification";
import { AgeVerificationClient } from "./AgeVerificationClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Age verification | mydancr",
  description: "Verify that you are 18 or older before entering MyDancr.",
  robots: { index: false, follow: false },
};

export default function AgeVerificationPage() {
  const state = getYotiAgeVerificationPublicState();
  return <AgeVerificationClient enabled={state.enabled} configured={state.configured} />;
}
