"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./VenueClaim.module.css";

const SESSION_KEY = "dancrAuthSessionV1";

type Venue = {
  id: string;
  slug: string;
  name: string;
  city: string;
  isClaimable: boolean;
};

type Claim = {
  id: string;
  venueId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewNotes?: string | null;
  submittedAt: string;
  venue?: { name?: string; slug?: string } | null;
};

type StoredSession = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  account?: { role?: string; email?: string; displayName?: string; accountState?: string };
};

export default function VenueClaimForm({ venue }: { venue: Venue }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [isLoadingClaim, setIsLoadingClaim] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const stored = readSession();
    const venueSession = stored?.account?.role === "venue" ? stored : null;
    setSession(venueSession);
    if (!venueSession?.accessToken) {
      setIsLoadingClaim(false);
      return;
    }

    const controller = new AbortController();
    fetch("/api/venue/claims", {
      headers: { authorization: `Bearer ${venueSession.accessToken}` },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load your venue claim.");
        if (data.claim?.venueId === venue.id) setClaim(data.claim);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus(error instanceof Error ? error.message : "Unable to load your venue claim.");
      })
      .finally(() => setIsLoadingClaim(false));
    return () => controller.abort();
  }, [venue.id]);

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    setIsSubmitting(true);
    setStatus("Submitting your ownership claim securely…");
    try {
      const formData = new FormData(form);
      formData.set("venueId", venue.id);
      formData.set("venueSlug", venue.slug);
      const headers: HeadersInit = {};
      if (session?.accessToken) headers.authorization = `Bearer ${session.accessToken}`;
      const response = await fetch("/api/venue/claims", {
        method: "POST",
        headers,
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to submit venue claim.");

      if (data.session?.accessToken) {
        const nextSession = { ...data.session, account: data.account };
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
        setSession(nextSession);
      }
      setClaim(data.claim);
      setStatus(data.message || "Claim submitted for review.");
      form.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to submit venue claim.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingClaim) {
    return <section className={styles.card}><p className={styles.status}>Checking venue ownership…</p></section>;
  }

  if (claim) {
    const approved = claim.status === "approved";
    return (
      <section className={`${styles.card} ${styles.resultCard}`} aria-live="polite">
        <span className={styles.eyebrow}>{approved ? "Access approved" : claim.status === "pending" ? "Under review" : "Decision available"}</span>
        <h2>{approved ? `${venue.name} is connected` : claim.status === "pending" ? "Your claim was received" : "Your claim needs attention"}</h2>
        <p>
          {approved
            ? "You can now manage the existing venue card, Club Deal, QR, working-now lineup, and analytics."
            : claim.status === "pending"
              ? "Confirm your email if you have not already. MyDancr will review the business information and proof before granting access."
              : claim.reviewNotes || "The claim was not approved. Contact MyDancr support or submit a new claim with updated proof."}
        </p>
        {approved ? <Link className={styles.primaryLink} href="/dashboard/venue">Open venue dashboard</Link> : null}
        {claim.status === "rejected" ? (
          <button
            className={styles.primaryLink}
            type="button"
            onClick={() => {
              setClaim(null);
              setStatus("Add updated business proof and submit a new claim.");
            }}
          >
            Submit updated proof
          </button>
        ) : null}
        <Link className={styles.secondaryLink} href={`/?city=${encodeURIComponent(venue.city)}&venue=${encodeURIComponent(venue.slug)}`}>
          Return to {venue.name}
        </Link>
        {status ? <p className={styles.status}>{status}</p> : null}
      </section>
    );
  }

  if (!venue.isClaimable) {
    return (
      <section className={`${styles.card} ${styles.resultCard}`}>
        <span className={styles.eyebrow}>Already managed</span>
        <h2>This venue has a verified manager</h2>
        <p>If venue access needs to change, contact MyDancr support so ownership can be reviewed safely.</p>
        <a className={styles.secondaryLink} href="mailto:support@mydancr.com?subject=Venue%20access%20request">Contact MyDancr</a>
      </section>
    );
  }

  return (
    <form className={styles.card} onSubmit={submitClaim}>
      <div className={styles.formHeading}>
        <span className={styles.eyebrow}>Verification request</span>
        <h2>Create or connect a venue account</h2>
        <p>Use official business details. MyDancr will never publish the proof file.</p>
      </div>

      <div className={styles.grid}>
        <label>
          <span>Full legal name</span>
          <input name="claimantName" minLength={2} maxLength={160} autoComplete="name" required />
        </label>
        <label>
          <span>Position at venue</span>
          <input name="claimantTitle" minLength={2} maxLength={120} autoComplete="organization-title" required />
        </label>
        <label>
          <span>Business phone</span>
          <input name="claimantPhone" type="tel" minLength={7} maxLength={50} autoComplete="tel" required />
        </label>
        {session?.accessToken ? (
          <div className={styles.connectedAccount}>
            <strong>Signed-in venue account</strong>
            <span>{session.account?.email || "Verified account"}</span>
          </div>
        ) : (
          <>
            <label>
              <span>Official business email</span>
              <input name="email" type="email" maxLength={320} autoComplete="email" required />
            </label>
            <label className={styles.fullWidth}>
              <span>Create password</span>
              <input name="password" type="password" minLength={8} autoComplete="new-password" required />
              <small>At least 8 characters. You will confirm the email before approval.</small>
            </label>
          </>
        )}
        <label className={styles.fullWidth}>
          <span>Proof that you represent {venue.name}</span>
          <input name="proofFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />
          <small>PDF, JPEG, PNG, or WebP up to 10 MB—for example a business license, management letter, or venue document.</small>
        </label>
      </div>

      <label className={styles.attestation}>
        <input name="attested" type="checkbox" required />
        <span>I confirm that I am authorized to manage this venue and that the information submitted is accurate.</span>
      </label>

      <button className={styles.submit} type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Submitting securely…" : `Submit claim for ${venue.name}`}
      </button>
      <p className={styles.privacy}>Proof files are private and removed from storage after the claim is reviewed.</p>
      {status ? <p className={styles.status} role="status">{status}</p> : null}
    </form>
  );
}

function readSession(): StoredSession | null {
  try {
    const value = window.localStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
