import { PublicApiError } from "./api-error-policy.ts";
import { readBoundedRequestBytes } from "./bounded-json-body.ts";

type BoundedFormDataOptions = {
  maxBytes: number;
  invalidMessage: string;
  tooLargeMessage: string;
};

export async function readBoundedFormData(
  request: Request,
  options: BoundedFormDataOptions,
): Promise<FormData> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw invalid(options.invalidMessage);
  }

  const bytes = await readBoundedRequestBytes(request, options.maxBytes, options.tooLargeMessage);
  try {
    const bufferedRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: bytes as BodyInit,
    });
    return await bufferedRequest.formData();
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw invalid(options.invalidMessage);
  }
}

function invalid(message: string) {
  return new PublicApiError("INVALID_REQUEST", message, 400);
}
