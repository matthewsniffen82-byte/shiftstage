import type { Metadata } from "next";
import Link from "next/link";
import "../components/legal-document.css";

export const metadata: Metadata = {
  title: "Legal & Privacy | mydancr",
  description: "Read MyDancr's privacy and copyright policies.",
};

export default function LegalPage() {
  return (
    <main className="legal-document-shell">
      <nav className="legal-document-nav" aria-label="Legal navigation">
        <Link className="legal-document-brand" href="/" aria-label="MyDancr home">mydancr</Link>
        <Link href="/">Back to MyDancr</Link>
      </nav>
      <header className="legal-document-header">
        <h1>Legal &amp; Privacy</h1>
      </header>
      <nav aria-label="Legal documents">
        <ul className="legal-document-list">
          <li><Link href="/privacy">Privacy Policy<span aria-hidden="true">›</span></Link></li>
          <li><Link href="/privacy/california">California Privacy<span aria-hidden="true">›</span></Link></li>
          <li><Link href="/dmca">Copyright / DMCA<span aria-hidden="true">›</span></Link></li>
        </ul>
      </nav>
    </main>
  );
}
