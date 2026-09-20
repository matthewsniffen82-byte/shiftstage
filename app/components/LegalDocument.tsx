import Link from "next/link";
import type { ReactNode } from "react";
import "./legal-document.css";

type DocumentContent = {
  title: string;
  downloadHref: string;
  html: string;
  contents: { id: string; title: string }[];
};

export function LegalDocumentBody({ document }: { document: DocumentContent }) {
  return (
    <>
      <p className="legal-download"><a href={document.downloadHref} download>Download original Word document</a></p>
      <details className="legal-contents">
        <summary>On this page</summary>
        <nav aria-label={`${document.title} sections`}>
          {document.contents.map((item) => <a key={item.id} href={`#${item.id}`}>{item.title}</a>)}
        </nav>
      </details>
      {/* Static, escaped HTML generated only from the checked-in legal documents. */}
      <div className="legal-document-content" dangerouslySetInnerHTML={{ __html: document.html }} />
    </>
  );
}

export default function LegalDocument({ document, children }: { document: DocumentContent; children?: ReactNode }) {
  return (
    <main className="legal-document-shell">
      <nav className="legal-document-nav" aria-label="Legal navigation">
        <Link className="legal-document-brand" href="/">mydancr</Link>
        <Link href="/">Back to MyDancr</Link>
      </nav>
      <header className="legal-document-header"><span>Legal</span><h1>{document.title}</h1></header>
      {children ? <aside className="legal-related">{children}</aside> : null}
      <article aria-label={document.title}><LegalDocumentBody document={document} /></article>
      <footer className="legal-document-footer">
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/privacy/california">California Privacy Notice</Link>
        <Link href="/dancer-agreement">Dancer Agreement</Link>
        <Link href="/dmca">Copyright / DMCA</Link>
      </footer>
    </main>
  );
}
