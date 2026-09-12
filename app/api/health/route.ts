import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const revision = process.env.VERCEL_GIT_COMMIT_SHA;
  return NextResponse.json({
    ok: true,
    service: "dancr",
    time: new Date().toISOString(),
    revision: revision && /^[a-f0-9]{40}$/i.test(revision) ? revision.toLowerCase() : null,
  });
}
