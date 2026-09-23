import { MEDIA_BRANDING_RULES } from "./media-branding-policy.ts";

export const DANCER_MEDIA_POLICY_REASON_CODES = [
  "visible_branding_or_logo",
  "branding_or_logo_uncertain",
  "explicit_nudity_or_sex_act",
  "minor_or_age_uncertain",
  "sexual_services_or_solicitation",
  "contact_or_payment_overlay",
  "violence_gore_or_weapon_threat",
  "drug_use_or_sales",
  "self_harm",
  "hate_harassment_or_threat",
  "nonconsensual_or_coercive_content",
  "impersonation_or_deceptive_media",
  "copyright_or_consent_uncertain",
  "unreadable_or_obscured_content",
  "safe_adult_promotional_content",
] as const;

export type DancerMediaPolicyReason = typeof DANCER_MEDIA_POLICY_REASON_CODES[number];

// Keep the visible-content rules identical for original photos and video frames.
// Person counting is a separate required check for both upload types.
export const DANCER_MEDIA_CONTENT_RULES = [
  "APPROVE lawful adult promotional photos, dancing, stage performances, club scenes, bikinis, opaque lingerie, thongs, and revealing outfits when there is no prohibited content.",
  "Nudity is present for a fully nude person, visibly exposed genitals or anus, or a visibly identifiable bare nipple/areola on a breast. Count anatomy visible through sheer clothing only when the prohibited anatomy itself is actually visible.",
  "Thongs and cleavage are explicitly allowed when nipples/areolas, genitals, and anus are covered. Exposed buttocks from a thong, cleavage, the upper or side of a breast, bare midriffs, bare legs, lace patterns, and suggestive poses alone are not nudity or sexual activity. Do not invent hidden nipples or genitals underneath clothing.",
  "Sexual activity is present for visible sex acts or masturbation, regardless of clothing coverage.",
  "REJECT explicit nudity or sex acts; any confirmed minor; sexual services or solicitation; phone numbers, email addresses, payment handles, external social handles, or QR/contact overlays; drug use or sales; graphic violence, threatening weapons, self-harm, hate, harassment, or threats; coercion, trafficking, nonconsensual intimate content; or clearly deceptive impersonation/deepfake content.",
  "A clearly visible phone number, email address, payment handle, external social handle, or QR code requires rejection for contact_or_payment_overlay, including in backgrounds, promotional cards, or screenshots. A QR code is prohibited even if its destination cannot be decoded. Example/test contact details are still contact information. Base confidence in a visible violation on that evidence; it does not require identifying a person or verifying their age or ownership first.",
  "Choose REVIEW when age is uncertain, content is obscured or unreadable, rights/consent are uncertain, or confidence is not high enough to reject or approve.",
  "Base rights, consent, and deceptive-media concerns on evidence visible in the supplied content. The absence of external ownership documents or an identity reference is not itself evidence of a violation. Do not identify anyone or compare them with an avatar.",
  ...MEDIA_BRANDING_RULES,
  "Use safe_adult_promotional_content as the only reason for approval. For review or rejection, return the applicable concern reasons without safe_adult_promotional_content. Uncertain rights/consent or unreadable content alone requires review, not rejection.",
] as const;
