import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const htmlPath = path.join(process.cwd(), "outputs", "index.html");
  const html = await readFile(htmlPath, "utf8");
  const activeEditProfileMarker = '<script>console.log("ACTIVE_EDIT_PROFILE_VERSION", "photo-database-sync-fix-v4");document.documentElement.setAttribute("data-active-edit-profile-version","photo-database-sync-fix-v4");</script>';
  const withBase = html.replace("<head>", `<head><base href="/outputs/">${activeEditProfileMarker}`);

  return new Response(withBase, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
