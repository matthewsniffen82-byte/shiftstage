import type { Metadata } from "next";
import Link from "next/link";
import DmcaNoticeForm from "./DmcaNoticeForm";
import { getPublicDmcaAgent } from "@/src/lib/dancr/dmca";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Copyright and DMCA | mydancr",
  description: "Submit and manage copyright notices for content hosted by MyDancr.",
};

export default async function DmcaPage() {
  const agent = await getPublicDmcaAgent(createAdminSupabaseClient());
  const address = [
    agent.addressLine1,
    agent.addressLine2,
    [agent.city, agent.stateRegion, agent.postalCode].filter(Boolean).join(" "),
    agent.country,
  ].filter(Boolean);

  return (
    <main className="dmca-shell">
      <DmcaStyles />
      <nav className="dmca-nav" aria-label="Copyright navigation">
        <Link className="dmca-brand" href="/">mydancr</Link>
        <Link href="/">Back to MyDancr</Link>
      </nav>

      <header className="dmca-hero">
        <span>Legal · Copyright</span>
        <h1>Copyright and DMCA</h1>
        <p>
          Use this page to submit a copyright removal notice for material hosted on MyDancr.
          Knowingly making a material misrepresentation may create legal liability.
        </p>
      </header>

      <section className="dmca-grid">
        <article className="dmca-card">
          <h2>Copyright contact</h2>
          <dl className="dmca-contact">
            <div><dt>Agent</dt><dd>{agent.legalName}</dd></div>
            {agent.organization ? <div><dt>Organization</dt><dd>{agent.organization}</dd></div> : null}
            <div><dt>Email</dt><dd><a href={`mailto:${agent.email}`}>{agent.email}</a></dd></div>
            {agent.phone ? <div><dt>Phone</dt><dd>{agent.phone}</dd></div> : null}
            {address.length ? <div><dt>Mailing address</dt><dd>{address.map((line) => <span key={line}>{line}</span>)}</dd></div> : null}
          </dl>
          <p className="dmca-note">
            The secure form below creates a trackable case and is the fastest way to send a notice.
          </p>
        </article>

        <article className="dmca-card">
          <h2>What happens next</h2>
          <ol>
            <li>MyDancr checks whether the notice contains the required statements and identifies hosted material.</li>
            <li>Valid notices result in prompt disabling of the identified material and notice to the uploader.</li>
            <li>The uploader may submit a legally complete counter-notice.</li>
            <li>
              After a counter-notice, content remains disabled for at least 10 business days and may be restored
              within 10–14 business days unless MyDancr receives notice of a filed court action.
            </li>
          </ol>
        </article>
      </section>

      <section className="dmca-card dmca-policy" id="repeat-infringer-policy">
        <h2>Repeat-infringer policy</h2>
        <p>
          MyDancr does not permit copyright infringement. A validated removal creates an active copyright strike.
          Accounts that accumulate three active strikes are suspended, their public profiles are disabled, and their
          videos are removed from public access. A strike is rescinded when content is restored after a valid
          counter-notice or when MyDancr determines the notice was mistaken. MyDancr may suspend or terminate an
          account sooner in appropriate circumstances, including deliberate or egregious infringement.
        </p>
      </section>

      <DmcaNoticeForm />

      <footer className="dmca-footer">
        <Link href="/">Home</Link>
        <span>·</span>
        <a href={`mailto:${agent.email}`}>Copyright contact</a>
      </footer>
    </main>
  );
}

