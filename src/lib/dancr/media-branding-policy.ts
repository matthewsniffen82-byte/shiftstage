import type { DancrImageModerationDecision } from "./moderation-policy.ts";

export type MediaBrandingAnalysis = {
  branding: "absent" | "present" | "uncertain";
  brandingConfidence: number;
};

export const MEDIA_BRANDING_RULES = [
  "REJECT any clearly visible branding or logo, of any kind, anywhere in the uploaded image or video frames. This includes brand names or wordmarks, symbols, venue/club logos, personal/channel watermarks, and business, organization, school, or sports marks.",
  "Inspect clothing, footwear, accessories, jewelry, devices, vehicles, products, packaging, signs, backgrounds, reflections, and overlays. Incidental placement, small size, ownership, permission, and the brand's identity do not create exceptions. A clearly identifiable logo counts even when you cannot name its brand. Uploaded MyDancr marks count too.",
  "Choose REVIEW for possible branding or logos when blur, size, occlusion, stylization, or image quality makes the finding questionable. Do not infer a brand from an ordinary shape, plain pattern, or generic text alone. Brand mentions only in a caption or audio are not visible branding.",
  "Report branding separately as absent, present, or uncertain, and brandingConfidence from 0 to 1 for certainty in that finding across the entire supplied media. Use visible_branding_or_logo for clear branding and branding_or_logo_uncertain for questionable branding. Only confidently absent branding may be approved.",
] as const;

export function parseMediaBrandingAnalysis(value: unknown): MediaBrandingAnalysis {
  const { branding, brandingConfidence } = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (typeof branding !== "string" || !["absent", "present", "uncertain"].includes(branding)
    || typeof brandingConfidence !== "number" || !Number.isFinite(brandingConfidence)
    || brandingConfidence < 0 || brandingConfidence > 1) {
    throw new Error("provider_response_incomplete: branding review");
  }
  return { branding: branding as MediaBrandingAnalysis["branding"], brandingConfidence };
}

export function evaluateMediaBranding(value: MediaBrandingAnalysis): {
  decision: DancrImageModerationDecision; reasonCode: string;
} {
  const analysis = parseMediaBrandingAnalysis(value);
  if (analysis.brandingConfidence >= 0.95) {
    if (analysis.branding === "present") return { decision: "rejected", reasonCode: "visible_branding_or_logo" };
    if (analysis.branding === "absent") return { decision: "approved", reasonCode: "branding_clear" };
  }
  return { decision: "review", reasonCode: "branding_or_logo_uncertain" };
}
