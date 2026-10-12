import { readFile, writeFile } from "node:fs/promises";
import { extractLiveShellStyles, extractLiveShellOverrideStyles } from "../src/lib/dancr/live-shell-styles.mjs";
import { compactLiveShellStyles } from "../src/lib/dancr/compact-live-shell-styles.mjs";
import { savedVenueCardStyles } from "../src/lib/dancr/saved-venue-card-styles.mjs";

const html = (await readFile(new URL("../outputs/index.html", import.meta.url), "utf8")).replace(/\r\n?/g, "\n");
const css = compactLiveShellStyles(extractLiveShellStyles(html));
const target = new URL("../public/outputs/live-shell.css", import.meta.url);
if (await readFile(target, "utf8").catch(() => "") !== css) await writeFile(target, css);
const overrides = compactLiveShellStyles(extractLiveShellOverrideStyles(html));
const overrideTarget = new URL('../public/outputs/live-shell-overrides.css', import.meta.url);
if (await readFile(overrideTarget, 'utf8').catch(() => '') !== overrides) await writeFile(overrideTarget, overrides);

// The custom shell does not pass through Next's CSS minifier. Preserve the
// editable shared theme and publish a compact copy in the same cascade position.
const theme = compactLiveShellStyles(await readFile(new URL('../public/dancr-aesthetic.v1.css', import.meta.url), 'utf8'));
const themeTarget = new URL('../public/outputs/dancr-aesthetic.css', import.meta.url);
if (await readFile(themeTarget, 'utf8').catch(() => '') !== theme) await writeFile(themeTarget, theme);

// Preserve the source shell's stylesheet order for Saved's identical venue cards.
const cardSources = [];
for (const tag of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>|<link\b[^>]*href="([^"]+)"[^>]*>/gi)) {
  if (tag[1] !== undefined) cardSources.push(tag[1]);
  else if (tag[2]?.startsWith('/') && tag[2].split('?')[0].endsWith('.css')) {
    const path = tag[2].split('?')[0].replace('/outputs/dancr-aesthetic.css', '/dancr-aesthetic.v1.css');
    cardSources.push(await readFile(new URL(`../public${path}`, import.meta.url), 'utf8'));
  }
}
const savedCards = '/* Generated from the discovery card styles; edit their source styles instead. */\n' + compactLiveShellStyles(savedVenueCardStyles(cardSources));
const savedCardsTarget = new URL('../app/dashboard/saved-venue-cards.generated.css', import.meta.url);
if (await readFile(savedCardsTarget, 'utf8').catch(() => '') !== savedCards) await writeFile(savedCardsTarget, savedCards);
