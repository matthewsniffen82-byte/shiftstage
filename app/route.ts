import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const htmlPath = path.join(process.cwd(), "outputs", "index.html");
  const html = await readFile(htmlPath, "utf8");
  const activeEditProfileMarker = '<script>console.log("ACTIVE_EDIT_PROFILE_VERSION", "hard-refresh-core-approval-v12");document.documentElement.setAttribute("data-active-edit-profile-version","hard-refresh-core-approval-v12");</script>';
  const withBase = html.replace("<head>", `<head><base href="/outputs/">${activeEditProfileMarker}`);
  const withLiveProfileStyles = withBase.replace(
    "</head>",
    '<link rel="stylesheet" href="/mobile-social-strip.css?v=1"></head>',
  );

  return new Response(withLiveProfileStyles, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
