export type VideoTransfer = { transport: "resumable" | "signed_put" | "existing"; resumed: boolean };
export type VideoUploadTiming = VideoTransfer & {
  queueMs: number;
  metadataMs: number;
  reservationMs: number;
  transferMs: number;
  parallelLimit: number;
};

/** Optional, untrusted diagnostics: never used for approval, billing, or access. */
export function parseVideoUploadTiming(value: unknown): VideoUploadTiming | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const durations = [input.queueMs, input.metadataMs, input.reservationMs, input.transferMs];
  if (!durations.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400_000)
    || typeof input.parallelLimit !== "number" || !Number.isInteger(input.parallelLimit) || input.parallelLimit < 1 || input.parallelLimit > 5
    || typeof input.transport !== "string" || !["resumable", "signed_put", "existing"].includes(input.transport) || typeof input.resumed !== "boolean") return null;
  // Explicit fields prevent filenames, tokens, URLs, or arbitrary client text entering logs.
  return {
    queueMs: Math.round(input.queueMs as number), metadataMs: Math.round(input.metadataMs as number),
    reservationMs: Math.round(input.reservationMs as number), transferMs: Math.round(input.transferMs as number),
    parallelLimit: input.parallelLimit, transport: input.transport as VideoTransfer["transport"], resumed: input.resumed,
  };
}

export function createVideoUploadTiming(queueMs: number, parallelLimit: number, now = () => performance.now()) {
  const timing: VideoUploadTiming = {
    queueMs, parallelLimit, metadataMs: 0, reservationMs: 0, transferMs: 0, transport: "existing", resumed: false,
  };
  return {
    async measure<T>(stage: "metadataMs" | "reservationMs" | "transferMs", operation: () => Promise<T>): Promise<T> {
      const start = now();
      try { return await operation(); }
      finally { timing[stage] = Math.max(0, Math.round(now() - start)); }
    },
    report(transfer?: VideoTransfer) { return { ...timing, ...transfer }; },
  };
}
