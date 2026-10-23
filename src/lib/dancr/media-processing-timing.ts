/** Stage timings contain no filenames, storage URLs, tokens, or media content. */
export type MediaTimingContext = { videoId: string; attempt?: number; stages?: Record<string, number> };

export async function timeMediaStage<T>(media: "photo" | "video", stage: string, operation: () => Promise<T>, context?: MediaTimingContext): Promise<T> {
  const startedAt = Date.now();
  let succeeded = false;
  try {
    const result = await operation();
    succeeded = true;
    return result;
  } finally {
    const durationMs = Math.max(0, Date.now() - startedAt);
    if (context?.stages) context.stages[stage] = (context.stages[stage] || 0) + durationMs;
    console.info(JSON.stringify({ event: "media_processing.stage", media, stage, durationMs, succeeded,
      ...(context ? { videoId: context.videoId, attempt: context.attempt } : {}),
    }));
  }
}
