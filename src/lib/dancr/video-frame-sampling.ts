export function parseFfmpegDuration(output: string) {
  const durations: number[] = [];
  const timestamps = [
    ...output.matchAll(/^out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/gm),
    ...output.matchAll(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g),
  ];
  for (const match of timestamps) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const duration = (hours * 60 * 60) + (minutes * 60) + seconds;
    if (Number.isFinite(duration) && duration > 0) durations.push(duration);
  }
  return durations.length ? Math.max(...durations) : null;
}

export function getDistributedVideoFrameSampling(durationSeconds: number, frameCount: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("The uploaded video duration could not be determined for moderation.");
  }
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error("Video moderation requires at least one frame.");
  }

  const intervalSeconds = durationSeconds / frameCount;
  return {
    // Sample the center of each equal-width time bucket so the first and last
    // frames represent the beginning and end without over-weighting either edge.
    startOffsetSeconds: intervalSeconds / 2,
    frameRate: Math.min(30, frameCount / durationSeconds),
  };
}
