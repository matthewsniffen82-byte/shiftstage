import type { Metadata } from "next";
import { AccessGateForm } from "./AccessGateForm";
import "./site-access.css";

export const metadata: Metadata = {
  title: "Private access | mydancr",
  description: "Enter the private access code to continue to mydancr.",
  robots: { index: false, follow: false },
};

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="site-access-page">
      <section className="site-access-card" aria-labelledby="site-access-title">
        <div className="site-access-brand" aria-label="mydancr">
          mydancr
        </div>
        <span className="site-access-eyebrow">Private access</span>
        <h1 id="site-access-title">Enter your access code</h1>
        <p>
          This production site is currently limited to invited visitors. Enter
          the code you received to continue.
        </p>
        <AccessGateForm returnTo={params.return || "/"} />
        <small>Access is stored securely on this device for seven days.</small>
      </section>
    </main>
  );
}
