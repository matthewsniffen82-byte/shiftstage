const INLINE_SCRIPT_PATTERN = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;
const LIVE_APP_MARKERS = ["const markets = {", "installReferenceHomeShell();"];

export function extractLiveShellAppScript(html) {
  const match = [...html.matchAll(INLINE_SCRIPT_PATTERN)].find((candidate) => (
    LIVE_APP_MARKERS.every((marker) => (candidate[1] || "").includes(marker))
  ));
  if (!match) throw new Error("The production home shell application script could not be found.");
  return match[1] || "";
}

export function externalizeLiveShellAppScript(html, sourceUrl) {
  const appScript = extractLiveShellAppScript(html);
  const inlineTag = `<script>${appScript}</script>`;
  if (!html.includes(inlineTag)) {
    throw new Error("The production home shell application script could not be externalized.");
  }
  const externalized = html.replace(inlineTag, `<script src="${sourceUrl}" defer></script>`);
  // Discover the main script before the large inline styles and hidden panels.
  // Keep execution in its original position after the companion scripts.
  return externalized
    .replace("<head>", `<head><link rel="preload" as="script" href="${sourceUrl}">`)
    .replace(/<script src="(\/(?:mydancr-api-transport|profile-photo-crop)\.js[^"]*)"><\/script>/g,
      '<script src="$1" defer></script>');
}
