"use client";
import { useEffect, useRef, useState } from "react";
import SafetyReportForm from "@/app/components/SafetyReportForm";
import type { SafetyDetails } from "@/src/lib/dancr/public-case-intake";
export default function PublicSafetyIntake() {
  const [target, setTarget] = useState({ targetType: "contact_message", targetId: "", targetLabel: "Safety report" });
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; createdAt: string } | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetType = params.get("targetType") || "";
    const targetId = params.get("targetId") || "";
    if (["dancer_profile", "profile_photo", "tv_video", "venue", "shift"].includes(targetType) && /^[a-f0-9-]{36}$/i.test(targetId)) {
      setTarget({ targetType, targetId, targetLabel: (params.get("targetLabel") || "Reported content").slice(0,160) });
    }
    setReady(true);
  }, []);
  async function submit(details: SafetyDetails) {
    if (pending.current) return;
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...target, ...details, caseKind: "safety" }) });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.report?.id) throw new Error(data.error || "The report could not be confirmed.");
      setReceipt(data.report);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to submit report."); }
    finally { pending.current = false; setSaving(false); }
  }
  if (receipt) return <section className="case-confirmation" role="status"><h2>Report received</h2><p>Case reference: <strong>{receipt.id}</strong></p><p>Received: {new Date(receipt.createdAt).toLocaleString()}</p><p>Save this reference. For follow-up, email <a href="mailto:support@mydancr.com">support@mydancr.com</a> and include it. Your report is awaiting review; this confirmation does not mean the content has been removed.</p><a href="/report-harmful-content/submit">Report other content</a></section>;
  if (!ready) return <p>Loading report form…</p>;
  return <>{target.targetId ? <p>Reporting: {target.targetLabel}. If this content is unavailable, <a href="/report-harmful-content/submit">describe its location instead</a>.</p> : null}<SafetyReportForm onSubmit={submit} saving={saving} error={error} hasTarget={Boolean(target.targetId)} /></>;
}
