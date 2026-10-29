"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestDashboardJson } from "./dashboard-session";
export default function DancerMediaBatchSubmission({ disabled, refreshKey, venueId }: { disabled: boolean; refreshKey: string; venueId?: string }) {
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
  }, [venueId]);
  useEffect(() => { if (!disabled) void load(); return () => read.current?.abort(); }, [disabled, refreshKey, load]);
  async function submit() {
    if (submitting.current) return;
    submitting.current = true; read.current?.abort(); setBusy(true); setError("");
    try {
      await requestDashboardJson("/api/media-batches", { expectedRole: "dancer", method: "POST", headers: { "content-type": "application/json", ...(venueId ? { "x-dancer-media-venue": venueId } : {}) }, body: JSON.stringify({ action: "submit" }) });
      setMessage("Media updates submitted. Your club will receive the batch for review."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to submit updates. Try again."); }
    finally { setBusy(false); submitting.current = false; }
  }
  return <section className="dashboard-panel" aria-label="Submit media updates">
    <h3>Submit media updates</h3>
    <p>{count ? `${count} new media ${count === 1 ? "item is" : "items are"} saved and ready to submit.` : waitingForClub ? "Your batch is saved. It will reach your club when you connect by tapping in." : waiting ? "Your submitted media is being reviewed." : "Finish adding or replacing your photos and videos, then submit them together."}</p>
    <button type="button" disabled={disabled || busy || !count} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit media updates"}</button>
    <button type="button" disabled={disabled || busy} onClick={() => void load()}>Refresh status</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
