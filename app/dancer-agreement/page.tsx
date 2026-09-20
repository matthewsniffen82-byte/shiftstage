import type { Metadata } from "next";
import Link from "next/link";
import LegalDocument from "../components/LegalDocument";
import document from "@/src/content/legal/dancer-agreement.json";

export const metadata: Metadata = {
  title: "Dancer Agreement | mydancr",
  description: "The MyDancr Dancer Agreement governing dancer accounts and use of the service.",
};

export default function DancerAgreementPage() {
  return <LegalDocument document={document} showDownload={false}>Read the related <Link href="/privacy">Privacy Policy</Link> and <Link href="/dmca">Copyright / DMCA policy</Link>.</LegalDocument>;
}
