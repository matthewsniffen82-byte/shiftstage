import type { Metadata } from "next";
import Link from "next/link";
import LegalDocument from "../components/LegalDocument";
import document from "@/src/content/legal/privacy.json";

export const metadata: Metadata = {
  title: "Privacy Policy | mydancr",
  description: "MyDancr's Privacy Policy and information about your privacy rights.",
};

export default function PrivacyPage() {
  return <LegalDocument document={document}>California residents: read our <Link href="/privacy/california">California Privacy Notice</Link>.</LegalDocument>;
}
