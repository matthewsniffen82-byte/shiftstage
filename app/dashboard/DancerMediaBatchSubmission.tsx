"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
export type MediaBatchDraftCounts = { photos: number; videos: number };
export default function DancerMediaBatchSubmission({ disabled, refreshKey, venueId, checkedIn = true, hasPendingMedia = false, venueName = "this club", uploadMessage = "", onBusyChange, onDraftCountsChange }: { disabled: boolean; refreshKey: string; venueId?: string; checkedIn?: boolean; hasPendingMedia?: boolean; venueName?: string; uploadMessage?: string; onBusyChange?: (busy: boolean) => void; onDraftCountsChange?: (counts: MediaBatchDraftCounts | null) => void }) {
  const [drafts, setDrafts] = useState<{ kind: string }[]>([]);
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
  const submitting = useRef(false), read = useRef<AbortController | null>(null);
  const draftSignature = useRef("");
  const load = useCallback(async () => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller;
    try {
      const data = await requestDashboardJson("/api/media-batches", { expectedRole: "dancer", cache: "no-store", signal: controller.signal, headers: venueId ? { "x-dancer-media-venue": venueId } : {} });
      if (controller.signal.aborted) return;
      const signature = JSON.stringify(data.draftItems || data.draftCount);
      if (!submitting.current && signature !== draftSignature.current) setMessage("");
      draftSignature.current = signature;
      setDrafts(data.draftItems || []); setProcessing(data.processingCount || 0);
      setCount(data.draftCount); setWaiting(data.batches.some((b: { state: string }) => b.state !== "completed")); setWaitingForClub(data.waitingForClub === true); setError("");
    } catch (e) { if (!controller.signal.aborted) { setCount(null); setError(e instanceof Error ? e.message : "Unable to load submission status."); } }
    finally { if (read.current === controller) read.current = null; }
  }, [venueId]);
  useEffect(() => { if (!disabled) void load(); return () => read.current?.abort(); }, [disabled, refreshKey, load]);
  useEffect(() => {
    if (disabled || !hasPendingMedia || (count !== null && count > 0 && !processing)) return;
    // File preparation can finish without changing the profile's review status.
    // Recheck readiness directly, without interrupting a slow request or a submit.
    const refresh = () => {
      if (document.visibilityState === "visible" && !read.current && !submitting.current) void load();
    };
    const timer = window.setInterval(refresh, waiting || waitingForClub ? 8_000 : 2_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [disabled, hasPendingMedia, count, waiting, waitingForClub, processing, load]);
  async function submit() {
    if (disabled || submitting.current || !count || processing) return;
    submitting.current = true; read.current?.abort(); setBusy(true); setError(""); setMessage("");
    const controller = new AbortController(); mutation.current = controller; onBusyChange?.(true);
    try {
      const result = await requestDashboardJson("/api/media-batches", { expectedRole: "dancer", method: "POST", signal: controller.signal, headers: { "content-type": "application/json", ...(venueId ? { "x-dancer-media-venue": venueId } : {}) }, body: JSON.stringify({ action: "submit" }) });
      if (controller.signal.aborted) return;
      const submitted = result.submitted ?? count;
      setMessage(result.waitingForCheckIn ? `Saved for ${venueName}—will send when you check in.`
        : submitted ? `${submitted} ${submitted === 1 ? "item submitted" : "items submitted together"} to ${venueName}. Awaiting approval.` : "No new items to submit.");
      window.dispatchEvent(new Event("mydancr:dancer-media-changed")); await load();
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to submit updates. Try again."); }
    finally { mutation.current = null; submitting.current = false; if (!controller.signal.aborted) { setBusy(false); onBusyChange?.(false); } }
  }
  const photos = drafts.filter(item => item.kind === "photo").length;
  const videos = drafts.filter(item => item.kind === "video").length;
  useEffect(() => { onDraftCountsChange?.(count === null ? null : { photos, videos }); }, [count, photos, videos, onDraftCountsChange]);
  const totals = drafts.length ? [photos ? `${photos} ${photos === 1 ? "photo" : "photos"}` : "", videos ? `${videos} ${videos === 1 ? "video" : "videos"}` : ""].filter(Boolean).join(" + ") : `${count || 0} items`;
  const feedback = uploadMessage || message || (disabled ? "Finish uploads or retry failed files before submitting."
    : processing ? `${processing} ${processing === 1 ? "file is" : "files are"} still processing…`
    : count === null ? "Checking saved drafts…" : !count ? waiting || waitingForClub ? "Your submitted media is awaiting approval." : "Add photos or videos to start a draft batch." : "");
  const itemCount = count ? `${count} ${count === 1 ? "item" : "items"} ` : "";
  return <section className="dancer-media-submit-bar" aria-label="Submit media updates">
    {count && !message ? <p className="dancer-media-batch-summary" role="status">{totals} for {venueName}</p> : null}
    {feedback ? <p role="status">{feedback}</p> : null}
    {count && !checkedIn && !message ? <small>Drafts stay saved for {venueName} and will send when you check in.</small> : null}
    <button className="dancer-media-submit" type="button" disabled={disabled || busy || !count || Boolean(processing)} onClick={() => void submit()}>
      {busy ? "Submitting…" : checkedIn ? `✓ Submit ${itemCount}for approval` : `✓ Save ${itemCount}for next check-in`}
    </button>
    {error ? <p role="alert">{error} <button type="button" disabled={disabled || busy} onClick={() => void load()}>Retry status</button></p> : null}
  </section>;
}