function DmcaStyles() {
  return (
    <style>{`
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      a { color: #8ceaff; }
      button, input, textarea { font: inherit; }
      .dmca-shell { width: min(980px, 100%); margin: 0 auto; min-height: 100vh; padding: 24px 18px 48px; }
      .dmca-nav { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 46px; }
      .dmca-nav a { color: #d8cfeb; text-decoration: none; font-weight: 850; }
      .dmca-brand { color: #fff !important; font-size: 24px; font-weight: 950 !important; letter-spacing: -.04em; }
      .dmca-hero { display: grid; gap: 12px; margin-bottom: 28px; }
      .dmca-hero span { color: #8ceaff; font-size: 13px; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .dmca-hero h1 { margin: 0; font-size: clamp(36px, 7vw, 68px); line-height: .98; letter-spacing: -.055em; }
      .dmca-hero p { max-width: 760px; margin: 0; color: #c6bbd7; font-size: 17px; line-height: 1.55; }
      .dmca-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
      .dmca-card { display: grid; gap: 14px; padding: 22px; border: 1px solid rgba(139,92,246,.28); border-radius: 18px; background: linear-gradient(145deg, rgba(18,15,29,.94), rgba(7,7,11,.96)); box-shadow: 0 24px 60px rgba(0,0,0,.28); }
      .dmca-card h2 { margin: 0; font-size: 22px; }
      .dmca-card p, .dmca-card li { color: #c6bbd7; line-height: 1.55; }
      .dmca-card ol { display: grid; gap: 10px; margin: 0; padding-left: 22px; }
      .dmca-contact { display: grid; gap: 10px; margin: 0; }
      .dmca-contact div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; }
      .dmca-contact dt { color: #8f83a7; font-weight: 850; }
      .dmca-contact dd { display: grid; gap: 3px; margin: 0; color: #fff; overflow-wrap: anywhere; }
      .dmca-note { margin: 0; font-size: 13px; }
      .dmca-policy { margin-bottom: 16px; }
      .dmca-policy p { margin: 0; }
      .dmca-form { display: grid; gap: 18px; }
      .dmca-form fieldset { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 0; padding: 0; border: 0; }
      .dmca-form legend { grid-column: 1 / -1; width: 100%; margin-bottom: 4px; color: #8ceaff; font-size: 13px; font-weight: 950; letter-spacing: .12em; text-transform: uppercase; }
      .dmca-form label { display: grid; gap: 7px; color: #e5dff0; font-size: 14px; font-weight: 800; }
      .dmca-form label.wide { grid-column: 1 / -1; }
      .dmca-form input, .dmca-form textarea { width: 100%; min-height: 46px; padding: 11px 13px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; outline: 0; color: #fff; background: rgba(255,255,255,.055); }
      .dmca-form textarea { min-height: 112px; resize: vertical; }
      .dmca-form input:focus, .dmca-form textarea:focus { border-color: #35d8ff; box-shadow: 0 0 0 3px rgba(53,216,255,.13); }
      .dmca-checks { display: grid; gap: 12px; }
      .dmca-check { display: grid !important; grid-template-columns: 22px minmax(0, 1fr); align-items: start; gap: 10px !important; color: #c6bbd7 !important; font-weight: 650 !important; line-height: 1.45; }
      .dmca-check input { width: 20px; min-height: 20px; margin: 1px 0 0; accent-color: #35d8ff; }
      .dmca-submit { min-height: 50px; border: 0; border-radius: 999px; color: #06070a; background: linear-gradient(90deg, #35d8ff, #9b7bff); font-weight: 950; cursor: pointer; }
      .dmca-submit:disabled { opacity: .58; cursor: wait; }
      .dmca-status { margin: 0; padding: 12px 14px; border: 1px solid rgba(140,234,255,.28); border-radius: 10px; color: #bff7ff !important; background: rgba(53,216,255,.08); }
      .dmca-status.error { border-color: rgba(255,104,124,.38); color: #ffbdc8 !important; background: rgba(255,104,124,.09); }
      .dmca-case-result { display: grid; gap: 8px; padding: 16px; border: 1px solid rgba(50,255,164,.3); border-radius: 12px; background: rgba(50,255,164,.08); }
      .dmca-case-result strong { color: #8dffc4; }
      .dmca-case-result code { color: #fff; overflow-wrap: anywhere; }
      .dmca-footer { display: flex; justify-content: center; gap: 10px; padding-top: 28px; color: #756c87; }
      .dmca-honeypot { position: absolute !important; left: -10000px !important; width: 1px !important; height: 1px !important; overflow: hidden !important; }
      @media (max-width: 700px) {
        .dmca-shell { padding: 18px 12px 40px; }
        .dmca-nav { margin-bottom: 34px; }
        .dmca-grid, .dmca-form fieldset { grid-template-columns: 1fr; }
        .dmca-form label.wide, .dmca-form legend { grid-column: auto; }
        .dmca-card { padding: 17px; border-radius: 14px; }
        .dmca-contact div { grid-template-columns: 1fr; gap: 3px; }
      }
    `}</style>
  );
}
