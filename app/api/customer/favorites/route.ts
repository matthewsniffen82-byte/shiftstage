import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { favoriteDancer, unfavoriteDancer } from "@/src/lib/dancr/customer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json();
    const dancerId = body?.dancerId;
    const favorite = body?.favorite !== false;

    if (!dancerId) {
      return NextResponse.json({ ok: false, error: "Missing dancerId." }, { status: 400 });
    }

    if (favorite) {
      await favoriteDancer(client, user.id, dancerId);
    } else {
      await unfavoriteDancer(client, user.id, dancerId);
    }

    return NextResponse.json({ ok: true, favorite });
  } catch (error) {
    return apiError(error, "Unable to update dancer favorite.");
  }
}
