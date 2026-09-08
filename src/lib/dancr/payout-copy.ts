// Keep older provider messages readable without changing URLs or record identifiers.
export function payoutCopy(value: string) {
  return value.replace(/https?:\/\/\S+|(^|[^\w/:?&=%@])NATS(?:\s+(affiliate(?:\s+(?:account|login|link))?|account|username|enrollment|eligibility|commission|active|not active))?(?![\w/:])/gi, (match, prefix: string | undefined, noun: string | undefined, offset: number) => {
    if (prefix === undefined) return match;
    const phrase = noun?.toLowerCase();
    let replacement = phrase === "enrollment" ? "payout account setup"
      : phrase === "eligibility" ? "payout eligibility"
      : phrase === "commission" ? "commission"
      : phrase === "active" || phrase === "not active" ? `payout account ${phrase}`
      : phrase?.startsWith("affiliate") ? phrase.replace(/^affiliate/, "payout account").replace("account account", "account")
      : phrase === "account" || phrase === "username" ? `payout ${phrase}`
      : /\b(?:in|through)\s*$/i.test(value.slice(0, offset) + prefix) ? "the payout portal"
      : "the payout provider";
    if (!value.slice(0, offset).trim() || /[.!?]\s*$/.test(value.slice(0, offset) + prefix)) {
      replacement = replacement[0].toUpperCase() + replacement.slice(1);
    }
    return prefix + replacement;
  });
}
