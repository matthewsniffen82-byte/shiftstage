import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ACCESS_TERMS_HREF, ACCESS_TERMS_VERSION } from "@/src/lib/dancr/access-terms";
import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/vip-table-2026-10-30.json";
import "../../../components/legal-document.css";

export const metadata: Metadata = { title: "VIP & Table Access Terms | MyDancr" };

export default async function AccessTermsPage({ params }: { params: Promise<{ version: string }> }) {
  const version = (await params).version;
  if (version === ACCESS_TERMS_VERSION) return <LegalDocument document={document} />;
  if (version === "2026-10-08") permanentRedirect(ACCESS_TERMS_HREF);
  notFound();
}
