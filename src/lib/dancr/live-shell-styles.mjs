const STYLE_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

function mainStyleTag(html) {
  const match = [...html.matchAll(STYLE_PATTERN)].find(candidate =>
    candidate[1].includes("--bg: #050507;") && candidate[1].includes("--font-ui:"));
  if (!match) throw new Error("The production home shell stylesheet could not be found.");
  return match;
}

export function extractLiveShellStyles(html) {
  return mainStyleTag(html)[1];
}

export function externalizeLiveShellStyles(html, sourceUrl) {
  const match = mainStyleTag(html);
  // Preserve the exact cascade position, all declarations and the other styles.
  return html.replace(match[0], `<link rel="stylesheet" href="${sourceUrl}">`);
}
