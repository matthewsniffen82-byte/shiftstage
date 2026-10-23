import "server-only";
import type OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

export const MEDIA_VISUAL_MODEL = "gpt-6-astra";
export const MEDIA_VISUAL_SERVICE_TIER = "fast";

type VisualRequest = Pick<ResponseCreateParamsNonStreaming, "instructions" | "input" | "text">;

/** One provider configuration for every custom media check; no alternate model. */
export function createMediaVisualResponse(openai: OpenAI, request: VisualRequest, options: OpenAI.RequestOptions) {
  const body = {
    ...request,
    model: MEDIA_VISUAL_MODEL,
    service_tier: MEDIA_VISUAL_SERVICE_TIER,
    store: false,
    reasoning: { effort: "low" },
    // Reasoning tokens share this budget with the short, strict JSON result.
    max_output_tokens: 2_000,
  };
  // SDK 5's service-tier union predates the Fast alias. The API accepts this exact
  // payload; keep the compatibility assertion at this single tested boundary.
  return openai.responses.create(body as unknown as ResponseCreateParamsNonStreaming, options);
}
