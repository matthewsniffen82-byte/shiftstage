import type { Metadata } from "next";
import LegalDocument from "../components/LegalDocument";
import document from "@/src/content/legal/user-terms.json";

export const metadata: Metadata = {
  title: "Terms of Use | mydancr",
  description: "MyDancr's user terms and conditions for using the service.",
};

export default function TermsPage() {
  return <LegalDocument document={document} />;
}
