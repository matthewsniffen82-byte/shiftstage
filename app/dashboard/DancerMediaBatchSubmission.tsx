"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
import { subscribeDancerMediaStatus } from "./dancer-media-status";
import type { MediaSubmissionDraft } from "@/src/lib/dancr/club-media-status";
export type MediaBatchDraftCounts = { photos: number; videos: number };
export default function DancerMediaBatchSubmission({
  disabled, refreshKey, venueId, checkedIn = true, hasPendingMedia = false, venueName, uploadMessage = "",
  submissionHint = "", submissionBlocked = false, onSubmitRequest, onBusyChange, onDraftCountsChange, onDraftItemsChange,
}: {
  disabled: boolean; refreshKey: string; venueId?: string; checkedIn?: boolean; hasPendingMedia?: boolean;
  venueName?: string; uploadMessage?: string; submissionHint?: string; submissionBlocked?: boolean;
  onSubmitRequest?: () => void; onBusyChange?: (busy: boolean) => void;
  onDraftCountsChange?: (counts: MediaBatchDraftCounts | null) => void;
  onDraftItemsChange?: (items: MediaSubmissionDraft[] | null) => void;
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
      draftSignature.current = signature;
      setDrafts(data.draftItems || []); setProcessing(data.processingCount || 0);
      setCount(data.draftCount); setWaiting(data.batches.some((b: { state: string }) => b.state !== "completed")); setWaitingForClub(data.waitingForClub === true); setError("");
      return true;
    } catch (e) { if (!controller.signal.aborted) { setCount(null); setError(e instanceof Error ? e.message : "Unable to load submission status."); } return false; }
    finally { if (read.current === controller) read.current = null; }
  }, [venueId]);
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
    // First-time submission must finish profile setup and explicit agreement acceptance.
    // Returning dancers use the same batch endpoint directly.
    if (onSubmitRequest) { onSubmitRequest(); return; }
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
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to submit updates. Try again."); }
    finally { mutation.current = null; submitting.current = false; if (!controller.signal.aborted) { setBusy(false); onBusyChange?.(false); } }
  }
  const photos = drafts.filter(item => item.kind === "photo").length;
  const videos = drafts.filter(item => item.kind === "video").length;
  useEffect(() => { onDraftCountsChange?.(count === null ? null : { photos, videos }); }, [count, photos, videos, onDraftCountsChange]);
  useEffect(() => { onDraftItemsChange?.(count === null ? null : drafts); }, [count, drafts, onDraftItemsChange]);
  const totals = drafts.length ? [photos ? `${photos} ${photos === 1 ? "photo" : "photos"}` : "", videos ? `${videos} ${videos === 1 ? "video" : "videos"}` : ""].filter(Boolean).join(" + ") : `${count || 0} items`;
  const batchGuidance = checkedIn ? "Add photos and videos, then submit them together."
    : "Photos and videos will be sent for approval when you check in.";
  const clubTapGuidance = "Your media is submitted. Tap the dancer check-in tag at your club to start its review.";
  const feedback = uploadMessage || (!justSubmitted && !count && waitingForClub ? clubTapGuidance : message) || (disabled ? "Finish uploads or retry failed files before submitting."
    : processing ? `${processing} ${processing === 1 ? "file is" : "files are"} still processing…`
    : count === null ? "Checking saved uploads…"
    : !count && waitingForClub ? clubTapGuidance
    : !count && waiting ? "Your media is awaiting approval." : submissionHint || batchGuidance);
  const itemCount = count ? `${count} ${count === 1 ? "item" : "items"} ` : "";
  const buttonState = busy ? "submitting" : justSubmitted ? "submitted" : !count && (waiting || waitingForClub) ? "pending" : "ready";
  return <section className="dancer-media-submit-bar" aria-label="Submit media updates">
    {count && !message ? <p className="dancer-media-batch-summary" role="status">{totals}{venueName ? ` for ${venueName}` : ""}</p> : null}
    {feedback ? <p className={feedback === batchGuidance ? "dancer-media-submit-guidance" : undefined} role="status">{feedback}</p> : null}
    <button className="dancer-media-submit" data-state={buttonState} type="button" disabled={disabled || submissionBlocked || busy || justSubmitted || !count || Boolean(processing)} onClick={() => void submit()}>
      {busy ? "Submitting…" : justSubmitted ? "✓ Submitted" : buttonState === "pending" ? waitingForClub ? "Submitted · Awaiting club tap" : "Awaiting approval" : checkedIn ? `✓ Submit ${itemCount}for approval` : `✓ Save ${itemCount}for next check-in`}
    </button>
    {error ? <p role="alert">{error} <button type="button" disabled={disabled || busy} onClick={() => void load()}>Retry status</button></p> : null}
  </section>;
}
