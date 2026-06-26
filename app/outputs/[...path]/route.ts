import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const params = await context.params;
  const requestedPath = params.path.join(path.sep);
  const outputsRoot = path.join(process.cwd(), "outputs");
  const filePath = path.normalize(path.join(outputsRoot, requestedPath));

  if (!filePath.startsWith(outputsRoot)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const body = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();

    return new NextResponse(body, {
      headers: {
        "content-type": contentTypes[extension] || "application/octet-stream",
        "cache-control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
