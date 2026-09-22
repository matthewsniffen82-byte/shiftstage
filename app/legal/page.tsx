import type { Metadata } from "next";
import Link from "next/link";
import "../components/legal-document.css";
import "./legal-hub.css";

export const metadata: Metadata = {
  title: "Legal & Privacy | mydancr",
  description: "Read MyDancr's privacy and copyright policies.",
};

export default function LegalPage() {
  return (
    <main className="legal-document-shell legal-hub">
      <nav className="legal-document-nav" aria-label="Legal navigation">
        <Link className="legal-document-brand" href="/" aria-label="MyDancr home">mydancr</Link>
        <Link className="legal-hub-back" href="/" aria-label="Back to MyDancr">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
          Back
        </Link>
      </nav>
      <header className="legal-document-header">
        <h1>Legal &amp; Privacy</h1>
        <p>Information about your privacy, rights, and content.</p>
      </header>
      <nav aria-label="Legal documents">
        <ul className="legal-hub-list">
          <li>
            <Link className="legal-hub-row" href="/privacy">
              <span className="legal-hub-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
              </span>
              <span className="legal-hub-copy"><strong>Privacy Policy</strong><span>How your information is used</span></span>
              <svg className="legal-hub-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </Link>
          </li>
          <li>
            <Link className="legal-hub-row" href="/privacy/california">
              <span className="legal-hub-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></svg>
              </span>
              <span className="legal-hub-copy"><strong>California Privacy</strong><span>Rights for California residents</span></span>
              <svg className="legal-hub-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </Link>
          </li>
          <li>
            <Link className="legal-hub-row" href="/dmca">
              <span className="legal-hub-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M15 9a4 4 0 1 0 0 6" /></svg>
              </span>
              <span className="legal-hub-copy"><strong>Copyright / DMCA</strong><span>Copyright notices and requests</span></span>
              <svg className="legal-hub-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
