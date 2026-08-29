import { NextResponse } from "next/server";
import { getPublicEnv, getServerEnv } from "../../../../src/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = getPublicEnv();
    const serviceRoleKey = getServerEnv("SUPABASE_SERVICE_ROLE_KEY");
    const response = await fetch(
      `${env.supabaseUrl.replace(/\/$/, "")}/rest/v1/dancer_profiles?select=id,is_public&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error("SUPABASE_HEALTH_PROBE_FAILED", await formatSupabaseResponse(response));
      return unhealthySupabaseResponse();
    }

    return NextResponse.json({ ok: true, service: "supabase" });
  } catch (error) {
    console.error("SUPABASE_HEALTH_PROBE_FAILED", formatUnexpectedError(error));
    return unhealthySupabaseResponse();
  }
}

function unhealthySupabaseResponse() {
  return NextResponse.json(
    { ok: false, service: "supabase", error: "Supabase health check failed." },
    { status: 503, headers: { "cache-control": "private, no-store" } },
  );
}

async function formatSupabaseResponse(response: Response) {
  const body = await response.text();
  let parsed: unknown = null;

  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = body;
  }

  return {
    message: "Supabase REST health probe failed.",
    status: response.status,
    statusText: response.statusText,
    body: parsed,
  };
}

function formatUnexpectedError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || "Unknown error.",
      name: error.name,
    };
  }

  return {
    message: String(error || "Unknown health check error."),
  };
}
