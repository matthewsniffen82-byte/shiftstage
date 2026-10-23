export const DANCER_PERSON_COUNT_RULES = [
  "Count every distinct visibly depicted person in the target media, including partial or background people and recognizable people on screens, posters, or photos.",
  "Do not double-count the same person's mirror reflection or the same person across video frames.",
  "singlePersonOnly may be true only when exactly one distinct person appears anywhere in the target media.",
  "The one-person rule applies to the entire original photo and to all supplied video frames together, not just the main subject or one person per frame. A different person appearing later still makes personCount greater than one.",
  "Count partially visible people even when their face is hidden. Do not ignore bystanders, cropped bodies, or background people because the foreground dancer is clear.",
  "personCountConfidence measures certainty that every distinct person has been counted. If blur, occlusion, or a possible background person makes the count uncertain, set singlePersonOnly to false and personCountConfidence below 0.9.",
] as const;
