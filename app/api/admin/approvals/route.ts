import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { getApprovalQueue, requireAdmin, reviewDancerProfile, reviewSubmissionContent } from "@/src/lib/dancr/admin";
import type { ReviewStatus } from "@/src/lib/dancr/types";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_STATUSES = new Set(["approved", "rejected"]);

export async function GET(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const queue = await getApprovalQueue(createAdminSupabaseClient());
    return NextResponse.json({ ok: true, queue });
  } catch (error) {
    return apiError(error, "Unable to load approval queue.");
  }
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const body = await request.json();
    const dancerId = typeof body?.dancerId === "string" ? body.dancerId.trim() : "";
    const status = typeof body?.status === "string" ? body.status.trim() : "";
    const notes = typeof body?.notes === "string" ? body.notes.trim() : null;

    if (!dancerId) {
      return NextResponse.json({ ok: false, error: "Missing dancerId." }, { status: 400 });
    }

    if (!REVIEW_STATUSES.has(status)) {
      return NextResponse.json({ ok: false, error: "Status must be approved or rejected." }, { status: 400 });
    }

    if (body?.action === "review_content") {
      const targetType = body?.targetType === "photo" || body?.targetType === "verification_document" ? body.targetType : "";
      const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";
      const label = typeof body?.label === "string" ? body.label.trim() : null;

      if (!targetType || !targetId) {
        return NextResponse.json({ ok: false, error: "Missing review target." }, { status: 400 });
      }

      if (status === "rejected" && !notes) {
        return NextResponse.json({ ok: false, error: "Add a reason before disapproving this submitted item." }, { status: 400 });
      }

      const review = await reviewSubmissionContent(createAdminSupabaseClient(), {
        dancerId,
        reviewerId: user.id,
        targetType,
        targetId,
        status: status as ReviewStatus,
        notes,
        label,
      });

      return NextResponse.json({ ok: true, review });
    }

    const review = await reviewDancerProfile(createAdminSupabaseClient(), {
      dancerId,
      reviewerId: user.id,
      status: status as ReviewStatus,
      notes,
    });

    return NextResponse.json({ ok: true, review });
  } catch (error) {
    return apiError(error, "Unable to review dancer profile.");
  }
}
