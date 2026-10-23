export async function runVideoReviewChecks<Frames, Text, Policy, Identity>(checks: {
  frames: () => Promise<Frames>;
  text: () => Promise<Text>;
  visual: () => Promise<{ contentAnalysis: Policy; identityAnalysis: Identity }>;
}) {
  const frames = Promise.resolve().then(checks.frames);
  const text = Promise.resolve().then(checks.text);
  const visual = Promise.resolve().then(checks.visual);
  // Every check must finish before the caller evaluates approval or cleans up.
  const results = await Promise.allSettled([frames, text, visual]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return {
    frameResults: await frames,
    textResult: await text,
    policyDecision: (await visual).contentAnalysis,
    identityAnalysis: (await visual).identityAnalysis,
  };
}
