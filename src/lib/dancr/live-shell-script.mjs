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
  return html.replace(inlineTag, `<script src="${sourceUrl}" defer></script>`);
}
