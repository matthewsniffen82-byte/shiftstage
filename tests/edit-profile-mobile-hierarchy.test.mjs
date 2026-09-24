import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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

test("non-working guidance distinguishes the editor from guest discovery without reserving a deal slot", () => {
  const source = liveApp.slice(liveApp.indexOf("    function shiftsMarkup("), liveApp.indexOf("    async function refreshOpenProfileWorkingAlert("));
  const render = vm.runInNewContext(`${source}; shiftsMarkup`, {
    selectedCity: () => "Las Vegas",
    isWorkingTonight: profile => Boolean(profile.working),
    actionIconMarkup: () => "<svg></svg>",
    escapeHtml: value => value,
    escapeOptionValue: value => value,
    profileVenueDestinationMarkup: () => "<button>Club details</button>",
  });
  const dancer = { id: "sample", name: "Sample", working: false, scheduled: false };
  const editor = render(dancer, {}, { preview: true });
  const guest = render(dancer, {}, { preview: false });
  assert.match(editor, /Not working now/);
  assert.match(editor, /Tap a club’s dressing-room sticker/);
  assert.doesNotMatch(editor, /data-profile-working-alert|profile-club-deal-tile/);
  assert.match(guest, /Follow to get notified when Sample is working/);
  assert.match(guest, /data-profile-working-alert="sample"/);
  assert.doesNotMatch(guest, /profile-club-deal-tile/);
  assert.match(render({ ...dancer, working: true, scheduled: true }, {}, { preview: true }), /Working Now/);
  assert.match(liveApp, /const dealMarkup = profile\?\.scheduled[\s\S]*?: "";/);
});
