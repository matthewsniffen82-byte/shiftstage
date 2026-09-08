// Translate older display text without changing tap URLs or internal identifiers.
export function phoneTapCopy(value: string) {
  return value.replace(/https?:\/\/\S+|(^|[^\w/:?&=%@])NFC(?:\s+(links?|tags?|stickers?|taps?))?(?![\w/:])/gi, (match, prefix: string | undefined, noun: string | undefined, offset: number) => {
    if (prefix === undefined) return match;
    const plural = noun?.toLowerCase().endsWith("s");
    let replacement = /^links?$/i.test(noun || "")
      ? plural ? "links that appear" : "link that appears"
      : /^(tags?|stickers?)$/i.test(noun || "")
        ? plural ? "tap stickers" : "tap sticker"
        : plural ? "phone taps" : "phone tap";
    if (!value.slice(0, offset).trim() || /[.!?]\s*$/.test(value.slice(0, offset) + prefix)) {
      replacement = replacement[0].toUpperCase() + replacement.slice(1);
    }
    return prefix + replacement;
  });
}
