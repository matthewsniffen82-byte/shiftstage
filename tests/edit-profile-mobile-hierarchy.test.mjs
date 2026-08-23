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

test("editor guidance and unavailable profile QR messaging stay concise", () => {
  assert.match(liveApp, /This is how your next shift appears to guests\./);
  assert.match(liveApp, /Available when dancer is working/);
  assert.doesNotMatch(liveApp, /Unlocks after you verify you're working and the venue has an active offer\./);
  assert.match(liveApp, /This is the dancer's next posted shift\. Follow or turn on notifications for schedule updates\./);
  assert.match(liveApp, /This dancer has not posted an upcoming shift yet\. Follow or turn on notifications to see the next update\./);
});
