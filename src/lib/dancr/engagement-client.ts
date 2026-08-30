type EngagementTargetType = "profile" | "photo" | "video";

export function recordPublicEngagementShare(targetType: EngagementTargetType, targetId: string) {
  if (!targetId) return Promise.resolve(false);
  return fetch("/api/public/engagement-shares", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetType, targetId }),
    credentials: "same-origin",
    keepalive: true,
  }).then((response) => response.ok).catch(() => false);
}
