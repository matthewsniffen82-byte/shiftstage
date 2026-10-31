"use client";
import { useRef, useState } from "react";
import { SAFETY_REASONS, type SafetyDetails } from "@/src/lib/dancr/public-case-intake";
import "./public-case-form.css";

export default function SafetyReportForm({ onSubmit, saving, error, hasTarget = false }: {
  onSubmit: (details: SafetyDetails) => void; saving: boolean; error?: string; hasTarget?: boolean;
}) {
  const [reason, setReason] = useState<string>("");
  const form = useRef<HTMLFormElement>(null);
  const intimate = reason === SAFETY_REASONS[0];
  return <form className="public-case-form" ref={form} onSubmit={(event) => {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) || "").trim();
    onSubmit({ reason, details: value("details"), contactEmail: value("contactEmail"), contentLocation: value("contentLocation"), requestedAction: value("requestedAction"), signature: value("signature"), authority: value("authority"), goodFaith: data.get("goodFaith") === "on" });
  }}>
    <p>No account is required. Do not upload or send intimate images, identity documents, or suspected child sexual abuse material. Describe where the content appears. You can also email <a href="mailto:support@mydancr.com">support@mydancr.com</a>.</p>
    <fieldset disabled={saving}>
      <label>Reason<select required name="reason" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Choose a reason</option>{SAFETY_REASONS.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Content location {hasTarget ? "(additional detail, optional)" : ""}<textarea name="contentLocation" required={!hasTarget} maxLength={1500} rows={2} placeholder="Link, profile name, club, or other information that helps us locate it" /></label>
      <label>Details (optional)<textarea name="details" maxLength={2000} rows={3} /></label>
      <label>Contact email {intimate ? "" : "(optional)"}<input name="contactEmail" type="email" autoComplete="email" required={intimate} maxLength={254} /><small>Used to follow up on this report. Without contact information we cannot send you a response.</small></label>
      <label>Requested action {intimate ? "" : "(optional)"}<input name="requestedAction" required={intimate} maxLength={1000} placeholder="For example, remove the content" /></label>
      {intimate ? <>
        <label>Your relationship to the person depicted<textarea name="authority" required maxLength={1000} rows={2} placeholder="I am the person depicted, or explain your authority to act for them" /></label>
        <label className="case-check"><input name="goodFaith" type="checkbox" required />I have a good-faith belief that this intimate depiction was published without the consent of the person depicted.</label>
        <label>Electronic signature<input name="signature" required maxLength={160} autoComplete="name" placeholder="Type your name" /></label>
        <p>A valid intimate-image removal request will be handled as soon as possible and no later than 48 hours after receipt, including reasonable efforts to remove known identical copies. You do not need to find those copies.</p>
      </> : null}
      <p>Review your information before submitting. Reports are reviewed by MyDancr; submission does not itself remove content.</p>
      <button type="submit">{saving ? "Submitting…" : "Submit report"}</button>
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}
