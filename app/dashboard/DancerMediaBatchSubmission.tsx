"use client";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { requestDashboardJson } from "./dashboard-session";
import { subscribeDancerMediaStatus } from "./dancer-media-status";
import { mediaDraftSubmissionHint } from "./media-upload-feedback";
import type { MediaSubmissionDraft } from "@/src/lib/dancr/club-media-status";
import type { OnboardingMediaSubmission } from "@/src/lib/dancr/dancer-submission-media";
import "./dancer-upload-queue.css";
export type MediaBatchDraftCounts = { photos: number; videos: number };
export default function DancerMediaBatchSubmission({
  disabled, refreshKey, venueId, checkedIn = true, hasPendingMedia = false, venueName, uploadMessage = "", uploading = false, beforeAgreement = false,
  submissionHint = "", submissionBlocked = false, submissionHintNeedsAttention = false, onBusyChange, onDraftCountsChange, onDraftItemsChange, onSubmissionStatusChange, overviewTarget,
  onContinueToAgreement, continueToAgreementDisabled = false,
}: {
  disabled: boolean; refreshKey: string; venueId?: string; checkedIn?: boolean; hasPendingMedia?: boolean; beforeAgreement?: boolean;
  venueName?: string; uploadMessage?: string; uploading?: boolean; submissionHint?: string | ReactElement; submissionBlocked?: boolean; submissionHintNeedsAttention?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onSubmissionStatusChange?: (status: OnboardingMediaSubmission | null, error: string) => void;
  onDraftCountsChange?: (counts: MediaBatchDraftCounts | null) => void;
  onDraftItemsChange?: (items: MediaSubmissionDraft[] | null) => void;
  overviewTarget?: HTMLElement | null;
  onContinueToAgreement?: () => void;
  continueToAgreementDisabled?: boolean;
}) {
  const [drafts, setDrafts] = useState<MediaSubmissionDraft[]>([]);
  const [processing, setProcessing] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const reportBusy = useRef(onBusyChange);
  reportBusy.current = onBusyChange;
  useEffect(() => () => {
    if (mutation.current) { mutation.current.abort(); reportBusy.current?.(false); }
  }, []);
  const [count, setCount] = useState<number | null>(null), [waiting, setWaiting] = useState(false);
  const [waitingForClub, setWaitingForClub] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<{ key: string; value: OnboardingMediaSubmission | null; error: string; inFinalReview?: boolean } | null>(null);
  useEffect(() => {
    onSubmissionStatusChange?.(submissionStatus?.key === refreshKey ? submissionStatus.value : null,
      submissionStatus?.key === refreshKey ? submissionStatus.error : "");
  }, [submissionStatus, refreshKey, onSubmissionStatusChange]);
  useEffect(() => {
    if (!justSubmitted || busy) return;
    const timer = window.setTimeout(() => setJustSubmitted(false), 2500);
    return () => window.clearTimeout(timer);
  }, [justSubmitted, busy]);
  const submitting = useRef(false), read = useRef<AbortController | null>(null);
  const draftSignature = useRef("");
  const load = useCallback(async () => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller;
    try {
      const data = await requestDashboardJson("/api/media-batches", { expectedRole: "dancer", cache: "no-store", signal: controller.signal, headers: venueId ? { "x-dancer-media-venue": venueId } : {} });
      if (controller.signal.aborted) return false;
      const signature = JSON.stringify(data.draftItems || data.draftCount);
      if (!submitting.current && signature !== draftSignature.current) { setMessage(""); setJustSubmitted(false); }
      if (data.draftCount > 0) setJustSubmitted(false);
      draftSignature.current = signature;
      setDrafts(data.draftItems || []); setProcessing(data.processingCount || 0);
      setCount(data.draftCount); setWaiting(data.batches.some((b: { state: string }) => b.state !== "completed")); setWaitingForClub(data.waitingForClub === true); setError("");
      const inFinalReview = data.batches.some((batch: { state: string }) => batch.state === "admin");
      setSubmissionStatus({ key: refreshKey, value: data.onboardingMedia || null, error: "", inFinalReview });
      return true;
    } catch (e) { if (!controller.signal.aborted) {
      const message = e instanceof Error ? e.message : "Unable to load submission status.";
      setCount(null); setError(message); setSubmissionStatus({ key: refreshKey, value: null, error: message });
    } return false; }
    finally { if (read.current === controller) read.current = null; }
  }, [venueId, refreshKey]);
  useEffect(() => { if (!disabled) void load(); return () => read.current?.abort(); }, [disabled, refreshKey, load]);
  useEffect(() => {
    if (disabled || !hasPendingMedia || (count !== null && count > 0 && !processing)) return;
    // File preparation can finish without changing the profile's review status.
    // Recheck readiness directly, without interrupting a slow request or a submit.
    const refresh = () => {
      if (document.visibilityState === "visible" && !read.current && !submitting.current) return load();
      return false;
    };
    return subscribeDancerMediaStatus("batch", refresh, !(waiting || waitingForClub));
  }, [disabled, hasPendingMedia, count, waiting, waitingForClub, processing, load]);
  async function submit() {
    if (disabled || submissionBlocked || submitting.current || justSubmitted || !count || processing) return;
    // Onboarding submits media first; accepting the agreement is a separate step.
    setSubmissionStatus(null);
    submitting.current = true; read.current?.abort(); setBusy(true); setError(""); setMessage("");
    const controller = new AbortController(); mutation.current = controller; onBusyChange?.(true);
    try {
      const result = await requestDashboardJson("/api/media-batches", { expectedRole: "dancer", method: "POST", signal: controller.signal, headers: { "content-type": "application/json", ...(venueId ? { "x-dancer-media-venue": venueId } : {}) }, body: JSON.stringify({ action: "submit" }) });
      if (controller.signal.aborted) return;
      const submitted = result.submitted ?? count;
      if (submitted && !result.waitingForCheckIn) {
        setJustSubmitted(true); setDrafts([]); setCount(0); setWaiting(true);
      }
      setMessage(result.waitingForCheckIn ? `Saved for ${venueName || "this club"}—will send when you check in.`
        : submitted ? `${submitted} ${submitted === 1 ? "item submitted" : "items submitted together"}${venueName ? ` to ${venueName}. Awaiting approval` : " for approval"}.` : "No new items to submit.");
      window.dispatchEvent(new Event("mydancr:dancer-media-changed")); await load();
    } catch (e) { if (!controller.signal.aborted) {
      const message = e instanceof Error ? e.message : "Unable to submit updates. Try again.";
      setError(message); setSubmissionStatus({ key: refreshKey, value: null, error: message });
    } }
    finally { mutation.current = null; submitting.current = false; if (!controller.signal.aborted) { setBusy(false); onBusyChange?.(false); } }
  }
  const photos = drafts.filter(item => item.kind === "photo").length;
  const videos = drafts.filter(item => item.kind === "video").length;
  useEffect(() => { onDraftCountsChange?.(count === null ? null : { photos, videos }); }, [count, photos, videos, onDraftCountsChange]);
  useEffect(() => { onDraftItemsChange?.(count === null ? null : drafts); }, [count, drafts, onDraftItemsChange]);
  const totals = drafts.length ? [photos ? `${photos} ${photos === 1 ? "photo" : "photos"}` : "", videos ? `${videos} ${videos === 1 ? "video" : "videos"}` : ""].filter(Boolean).join(" + ") : `${count || 0} items`;
  const batchGuidance = checkedIn ? "Add photos and videos, then submit them together."
    : "Photos and videos will be sent for approval when you check in.";
  const confirmedSubmission = submissionStatus?.key === refreshKey && submissionStatus.value?.submitted === true;
  const showAgreementContinue = beforeAgreement && confirmedSubmission && count === 0 && Boolean(onContinueToAgreement);
  const agreementContinueDisabled = disabled || submissionBlocked || busy || Boolean(processing) || continueToAgreementDisabled;
  const clubTapGuidance = beforeAgreement ? "Media submitted for approval."
    : "Your media is submitted. Tap the dancer check-in tag at your club to start its review.";
  const draftFeedback = count ? mediaDraftSubmissionHint({ photos, videos }, count) : "";
  const feedback = uploadMessage || (busy ? "Submitting…"
    : uploading ? "Uploading your media…"
    : disabled ? "Finishing your update…"
    : processing ? `${processing} ${processing === 1 ? "file is" : "files are"} still processing…`
    : count === null ? "Checking saved uploads…"
    : submissionBlocked && submissionHint ? submissionHint
    : draftFeedback ? checkedIn ? draftFeedback : message || batchGuidance
    : showAgreementContinue ? submissionHint || "Media submitted for approval."
    : !justSubmitted && waitingForClub ? clubTapGuidance
    : !justSubmitted && !count && submissionStatus?.key === refreshKey && submissionStatus.inFinalReview ? "MyDancr is reviewing your new photos and videos."
    : message ? message
    : !count && waitingForClub ? clubTapGuidance
    : !count && waiting ? "Your media is awaiting approval." : submissionHint || batchGuidance);
  const itemCount = count ? `${count} ${count === 1 ? "item" : "items"} ` : "";
  const buttonState = busy ? "submitting" : justSubmitted ? "submitted" : !submissionBlocked && !count && (waiting || waitingForClub) ? "pending" : "ready";
  const showProgress = uploading || (!disabled && processing > 0);
  const needsAttention = submissionHintNeedsAttention && submissionBlocked && feedback === submissionHint && !disabled && !showProgress && !busy;
  const overviewSubmitted = !submissionBlocked && count === 0 && (justSubmitted || waiting || waitingForClub || confirmedSubmission);
  const submitButton = (overview = false) => !overview && showAgreementContinue ? <button className="dancer-media-submit" data-state="ready" type="button"
    disabled={agreementContinueDisabled} onClick={() => { if (!agreementContinueDisabled) onContinueToAgreement?.(); }}>Continue to agreement</button>
    : <button className="dancer-media-submit" data-secondary={overview && beforeAgreement && confirmedSubmission || undefined} data-state={overview && !busy && overviewSubmitted ? "submitted" : buttonState} type="button" disabled={disabled || submissionBlocked || busy || justSubmitted || !count || Boolean(processing)} onClick={() => void submit()}>
    {busy ? "Submitting…" : overview && overviewSubmitted ? "Submitted for approval" : justSubmitted ? "✓ Submitted" : buttonState === "pending" ? beforeAgreement ? "Submitted for approval" : waitingForClub ? "Submitted · Awaiting club tap" : "Awaiting approval" : checkedIn ? `✓ Submit ${itemCount}for approval` : `✓ Save ${itemCount}for next check-in`}
  </button>;
  const progress = showProgress ? <span className="dancer-upload-progress is-indeterminate" role="progressbar"
    aria-label={uploading ? "Media uploading" : "Media processing"} aria-valuemin={0} aria-valuemax={100}><span /></span> : null;
  const submissionError = error ? <p role="alert">{error} <button type="button" disabled={disabled || busy} onClick={() => void load()}>Retry status</button></p> : null;
  return <><section className="dancer-media-submit-bar" aria-label="Submit media updates">
    {count && !message && (feedback !== draftFeedback || venueName) ? <p className="dancer-media-batch-summary" role="status">{totals}{venueName ? ` for ${venueName}` : ""}</p> : null}
    {feedback ? <p className={feedback === batchGuidance ? "dancer-media-submit-guidance" : undefined} data-submitted={showAgreementContinue || undefined} data-needs-attention={needsAttention || undefined} role="status">{feedback}</p> : null}
    {progress}
    {submitButton()}
    {submissionError}
  </section>
    {/* Keep one submission controller for the editor and setup overview. */}
    {overviewTarget ? createPortal(<section className="dancer-media-submit-bar" aria-label="Submit profile media">
      {progress}
      {beforeAgreement && confirmedSubmission && count === 0 ? null : submitButton(true)}
      {submissionError}
    </section>, overviewTarget) : null}
  </>;
}
