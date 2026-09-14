import { readFile, writeFile } from "node:fs/promises";
import { extractLiveShellStyles, extractLiveShellOverrideStyles } from "../src/lib/dancr/live-shell-styles.mjs";
import { compactLiveShellStyles } from "../src/lib/dancr/compact-live-shell-styles.mjs";

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
