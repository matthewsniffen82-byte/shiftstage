"use client";

import { useEffect, useRef, useState } from "react";
import { readSession, requestDancerPhotosJson, requestDancerProfileJson, requestDancerTvVideoJson } from "./dashboard-session";
import { announceDancerProfileVideosChanged } from "./dancer-profile-media-sync";
import { isAwaitingClubApproval, mediaReviewExplanation, mediaReviewLabel } from "@/src/lib/dancr/media-review-label";

export function canRetryMediaReview(status: string, moderationStatus = "") {
  if (isAwaitingClubApproval(status, moderationStatus)) return false;
  if (["approved", "live", "rejected", "denied", "hidden", "removed", "expired", "uploading", "failed"].includes(status)) return false;
  return ["pending", "pending_review", "submitted", "review", "moderating", "error", "moderation_error", "moderation_retry"].includes(moderationStatus || status);
}

export default function DancerMediaRetryButton({ id, kind, status, moderationStatus, disabled = false, onBusyChange, onRetried }: {
  id: string; kind: "photo" | "video"; status: string; moderationStatus?: string; disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onRetried?: (data: { profile?: Record<string, unknown>; result: any }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [resolved, setResolved] = useState(false);
  const request = useRef<AbortController | null>(null);
  const callbacks = useRef({ onBusyChange, onRetried });
  callbacks.current = { onBusyChange, onRetried };
  useEffect(() => () => {
    if (request.current) { request.current.abort(); callbacks.current.onBusyChange?.(false); }
  }, []);

  async function retry() {
    if (request.current || disabled) return;
    const owner = readSession()?.account?.id;
    if (!owner) { setMessage("Sign in again to retry review."); return; }
    const controller = new AbortController();
    request.current = controller;
    const current = () => !controller.signal.aborted && readSession()?.account?.id === owner;
    setBusy(true); setMessage(""); callbacks.current.onBusyChange?.(true);
    try {
      const options = { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retry", ...(kind === "photo" ? { photoId: id } : {}) }),
        signal: controller.signal, timeoutMs: 65_000, fallbackMessage: "Unable to retry review." };
      const result = kind === "photo" ? await requestDancerPhotosJson(options) : await requestDancerTvVideoJson(id, options);
      if (!current()) return;
      let profile: Record<string, unknown> | undefined;
      if (kind === "photo") {
        const refreshed = await requestDancerProfileJson({ cache: "no-store", signal: controller.signal });
        if (!current()) return;
        profile = refreshed.profile;
        setResolved(["approved", "rejected"].includes(result.decision));
      } else announceDancerProfileVideosChanged();
      callbacks.current.onRetried?.({ profile, result });
      setMessage(result.decision === "rejected" ? mediaReviewExplanation(kind, "rejected", result) : mediaReviewLabel(result.decision || "pending", "", kind));
    } catch (error) {
      if (current()) setMessage(error instanceof Error ? error.message : "Unable to retry review.");
    } finally {
      if (!controller.signal.aborted) {
        request.current = null; setBusy(false); callbacks.current.onBusyChange?.(false);
      }
    }
  }

  if (!canRetryMediaReview(status, moderationStatus) || resolved) return null;
  return <span className="dancer-media-review-retry">
    <button className="dancer-media-review-retry-button" type="button" disabled={disabled || busy} aria-busy={busy}
      aria-label={`Retry ${kind} review`} onClick={() => void retry()}>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7v5h-5M19 12a7 7 0 1 0-2 5M20 12l-3-5" /></svg>
      {busy ? `Checking ${kind}…` : "Retry"}
    </button>
    {message ? <span className="dancer-media-review-retry-message" role="status">{message}</span> : null}
    <style>{`
      .dancer-media-review-retry { display:grid; gap:4px; min-width:0; }
      button.dancer-media-review-retry-button, body.dancr-button-system button.dancer-media-review-retry-button {
        display:inline-flex !important; align-items:center; justify-content:center; gap:6px; width:auto !important;
        min-height:44px !important; padding:8px 10px !important; border:1px solid var(--dancr-color-border) !important;
        border-radius:8px !important; background:var(--dancr-color-control-secondary) !important; color:#fff !important;
        box-shadow:none !important; font:inherit; font-size:13px; cursor:pointer; justify-self:start;
      }
      .dancer-media-review-retry-button svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
      .dancer-media-review-retry-button:disabled { opacity:.55; cursor:wait; }
      .dancer-media-review-retry-button:focus-visible { outline:2px solid #fff; outline-offset:2px; }
      .dancer-media-review-retry-message { font-size:12px; line-height:1.4; color:#cfc7d8; overflow-wrap:anywhere; }
    `}</style>
  </span>;
}
