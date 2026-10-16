/** Stage timings contain no filenames, storage URLs, tokens, or media content. */
export async function timeMediaStage<T>(media: "photo" | "video", stage: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let succeeded = false;
  try {
    const result = await operation();
    succeeded = true;
    return result;
  } finally {
    console.info(JSON.stringify({ event: "media_processing.stage", media, stage, durationMs: Date.now() - startedAt, succeeded }));
  }
}
