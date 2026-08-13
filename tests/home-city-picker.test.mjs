import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveShell, aesthetic] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("city discovery keeps the native select as a fallback and enhances it with a branded dialog", () => {
  assert.match(liveShell, /<select id="citySelect">[\s\S]*?<option>Las Vegas<\/option>[\s\S]*?<option>New York<\/option>[\s\S]*?<\/select>/);
  assert.match(liveShell, /id="cityPickerField"[\s\S]*?id="citySelectButton"[\s\S]*?aria-controls="citySelectDialog"/);
  assert.match(liveShell, /id="citySelectDialog"[\s\S]*?id="citySelectDialogTitle">Choose a city<[\s\S]*?id="citySelectOptions"[^>]*role="listbox"[\s\S]*?id="citySelectDone"/);
  assert.match(liveShell, /cityPickerField\.classList\.add\("is-enhanced"\)[\s\S]*?citySelect\.setAttribute\("aria-hidden", "true"\)[\s\S]*?citySelectButton\.hidden = false/);
  assert.match(aesthetic, /\.home-city-filter\.is-enhanced #citySelect[\s\S]*?clip-path: inset\(50%\)/);
});

test("city selection is keyboard accessible and applies through the existing production change flow", () => {
  assert.match(liveShell, /function openCityPicker\(\)[\s\S]*?citySelectDialog\.showModal\(\)[\s\S]*?querySelector\('\[aria-selected="true"\]'\)\?\.focus\(\)/);
  assert.match(liveShell, /function applyCityPickerSelection\(\)[\s\S]*?citySelect\.value = pendingCitySelection[\s\S]*?citySelect\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(liveShell, /citySelectOptions\?\.addEventListener\("keydown"[\s\S]*?ArrowDown[\s\S]*?ArrowUp[\s\S]*?Home[\s\S]*?End/);
  assert.match(liveShell, /citySelectDialog\?\.addEventListener\("cancel"[\s\S]*?closeCityPicker/);
});

test("mobile discovery uses compact neutral controls and a bottom-sheet city picker", () => {
  assert.match(aesthetic, /\.city-picker-dialog\[open\][\s\S]*?inset: auto 10px max\(10px, env\(safe-area-inset-bottom\)\)/);
  assert.match(aesthetic, /\.city-picker-trigger, \.home-filter-toggle[\s\S]*?min-height: 44px/);
  assert.match(aesthetic, /\.dancer-directory-filter\.is-active[\s\S]*?var\(--dancr-color-brand-primary\) 10%[\s\S]*?box-shadow: inset/);
});
