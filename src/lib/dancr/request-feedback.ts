export function isReadRequest(method?: string) {
  return ["GET", "HEAD", "OPTIONS"].includes((method || "GET").toUpperCase());
}

export const unconfirmedChangeMessage = "Your change could not be confirmed. Refresh and check its status before trying again.";

export function connectionFailureMessage(reading: boolean) {
  return reading ? "Unable to connect. Check your connection and try again." : "Connection interrupted. " + unconfirmedChangeMessage;
}

export function responseFailureMessage(response: Response, data: { error?: unknown; message?: unknown } | null, reading: boolean, fallback?: string) {
  for (const value of [data?.error, data?.message]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  if (response.status === 429) return "Too many requests. Wait a moment before trying again.";
  if (response.status === 403) return "Your account does not have permission for this action. Check which account you are using.";
  if (response.status === 413) return "This submission is too large. Reduce its size and try again.";
  if (!reading && (response.ok || response.status === 408 || response.status >= 500)) return unconfirmedChangeMessage;
  return fallback || (reading ? "Unable to load this information. Please try again." : "Unable to save this change. Please try again.");
}
