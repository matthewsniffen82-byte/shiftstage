import { readFile } from "node:fs/promises";
import path from "node:path";
import { LIVE_SHELL_FEATURE_VERSIONS } from "../../src/generated/live-shell-feature-versions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const feature = params.get("feature");
  // Never serve a different deployment's chunk into an already loaded shell.
  if (feature !== "tv" || params.get("v") !== LIVE_SHELL_FEATURE_VERSIONS.tv) {
    return new Response("Shell feature unavailable", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(await readFile(path.join(process.cwd(), "outputs", "live-shell-tv.js"), "utf8"), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
