"use client";

import { FormEvent, useState } from "react";

type SubmittedNotice = {
  id: string;
  status: string;
  confirmationSent: boolean;
};

export default function DmcaNoticeForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState<SubmittedNotice | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("");
    setNotice(null);

    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      claimantName: values.get("claimantName"),
      claimantCompany: values.get("claimantCompany"),
      claimantEmail: values.get("claimantEmail"),
      claimantPhone: values.get("claimantPhone"),
      claimantAddress: values.get("claimantAddress"),
      copyrightedWorkDescription: values.get("copyrightedWorkDescription"),
      originalWorkUrl: values.get("originalWorkUrl"),
      infringingUrl: values.get("infringingUrl"),
      signature: values.get("signature"),
      website: values.get("website"),
      goodFaithConfirmed: values.get("goodFaithConfirmed") === "on",
      accuracyConfirmed: values.get("accuracyConfirmed") === "on",
      authorityConfirmed: values.get("authorityConfirmed") === "on",
    };

    try {
      const response = await fetch("/api/dmca/notices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to submit copyright notice.");
      setNotice(data.notice);
      setStatus(data.message || "Copyright notice submitted.");
      form.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to submit copyright notice.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="dmca-card dmca-form" onSubmit={submit}>
      <h2>Submit a copyright removal notice</h2>
      <p>
        Submit only if you own the copyright or are authorized to act for the owner. All fields marked required
        are necessary to evaluate the notice.
      </p>

      <fieldset>
        <legend>Claimant information</legend>
        <label>
          Legal name
          <input name="claimantName" autoComplete="name" minLength={2} maxLength={160} required />
        </label>
        <label>
          Company, if applicable
          <input name="claimantCompany" autoComplete="organization" maxLength={160} />
        </label>
        <label>
          Email
          <input name="claimantEmail" type="email" autoComplete="email" maxLength={320} required />
        </label>
        <label>
          Phone
          <input name="claimantPhone" type="tel" autoComplete="tel" minLength={7} maxLength={50} required />
        </label>
        <label className="wide">
          Physical mailing address
          <textarea name="claimantAddress" autoComplete="street-address" minLength={10} maxLength={1000} required />
        </label>
      </fieldset>

      <fieldset>
        <legend>Copyrighted work and reported material</legend>
        <label className="wide">
          Describe the copyrighted work
          <textarea name="copyrightedWorkDescription" minLength={10} maxLength={4000} required />
        </label>
        <label className="wide">
          Original or authorized work URL, if available
          <input name="originalWorkUrl" type="url" inputMode="url" maxLength={2000} />
        </label>
        <label className="wide">
          Exact MyDancr URL containing the material
          <input
            name="infringingUrl"
            type="url"
            inputMode="url"
            maxLength={2000}
            required
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Required statements</legend>
        <div className="dmca-checks wide">
          <label className="dmca-check">
            <input name="goodFaithConfirmed" type="checkbox" required />
            <span>I have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.</span>
          </label>
          <label className="dmca-check">
            <input name="accuracyConfirmed" type="checkbox" required />
            <span>I state under penalty of perjury that the information in this notice is accurate.</span>
          </label>
          <label className="dmca-check">
            <input name="authorityConfirmed" type="checkbox" required />
            <span>I am the copyright owner or am authorized to act on behalf of the owner of an exclusive right allegedly infringed.</span>
          </label>
        </div>
        <label className="wide">
          Electronic signature — type your full legal name
          <input name="signature" autoComplete="name" minLength={2} maxLength={160} required />
        </label>
        <label className="dmca-honeypot" aria-hidden="true">
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </fieldset>

      <button className="dmca-submit" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Submitting secure notice…" : "Submit copyright notice"}
      </button>

      {status ? (
        <p className={`dmca-status${notice ? "" : " error"}`} role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
      {notice ? (
        <div className="dmca-case-result">
          <strong>Notice received</strong>
          <span>Case number</span>
          <code>{notice.id}</code>
          <span>
            {notice.confirmationSent
              ? "Keep this number. A confirmation was sent to the claimant email."
              : "Keep this number. The notice is saved, but email delivery could not be confirmed."}
          </span>
        </div>
      ) : null}
    </form>
  );
}
