import "server-only";

/** Dispatch only: FFmpeg runs in the dedicated worker invocation, not this upload. */
export async function dispatchVideoModeration(videoId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) {
    throw new Error("Invalid video worker job.");
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Video worker security is not configured.");
  // Never forward a worker credential to a Host header or other request input.
  const configured = process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}` : process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) throw new Error("Video worker origin is not configured.");
  const origin = new URL(configured);
  if (origin.username || origin.password || (origin.protocol !== "https:"
    && !(process.env.NODE_ENV !== "production" && origin.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(origin.hostname)))) {
    throw new Error("Invalid video worker origin.");
  }
  const headers: Record<string, string> = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const response = await fetch(new URL("/api/cron/video-moderation", origin), {
    method: "POST", headers, body: JSON.stringify({ videoId }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(280_000),
  });
  if (!response.ok) throw new Error(`Video worker dispatch failed (${response.status}).`);
  const result = await response.json();
  if (result?.ok !== true) throw new Error("Video worker completion was not confirmed.");
}
