"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
export default function DancerMediaBatchSubmission({ disabled, refreshKey, venueId, checkedIn = true, hasPendingMedia = false }: { disabled: boolean; refreshKey: string; venueId?: string; checkedIn?: boolean; hasPendingMedia?: boolean }) {
  const [count, setCount] = useState<number | null>(null), [waiting, setWaiting] = useState(false);
  const [waitingForClub, setWaitingForClub] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const submitting = useRef(false), read = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    read.current?.abort(); const controller = new AbortController(); read.current = controller;
    try {
      const data = await requestDashboardJson("/api/media-batches", { expectedRole: "dancer", cache: "no-store", signal: controller.signal, headers: venueId ? { "x-dancer-media-venue": venueId } : {} });
      if (controller.signal.aborted) return;
      setCount(data.draftCount); setWaiting(data.batches.some((b: { state: string }) => b.state !== "completed")); setWaitingForClub(data.waitingForClub === true); setError("");
    } catch (e) { if (!controller.signal.aborted) { setCount(null); setError(e instanceof Error ? e.message : "Unable to load submission status."); } }
    finally { if (read.current === controller) read.current = null; }
  }, [venueId]);
  useEffect(() => { if (!disabled) void load(); return () => read.current?.abort(); }, [disabled, refreshKey, load]);
  useEffect(() => {
    if (disabled || !hasPendingMedia || (count !== null && count > 0)) return;
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
  }, [disabled, hasPendingMedia, count, waiting, waitingForClub, load]);
  async function submit() {
    if (submitting.current) return;
    submitting.current = true; read.current?.abort(); setBusy(true); setError("");
    try {
      const result = await requestDashboardJson("/api/media-batches", { expectedRole: "dancer", method: "POST", headers: { "content-type": "application/json", ...(venueId ? { "x-dancer-media-venue": venueId } : {}) }, body: JSON.stringify({ action: "submit" }) });
      setMessage(result.waitingForCheckIn ? "Changes saved. They will be sent when you tap into this club." : "Media updates submitted. Your club will receive the batch for review."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to submit updates. Try again."); }
    finally { setBusy(false); submitting.current = false; }
  }
  return <section className="dashboard-panel" aria-label="Submit media updates">
    <h3>{checkedIn ? "Submit media updates" : "Saved for check-in"}</h3>
    <p>{!checkedIn ? "Your saved changes will be sent to this club automatically when you tap in." : count ? `${count} new media ${count === 1 ? "item is" : "items are"} saved and ready to submit.` : waitingForClub ? "Your batch is saved. It will reach your club when you connect by tapping in." : waiting ? "Your submitted media is being reviewed." : "Finish adding or replacing your photos and videos, then submit them together."}</p>
    {waiting && <p>Your approved profile can stay live while updates are reviewed, as long as it meets the requirements.</p>}
    {checkedIn && <button type="button" disabled={disabled || busy || !count} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit media updates"}</button>}
    <button type="button" disabled={disabled || busy} onClick={() => void load()}>Refresh status</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
