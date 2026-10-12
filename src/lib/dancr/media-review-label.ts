/** A profile's approval never substitutes for an individual upload's review. */
export function mediaReviewLabel(status: string, moderationStatus = "") {
  const state = String(status || "").trim().toLowerCase();
  if (state === "approved" || state === "live") return "Approved";
  if (state === "rejected" || state === "denied") return "Not approved";
  if (state === "uploading") return "Upload incomplete";
  if (state === "failed") return "Upload failed";
  if (state === "hidden" || state === "removed") return "Removed";
  if (state === "expired") return "Expired";
  const review = String(moderationStatus || state).trim().toLowerCase();
  if (["pending_review", "submitted", "review", "completed"].includes(review)) return "Awaiting review";
  if (["error", "moderation_error", "moderation_retry"].includes(review)) return "Review delayed";
  if (["pending", "moderating"].includes(state)) return "Checking";
  return "Check upload status";
}

/** Owner-facing feedback only: never display raw provider diagnostics or guess a missing reason. */
export function mediaReviewExplanation(kind: "photo" | "video", status: string, {
  moderationStatus = "", reasonCodes, message,
}: { moderationStatus?: string; reasonCodes?: unknown; message?: unknown } = {}) {
  const label = mediaReviewLabel(status, moderationStatus);
  if (["Approved", "Removed", "Expired"].includes(label)) return "";
  const rejected = label === "Not approved";
  const codes = Array.isArray(reasonCodes) ? reasonCodes.filter((code): code is string => typeof code === "string") : [];
  // Video safety checks prefix frame/text reasons; the content policy prefixes photo/video reasons.
  const reasons = new Set(codes.map(code => code.toLowerCase().replace(/^(frame_\d+_|text_|photo_policy_|policy_)/, "")));
  const has = (...values: string[]) => values.some(value => reasons.has(value));
  const notes: string[] = [];
  if (has("multiple_people_detected")) notes.push(`The check detected more than one person. Choose a ${kind} showing only you, including in the background.`);
  if (has("person_count_uncertain", "dancer_visibility_uncertain")) notes.push(`We couldn't confirm that you are the only person shown. This ${kind} needs a manual review.`);
  if (has("dancer_not_visible", "avatar_face_required")) notes.push(`We couldn't find a clear view of you. Choose a clearer ${kind} of yourself.`);
  if (has("visible_branding_or_logo")) notes.push(`Branding, a logo, or a watermark was detected. Choose a ${kind} without these, including on clothing and in the background.`);
  if (has("branding_or_logo_uncertain")) notes.push("Possible branding or a logo needs a manual review.");
  if (has("copyright_or_consent_uncertain")) notes.push(`We couldn't confirm the rights or consent for this ${kind}. It needs a manual review.`);
  if (has("unreadable_or_obscured_content")) notes.push(`Part of this ${kind} is unclear or obscured. It needs a manual review, or you can replace it with a clearer one.`);
  const concerns: [string[], string, string][] = [
    [["nudity_rejected", "explicit_sexual_content_rejected", "explicit_nudity_or_sex_act"], "nudity or sexual activity", "Choose content with intimate areas covered and no sexual activity."],
    [["minor_safety_rejected", "minor_or_age_uncertain"], "age eligibility", "Everyone shown must be 18 or older."],
    [["sexual_services_or_solicitation"], "sexual services or solicitation", "Remove the solicitation or choose different content."],
    [["contact_or_payment_overlay"], "contact or payment information", "Remove phone numbers, emails, payment or social handles, and QR codes, then upload again."],
    [["violent_content_rejected", "illicit_violent_content_rejected", "violence_gore_or_weapon_threat"], "violence or threatening content", "Choose content without violence, gore, or weapon threats."],
    [["drug_use_or_sales"], "drug use or sales", "Choose content without drug use or sales."],
    [["self_harm_content_rejected", "self_harm"], "self-harm content", "Choose content without self-harm."],
    [["threatening_hate_content_rejected", "hate_harassment_or_threat"], "hate, harassment, or threats", "Choose content without hate, harassment, or threats."],
    [["nonconsensual_or_coercive_content"], "consent or coercion", "Only upload content made and shared with permission."],
    [["impersonation_or_deceptive_media"], "impersonation or deceptive edits", "Choose original content of yourself."],
  ];
  for (const [matches, concern, guidance] of concerns) {
    if (has(...matches)) notes.push(rejected ? `Flagged for ${concern}. ${guidance}` : `Possible ${concern} needs a manual review.`);
  }
  if (has("sexual_content_requires_review")) notes.push(`The automatic check couldn't confirm that this ${kind} meets the nudity and sexual-content rules. It needs a manual review.`);
  if (!notes.length && [...reasons].some(reason => reason.startsWith("provider_flagged_"))) notes.push("The automatic safety check flagged content that needs a manual review.");
  if (!rejected && !notes.length && (label === "Review delayed" || [...reasons].some(reason => /^(provider_(?!not_flagged|flagged_)|openai_|image_url_|image_load_|storage_image_|database_update_failed|moderation_unknown_error|video_moderation_|video_decode_failed|public_watermark_processing_failed|approved_publication_unconfirmed|missing_openai_|invalid_openai_)/.test(reason)))) {
    const problem = has("provider_timeout", "openai_timeout", "video_moderation_timeout")
      ? "The automatic check timed out."
      : has("provider_rate_limited", "openai_rate_limited")
      ? "The review service is busy and couldn't finish the check."
      : has("provider_response_incomplete", "openai_response_incomplete", "video_moderation_incomplete")
      ? "The automatic check returned an incomplete result."
      : has("video_decode_failed", "provider_invalid_content_type", "image_url_invalid_content_type", "provider_private_download_unsupported_type")
      ? `The automatic check couldn't read this ${kind}. Try another file format.`
      : "The automatic check couldn't finish because of a processing problem.";
    notes.push(`${problem} This is not a rejection. Retry the check or replace the ${kind}.`);
  }
  // A saved moderator note takes precedence over automatic reasons. Ignore legacy generic receipts.
  const savedMessage = typeof message === "string" ? message.trim() : "";
  const genericMessage = /^(Your photo was uploaded and is awaiting|Photo uploaded, but moderation stopped|Automatically approved|Automated safety review requested human review|This video did not meet MyDancr TV safety guidelines|This photo does not meet Dancr's photo guidelines|Rejected by admin moderation\.)/i;
  if (savedMessage && !genericMessage.test(savedMessage)) return savedMessage;
  if (notes.length) return [...new Set(notes)].join(" ");
  if (rejected) return `This ${kind} wasn't approved, but a specific reason wasn't saved. You can replace it with another ${kind}.`;
  if (label === "Awaiting review") return `This ${kind} needs a manual check before approval. A more specific reason wasn't provided. You can wait for review or replace it.`;
  if (label === "Upload incomplete" || label === "Upload failed") return `The upload didn't finish. Retry or choose another ${kind}.`;
  return `The automatic check is still running. This ${kind} will stay here until a decision is ready.`;
}
