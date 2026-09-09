import { readFile } from "node:fs/promises";
import path from "node:path";
import { LIVE_SHELL_SHA256 } from "../../../src/generated/live-shell-version";
import { extractLiveShellStyles } from "../../../src/lib/dancr/live-shell-styles.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const html = await readFile(path.join(process.cwd(), "outputs", "index.html"), "utf8");
  const css = extractLiveShellStyles(html.replace(/\r\n?/g, "\n"));
  const requestedVersion = new URL(request.url).searchParams.get("v");
  return new Response(css, {
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": requestedVersion === LIVE_SHELL_SHA256
        ? "public, max-age=31536000, immutable"
        : "public, max-age=0, must-revalidate",
      "x-dancr-live-shell-build-version": LIVE_SHELL_SHA256,
    },
  });
}
