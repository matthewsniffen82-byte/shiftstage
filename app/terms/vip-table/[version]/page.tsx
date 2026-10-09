import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ACCESS_TERMS_PARAGRAPHS, ACCESS_TERMS_TITLE, ACCESS_TERMS_VERSION } from "@/src/lib/dancr/access-terms";
import "../../../components/legal-document.css";

export const metadata: Metadata = { title: "VIP & Table Access Terms | MyDancr" };

export default async function AccessTermsPage({ params }: { params: Promise<{ version: string }> }) {
  if ((await params).version !== ACCESS_TERMS_VERSION) notFound();
  return <main className="legal-document-shell">
    <nav className="legal-document-nav" aria-label="Legal navigation"><Link href="/">Back to MyDancr</Link><Link href="/legal">Legal &amp; Privacy</Link></nav>
    <header className="legal-document-header"><span>Effective October 8, 2026</span><h1>{ACCESS_TERMS_TITLE}</h1></header>
    <article className="legal-document-content" aria-label={ACCESS_TERMS_TITLE}>
      {ACCESS_TERMS_PARAGRAPHS.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      <p><Link href="/privacy">Read the Privacy Policy</Link></p>
    </article>
  </main>;
}
