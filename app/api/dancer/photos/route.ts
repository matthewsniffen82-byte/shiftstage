import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { deleteOwnDancerPhoto, uploadOwnDancerPhoto } from "@/src/lib/dancr/dancer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Photo file is required." }, { status: 400 });
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ ok: false, error: "Photo must be a JPEG, PNG, or WebP image." }, { status: 400 });
    }

    const photo = await uploadOwnDancerPhoto(client, user.id, {
      file,
      fileName: getFileName(file),
      contentType: file.type,
      isPrimary: formData.get("isPrimary") === "true",
      sortOrder: parseOptionalInteger(formData.get("sortOrder")),
      altText: parseOptionalText(formData.get("altText")),
      replaceExisting: formData.get("replaceExisting") === "true",
    });

    return NextResponse.json({ ok: true, photo });
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

function getFileName(file: Blob) {
  return "name" in file && typeof file.name === "string" ? file.name : "photo";
}

function parseOptionalInteger(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : undefined;
}

function parseOptionalText(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
