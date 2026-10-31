"use client";
import { useRef, useState } from "react";
import { PRIVACY_RIGHTS } from "@/src/lib/dancr/public-case-intake";
import "@/app/components/public-case-form.css";
export default function PrivacyRequestForm() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ reference: string; receivedAt: string } | null>(null);
  const pending = useRef(false);
  if (receipt) return <section className="case-confirmation" role="status"><h2>Privacy request received</h2><p>Case reference: <strong>{receipt.reference}</strong></p><p>Received: {new Date(receipt.receivedAt).toLocaleString()}</p><p>We will review the request and contact you at the email you supplied about any information reasonably needed to locate the records or verify identity or authority. Opt-outs of sale/sharing and sensitive-use limitations do not require identity verification.</p><p>For covered California requests to know, correct, or delete, we confirm receipt and provide handling information within 10 business days and generally respond within 45 days of receipt. Different periods apply to other rights. Any permitted extension will be explained before the initial response period ends.</p><p>This receipt does not mean your data has already been disclosed, changed, or deleted. Save your reference and include it in follow-up messages to <a href="mailto:support@mydancr.com">support@mydancr.com</a>.</p></section>;
  return <form className="public-case-form" onSubmit={async event => {
    event.preventDefault(); if (pending.current) return;
    const body = Object.fromEntries(new FormData(event.currentTarget));
    pending.current = true; setSaving(true); setError("");
    try {
      const response = await fetch("/api/privacy-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.reference) throw new Error(data.error || "The request could not be confirmed.");
      setReceipt(data);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to submit request."); }
    finally { pending.current = false; setSaving(false); }
  }}><fieldset disabled={saving}>
    <label>Request type<select name="right" required defaultValue=""><option value="">Choose a request</option>{PRIVACY_RIGHTS.map(right => <option key={right}>{right}</option>)}</select></label>
    <label>Contact email<input name="contactEmail" type="email" required maxLength={254} autoComplete="email" /></label>
    <label>Country and state or region of residence<input name="jurisdiction" required maxLength={160} /></label>
    <label>Who are you acting for?<textarea name="authority" required maxLength={1000} rows={2} placeholder="Myself, or explain who you represent and your authority" /></label>
    <label>Details to help locate the record and understand your request<textarea name="details" required maxLength={2000} rows={4} placeholder="For example, account email or profile name and what you want changed" /></label>
    <label>Previous case reference (optional)<input name="previousReference" maxLength={100} /></label>
    <p>MyDancr does not sell personal information or share it for cross-context behavioral advertising. You can still contact us about these rights. Submitting this form does not subscribe you to marketing.</p>
    <button type="submit">{saving ? "Submitting…" : "Submit privacy request"}</button>
  </fieldset>{error ? <p role="alert">{error}</p> : null}</form>;
}
