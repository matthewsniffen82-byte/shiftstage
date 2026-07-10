import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { deleteOwnDancerPhoto } from "@/src/lib/dancr/dancer";
import { moderateAndStoreDancerPhoto } from "@/src/lib/dancr/image-moderation";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Photo file is required." }, { status: 400 });
    }

    const result = await moderateAndStoreDancerPhoto(client, createAdminSupabaseClient(), {
      file,
      userId: user.id,
      isPrimary: formData.get("isPrimary") === "true",
      sortOrder: parseOptionalInteger(formData.get("sortOrder")),
      altText: parseOptionalText(formData.get("altText")),
      replaceExisting: formData.get("replaceExisting") === "true",
      uploadContext: formData.get("isPrimary") === "true" ? "profile_main" : "profile_gallery",
      idempotencyKey: request.headers.get("idempotency-key") || parseOptionalText(formData.get("idempotencyKey")),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "",
    });

    const status = result.decision === "rejected" ? 422 : 200;
    return NextResponse.json({ ok: result.decision !== "rejected", ...result }, { status });
  } catch (error) {
    return apiError(error, "Unable to upload dancer photo.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const body = await request.json().catch(() => ({}));
    const photoId = typeof body?.photoId === "string" ? body.photoId.trim() : "";

    if (!photoId) {
      return NextResponse.json({ ok: false, error: "Photo id is required." }, { status: 400 });
    }

    const photo = await deleteOwnDancerPhoto(client, user.id, photoId);
    return NextResponse.json({ ok: true, photo });
  } catch (error) {
    return apiError(error, "Unable to delete dancer photo.");
  }
}

function parseOptionalInteger(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : undefined;
}

function parseOptionalText(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
