import type { Metadata } from "next";
import Link from "next/link";
import LegalDocument from "../../components/LegalDocument";
import document from "@/src/content/legal/california-privacy.json";

export const metadata: Metadata = {
  title: "California Privacy Notice | mydancr",
  description: "MyDancr's supplemental privacy notice for California residents.",
};

export default function CaliforniaPrivacyPage() {
  return <LegalDocument document={document}>This notice supplements the <Link href="/privacy">Privacy Policy</Link>.</LegalDocument>;
}
