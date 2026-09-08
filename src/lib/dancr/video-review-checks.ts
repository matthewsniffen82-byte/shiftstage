export async function runVideoReviewChecks<Frames, Text, Policy, Identity>(checks: {
  frames: () => Promise<Frames>;
  text: () => Promise<Text>;
  policy: () => Promise<Policy>;
  identity: () => Promise<Identity>;
}) {
  const frames = Promise.resolve().then(checks.frames);
  const text = Promise.resolve().then(checks.text);
  const policy = Promise.resolve().then(checks.policy);
  const identity = Promise.resolve().then(checks.identity);
  // Every check must finish before the caller evaluates approval or cleans up.
  const results = await Promise.allSettled([frames, text, policy, identity]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return {
    frameResults: await frames,
    textResult: await text,
    policyDecision: await policy,
    identityAnalysis: await identity,
  };
}
