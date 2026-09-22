import type { Metadata } from "next";
import LegalDocument from "../components/LegalDocument";
import document from "@/src/content/legal/dmca.json";

export const metadata: Metadata = {
  title: "Copyright and DMCA | mydancr",
  description: "MyDancr's copyright policy, infringement notifications, and counter notifications.",
};

export default function DmcaPage() {
  return <LegalDocument document={document} />;
}
