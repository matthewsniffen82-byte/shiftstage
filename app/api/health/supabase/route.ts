import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "../../../../src/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createAdminSupabaseClient();
    const { error } = await supabase.from("venues").select("id", { count: "exact", head: true });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          service: "supabase",
          error: formatHealthError(error),
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
        error: formatHealthError(error),
        env: getSupabaseEnvStatus(),
      },
      { status: 500 },
    );
  }
}

function getSupabaseEnvStatus() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

function formatHealthError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || "Unknown error.",
      name: error.name,
    };
  }

  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return {
      message: typeof value.message === "string" && value.message ? value.message : "Supabase returned an error.",
      code: value.code,
      details: value.details,
      hint: value.hint,
    };
  }

  return {
    message: String(error || "Unknown health check error."),
  };
}
