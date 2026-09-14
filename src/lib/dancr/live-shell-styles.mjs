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

function overrideStyleTag(html) {
  const match = [...html.matchAll(STYLE_PATTERN)].find(candidate => candidate[1].trimStart().startsWith('main.stack,'));
  if (!match) throw new Error('The production home shell override stylesheet could not be found.');
  return match;
}

export function extractLiveShellOverrideStyles(html) {
  return overrideStyleTag(html)[1];
}

export function externalizeLiveShellStyles(html) {
  // Keep both sheets in their exact cascade positions. The root route adds
  // content hashes to these URLs, allowing reuse across cached page visits.
  const main = mainStyleTag(html);
  const overrides = overrideStyleTag(html);
  return html.replace(main[0], '<link rel="stylesheet" href="/outputs/live-shell.css">')
    .replace(overrides[0], '<link rel="stylesheet" href="/outputs/live-shell-overrides.css">');
}

export function inlineLiveShellStyles(html, css) {
  const match = mainStyleTag(html);
  // Preserve the exact cascade position, all declarations and the other styles.
  return html.replace(match[0], () => `<style>${css}</style>`);
}
