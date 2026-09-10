import { readFile } from "node:fs/promises";
import path from "node:path";

import { LIVE_SHELL_SHA256 } from "../../src/generated/live-shell-version";
import { LIVE_SHELL_SCRIPT_SHA256 } from "../../src/generated/live-shell-script-version.mjs";
import { extractLiveShellAppScript } from "../../src/lib/dancr/live-shell-script.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const production = process.env.NODE_ENV === "production";
  const script = production
    ? await readFile(path.join(process.cwd(), "outputs", "live-shell-app.js"), "utf8")
    : extractLiveShellAppScript(
        (await readFile(path.join(process.cwd(), "outputs", "index.html"), "utf8")).replace(/\r\n?/g, "\n"),
      );
  const scriptVersion = production ? LIVE_SHELL_SCRIPT_SHA256 : LIVE_SHELL_SHA256;
  const requestedVersion = new URL(request.url).searchParams.get("v");
  const cacheControl = requestedVersion === scriptVersion
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";

  return new Response(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": cacheControl,
      "x-dancr-live-shell-build-version": LIVE_SHELL_SHA256,
      "x-dancr-live-shell-script-version": scriptVersion,
    },
  });
}
