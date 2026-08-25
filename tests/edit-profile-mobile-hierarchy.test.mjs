import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("Edit Profile marks its preview grid without changing the public profile grid", () => {
  assert.match(liveApp, /class="modal-grid \$\{options\.preview \? "is-editor-preview" : ""\}"/);
  assert.match(liveApp, /shiftsMarkup\(profile, status, \{ preview: Boolean\(options\.preview\), city \}\)/);
  assert.match(liveApp, /#approvedEditProfileDropdown\.show #approvedVisualProfileEditor \.modal-grid\.is-editor-preview/);
});

test("the phone editor uses a full-width, compact schedule and Club Deal hierarchy", () => {
  assert.match(
    liveApp,
    /@media \(max-width: 560px\) \{[\s\S]*?#approvedEditProfileDropdown\.show #approvedVisualProfileEditor \.modal-grid\.is-editor-preview \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important;/,
  );
  assert.match(liveApp, /\.profile-schedule-primary \{[\s\S]*?border-radius: 999px !important;[\s\S]*?white-space: nowrap !important;/);
  assert.match(liveApp, /\.modal-grid\.is-editor-preview :is\(\.profile-qr-tile, \[data-club-deal-state\]\) \{[\s\S]*?grid-column: 1 \/ -1 !important;/);
  assert.match(liveApp, /#approvedProfileVideoStatus \{[\s\S]*?margin-right: 62px !important;/);
});

test("editor guidance stays concise and inactive profile deals retain their slot", () => {
  assert.match(liveApp, /This is how your next shift appears to guests\./);
  assert.match(liveApp, /function profileDealTileMarkup\(profile\)[\s\S]*?if \(state\.key === "available"\)[\s\S]*?profile-club-deal-tile is-inactive/);
  assert.match(liveApp, /label: "Available after check-in"[\s\S]*?Deals activate after a verified check-in/);
  assert.match(liveApp, /label: "No active club deal"[\s\S]*?Deals activate after a verified club check-in\./);
  assert.doesNotMatch(liveApp, /Unlocks after you verify you're working and the venue has an active offer\./);
  assert.match(liveApp, /This is the dancer's next posted shift\. Follow or turn on notifications for schedule updates\./);
  assert.match(liveApp, /const emptyScheduleCopy = isEditorPreview[\s\S]*?`Follow \$\{escapeHtml\(profile\.name\)\} for updates`;/);
  assert.match(liveApp, /<strong>No shift posted<\/strong>[\s\S]*?<span>\$\{emptyScheduleCopy\}<\/span>/);
});
