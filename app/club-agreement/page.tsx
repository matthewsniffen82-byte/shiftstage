import type { Metadata } from "next";
import LegalDocument from "../components/LegalDocument";
import document from "@/src/content/legal/club-agreement.json";

export const metadata: Metadata = {
  title: "Club Agreement | mydancr",
  description: "The MyDancr Club Agreement governing participating clubs and club services.",
};

export default function ClubAgreementPage() {
  return <LegalDocument document={document} />;
}
