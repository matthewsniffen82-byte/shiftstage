import { readFile } from "node:fs/promises";
import path from "node:path";
import { LIVE_SHELL_SHA256 } from "@/src/generated/live-shell-version";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = false;

export async function GET() {
  const htmlPath = path.join(process.cwd(), "outputs", "index.html");
  const html = await readFile(htmlPath, "utf8");
  const activeEditProfileMarker = `<script>console.log("ACTIVE_EDIT_PROFILE_VERSION", "canonical-profile-approval-v13");document.documentElement.setAttribute("data-active-edit-profile-version","canonical-profile-approval-v13");document.documentElement.setAttribute("data-live-shell-version","${LIVE_SHELL_SHA256}");</script>`;
  const withBase = html.replace("<head>", `<head><base href="/outputs/">${activeEditProfileMarker}`);
  const withLiveProfileAssets = withBase.replace(
    "</head>",
    '<link rel="stylesheet" href="/mobile-social-strip.css?v=4"><script src="/video-autoplay-recovery.js?v=3" defer></script></head>',
  );

  return new Response(withLiveProfileAssets, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
      "x-dancr-live-shell-version": LIVE_SHELL_SHA256,
    },
  });
}
