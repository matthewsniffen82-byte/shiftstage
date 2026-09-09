import { PublicApiError } from "../api-error-policy.ts";

// For same-origin JSON actions identified by a visitor cookie. This is not an
// authentication check and is not applied to webhooks, cron or auth callbacks.
export function requireSameOriginJsonMutation(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((origin !== null && origin !== new URL(request.url).origin)
    || (site !== null && site !== "same-origin" && site !== "none")) {
    throw new PublicApiError("FORBIDDEN", "Open MyDancr to complete this action.", 403);
  }

  // HTML forms cannot send this media type. Older browsers and non-browser
  // clients may omit Origin/Fetch Metadata, but still must send JSON.
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new PublicApiError("INVALID_REQUEST", "Send this request as JSON.", 415);
  }
}
