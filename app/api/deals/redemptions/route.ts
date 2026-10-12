import { apiError } from "@/src/lib/api";
import { readBoundedJsonObject } from "@/src/lib/bounded-json-body";
import { admissionError, createAdmissionPass } from "@/src/lib/dancr/admission-passes";
import { requireSameOriginJsonMutation } from "@/src/lib/security/browser-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireSameOriginJsonMutation(request);
    const body = await readBoundedJsonObject(request, { maxBytes: 4096, invalidMessage: "Invalid admission request.", tooLargeMessage: "Admission request is too large." });
    return await createAdmissionPass(request, body);
  } catch (error) {
    return admissionError(error) || apiError(error, "Unable to generate your admission pass.");
  }
}
