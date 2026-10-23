/** Stage timings contain no filenames, storage URLs, tokens, or media content. */
export type MediaTimingContext = { videoId: string; attempt?: number };

export async function timeMediaStage<T>(media: "photo" | "video", stage: string, operation: () => Promise<T>, context?: MediaTimingContext): Promise<T> {
  const startedAt = Date.now();
  let succeeded = false;
  try {
    const result = await operation();
    succeeded = true;
    return result;
  } finally {
    console.info(JSON.stringify({ event: "media_processing.stage", media, stage, durationMs: Math.max(0, Date.now() - startedAt), succeeded,
      ...(context ? { videoId: context.videoId, attempt: context.attempt } : {}),
    }));
  }
}
