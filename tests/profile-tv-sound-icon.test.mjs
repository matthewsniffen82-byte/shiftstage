import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const iconSource = liveApp.match(
  /function modalVideoSoundIcon\(muted\) \{[\s\S]*?(?=\n    function clearModalVideoControlsHideTimer)/,
)?.[0] || "";
const renderSoundIcon = new Function(`${iconSource}; return modalVideoSoundIcon;`)();

test("profile sound icons define their own outline outside the profile backdrop", () => {
  for (const muted of [true, false]) {
    const icon = renderSoundIcon(muted);
    assert.match(icon, /<svg[^>]*fill="none"/);
    assert.match(icon, /<svg[^>]*stroke="currentColor"/);
    assert.match(icon, /<svg[^>]*stroke-width="1\.9"/);
    assert.match(icon, /<svg[^>]*stroke-linecap="round"/);
    assert.match(icon, /<svg[^>]*stroke-linejoin="round"/);
    assert.match(icon, /class="profile-modal-media-control-icon"/);
    assert.match(icon, /viewBox="0 0 24 24"/);
    assert.match(icon, /aria-hidden="true"/);
    assert.match(icon, /M4 10v4h4l5 4V6L8 10H4Z/);
    assert.equal((icon.match(/<path /g) || []).length, 3);
    assert.equal(icon.includes('d="m17 9 4 6"'), muted);
    assert.equal(icon.includes('d="M16 9.5a4 4 0 0 1 0 5"'), !muted);
  }
});
