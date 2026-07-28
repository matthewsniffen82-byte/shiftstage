import type { Metadata } from "next";
import Link from "next/link";
import DmcaCounterForm from "./DmcaCounterForm";

export const metadata: Metadata = {
  title: "DMCA Counter-Notice | mydancr",
  description: "Review a MyDancr copyright removal and submit a legally complete counter-notice.",
};

type PageProps = { params: Promise<{ id: string }> };

export default async function DmcaCounterPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="counter-shell">
      <CounterStyles />
      <nav>
        <Link className="brand" href="/">mydancr</Link>
        <Link href="/dmca">Copyright policy</Link>
      </nav>
      <header>
        <span>Copyright case</span>
        <h1>Counter-notice</h1>
        <p>
          A counter-notice is a legal request to restore material removed because of mistake or
          misidentification. Submit one only if every required statement is true.
        </p>
      </header>
      <DmcaCounterForm caseId={id} />
    </main>
  );
}

function CounterStyles() {
  return (
    <style>{`
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #050507; color: #f7f2ff; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      a { color: #8ceaff; }
      button, input, textarea { font: inherit; }
      .counter-shell { width: min(820px, 100%); min-height: 100vh; margin: 0 auto; padding: 24px 18px 48px; }
      .counter-shell nav { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 46px; }
      .counter-shell nav a { color: #d8cfeb; text-decoration: none; font-weight: 850; }
      .counter-shell .brand { color: #fff; font-size: 24px; font-weight: 950; letter-spacing: -.04em; }
      .counter-shell header { display: grid; gap: 11px; margin-bottom: 22px; }
      .counter-shell header span { color: #8ceaff; font-size: 13px; font-weight: 950; letter-spacing: .14em; text-transform: uppercase; }
      .counter-shell h1 { margin: 0; font-size: clamp(38px, 7vw, 62px); letter-spacing: -.055em; }
      .counter-shell header p, .counter-card p, .counter-card li { color: #c6bbd7; line-height: 1.55; }
      .counter-card { display: grid; gap: 16px; padding: 22px; border: 1px solid rgba(139,92,246,.28); border-radius: 18px; background: linear-gradient(145deg, rgba(18,15,29,.94), rgba(7,7,11,.96)); }
      .counter-card h2, .counter-card h3 { margin: 0; }
      .counter-summary { display: grid; gap: 9px; padding: 14px; border: 1px solid rgba(255,255,255,.09); border-radius: 12px; background: rgba(255,255,255,.035); }
      .counter-summary div { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 10px; }
      .counter-summary span { color: #9387a8; font-weight: 850; }
      .counter-summary strong, .counter-summary a { overflow-wrap: anywhere; }
      .counter-form { display: grid; gap: 15px; }
      .counter-form label { display: grid; gap: 7px; color: #e5dff0; font-size: 14px; font-weight: 800; }
      .counter-form input, .counter-form textarea { width: 100%; min-height: 46px; padding: 11px 13px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; outline: 0; color: #fff; background: rgba(255,255,255,.055); }
      .counter-form textarea { min-height: 108px; resize: vertical; }
      .counter-form input:focus, .counter-form textarea:focus { border-color: #35d8ff; box-shadow: 0 0 0 3px rgba(53,216,255,.13); }
      .counter-check { display: grid !important; grid-template-columns: 22px minmax(0, 1fr); align-items: start; gap: 10px !important; color: #c6bbd7 !important; font-weight: 650 !important; line-height: 1.45; }
      .counter-check input { width: 20px; min-height: 20px; margin: 1px 0 0; accent-color: #35d8ff; }
      .counter-submit { min-height: 50px; border: 0; border-radius: 999px; color: #06070a; background: linear-gradient(90deg, #35d8ff, #9b7bff); font-weight: 950; cursor: pointer; }
      .counter-submit:disabled { opacity: .58; cursor: wait; }
      .counter-status { margin: 0; padding: 12px 14px; border: 1px solid rgba(140,234,255,.28); border-radius: 10px; color: #bff7ff !important; background: rgba(53,216,255,.08); }
      .counter-status.error { border-color: rgba(255,104,124,.38); color: #ffbdc8 !important; background: rgba(255,104,124,.09); }
      @media (max-width: 650px) {
        .counter-shell { padding: 18px 12px 40px; }
        .counter-card { padding: 16px; border-radius: 14px; }
        .counter-summary div { grid-template-columns: 1fr; gap: 3px; }
      }
    `}</style>
  );
}
