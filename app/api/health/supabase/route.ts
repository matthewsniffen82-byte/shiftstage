import { NextResponse } from "next/server";
import { getPublicEnv, getServerEnv } from "../../../../src/lib/env";

export const runtime = "nodejs";

export async function GET() {
  try {
    const env = getPublicEnv();
    const serviceRoleKey = getServerEnv("SUPABASE_SERVICE_ROLE_KEY");
    const response = await fetch(`${env.supabaseUrl.replace(/\/$/, "")}/rest/v1/venues?select=id&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          service: "supabase",
          error: await formatSupabaseResponse(response),
          env: getSupabaseEnvStatus(),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, service: "supabase" });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "supabase",
        error: formatUnexpectedError(error),
        env: getSupabaseEnvStatus(),
      },
      { status: 500 },
    );
  }
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

function getSupabaseEnvStatus() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}
