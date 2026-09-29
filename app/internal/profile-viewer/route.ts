import { GET as renderLiveShell } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The embedded viewer hides the public demo banner. Its reserved viewport band
// must disappear too, including in the shared photo/video overlays.
const INTERNAL_PROFILE_VIEWPORT_STYLES = `<style id="internal-profile-viewport">
html.internal-profile-embed {
  --mydancr-preview-banner-height: 0px;
  --mydancr-preview-banner-offset: 0px;
}
html.internal-profile-embed body.dancr-button-system #profileBackdrop .profile-modal {
  height: 100dvh !important;
  min-height: 0 !important;
  max-height: 100dvh !important;
}
</style>`;

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("internal_profile");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return new Response("Profile unavailable.", { status: 400, headers: { "cache-control": "no-store" } });
  }
  // This is the same public viewer shell, with no dancer data or credentials in
  // its HTML. The roster supplies authorized data through its same-origin bridge.
  const shell = await renderLiveShell();
  const headers = new Headers(shell.headers);
  const policy = headers.get("content-security-policy");
  if (!policy?.includes("frame-ancestors 'none'")) throw new Error("Profile viewer framing policy is unavailable.");
  headers.set("content-security-policy", policy.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  headers.set("x-frame-options", "SAMEORIGIN");
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("cdn-cache-control", "no-store");
  headers.set("vercel-cdn-cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow");
  const html = (await shell.text()).replace("</head>", `${INTERNAL_PROFILE_VIEWPORT_STYLES}</head>`);
  return new Response(html, { status: shell.status, headers });
}
