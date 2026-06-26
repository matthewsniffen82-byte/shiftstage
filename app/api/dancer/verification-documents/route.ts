import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { uploadOwnVerificationDocument } from "@/src/lib/dancr/dancer";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_DOCUMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Verification document file is required." }, { status: 400 });
    }

    if (!ALLOWED_DOCUMENT_TYPES.has(file.type)) {
      return NextResponse.json(
        { ok: false, error: "Verification document must be a JPEG, PNG, WebP, or PDF file." },
        { status: 400 },
      );
    }

    const storagePath = await uploadOwnVerificationDocument(client, user.id, {
      file,
      fileName: getFileName(file),
      contentType: file.type,
    });

    return NextResponse.json({ ok: true, storagePath });
  } catch (error) {
    return apiError(error, "Unable to upload verification document.");
  }
}

function getFileName(file: Blob) {
  return "name" in file && typeof file.name === "string" ? file.name : "verification-document";
}
