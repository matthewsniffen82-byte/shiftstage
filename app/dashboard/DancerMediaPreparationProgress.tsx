"use client";

import { useEffect, useState } from "react";
import { mediaPreparationPercent } from "./media-preparation-progress";

export default function DancerMediaPreparationProgress({ kind, label, processing = false, transferProgress, processingStartedAt, className = "dancer-media-slot-progress" }: {
  kind: "photo" | "video";
  label: string;
  processing?: boolean;
  transferProgress?: number;
  processingStartedAt?: number;
  className?: string;
}) {
  const [clock, setClock] = useState(() => ({ now: Date.now(), startedAt: Date.now() }));
  useEffect(() => {
    if (!processing) return;
    const startedAt = Date.now();
    setClock({ now: startedAt, startedAt });
    const timer = window.setInterval(() => setClock({ now: Date.now(), startedAt }), 1_000);
    return () => window.clearInterval(timer);
  }, [processing, processingStartedAt]);
  const startedAt = Number.isFinite(processingStartedAt) ? processingStartedAt! : clock.startedAt;
  const percent = mediaPreparationPercent({ kind, processing, transferProgress, elapsedMs: clock.now - startedAt });
  const stage = processing ? "Processing" : "Uploading";
  return <div className={className} title="Overall preparation progress. Processing is estimated until the file is ready to submit.">
    <span>{stage} · {percent}%{processing ? " est." : ""}</span>
    <span className="dancer-upload-progress" role="progressbar" aria-label={`${label}: ${stage}`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      aria-valuetext={`${percent}% overall${processing ? ", estimated" : ""}. ${stage}.`}>
      <span style={{ width: `${percent}%` }} />
    </span>
  </div>;
}
