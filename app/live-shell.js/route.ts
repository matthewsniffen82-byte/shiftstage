import { readFile } from "node:fs/promises";
import path from "node:path";

import { LIVE_SHELL_SHA256 } from "../../src/generated/live-shell-version";
import { extractLiveShellAppScript } from "../../src/lib/dancr/live-shell-script.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const htmlPath = path.join(process.cwd(), "outputs", "index.html");
  const html = await readFile(htmlPath, "utf8");
  const normalizedHtml = html.replace(/\r\n?/g, "\n");
  const script = extractLiveShellAppScript(normalizedHtml);
  const requestedVersion = new URL(request.url).searchParams.get("v");
  const cacheControl = requestedVersion === LIVE_SHELL_SHA256
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";

  return new Response(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": cacheControl,
      "x-dancr-live-shell-build-version": LIVE_SHELL_SHA256,
    },
  });
}
