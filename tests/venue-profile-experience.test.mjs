import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profilePage = await readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8");
const profileStyles = await readFile(new URL("../app/venues/[slug]/VenueProfile.module.css", import.meta.url), "utf8");
const profileActions = await readFile(new URL("../app/venues/[slug]/VenueProfileActions.tsx", import.meta.url), "utf8");

test("venue profiles separate verified working-now check-ins from future shifts", () => {
  assert.match(
    profilePage,
    /\.select\(`[\s\S]*?location_status,[\s\S]*?checked_in_at,[\s\S]*?checked_out_at,[\s\S]*?dancer_photos\(storage_path, is_primary, review_status, sort_order\)/,
  );
  assert.match(
    profilePage,
    /function isWorkingNow\(shift: VenueShift, now: Date\)[\s\S]*?shift\.location_status === "club_confirmed"[\s\S]*?shift\.location_status === "location_confirmed"[\s\S]*?shift\.checked_in_at[\s\S]*?startsAt <= nowTime && endsAt > nowTime/,
  );
  assert.match(
    profilePage,
    /const workingNow = shifts\.filter\(\(shift\) => isWorkingNow\(shift, now\)\);[\s\S]*?const upcoming = shifts\.filter\(\(shift\) => new Date\(shift\.starts_at\)\.getTime\(\) > now\.getTime\(\)\)/,
  );
  assert.match(profilePage, /<h2>Working now<\/h2>[\s\S]*?<h2>Upcoming shifts<\/h2>/);
  assert.match(profilePage, /No verified dancers are working now\./);
  assert.match(profilePage, /No upcoming shifts are posted\./);
  assert.doesNotMatch(profilePage, /Current and upcoming shifts|No upcoming posted shifts/);
});

test("venue profiles use the responsive Mydancr experience while preserving production actions", () => {
  assert.match(profilePage, /aria-label="Go to Mydancr home"[\s\S]*?mydanc<span>r<\/span>/);
  assert.match(profilePage, /<ClubDealCard[\s\S]*?sourceType="club_page"[\s\S]*?stickyCta/);
  assert.match(profilePage, /<VenueProfileActions venueId=\{venue\.id\}/);
  assert.match(profilePage, /<DirectionsLink address=\{venue\.address\} venueId=\{venue\.id\}/);
  assert.match(profilePage, /<TvVideoStrip title=\{`Tonight at \$\{venue\.name\}`\}/);
  assert.match(profilePage, /<VenueQrCode[\s\S]*?source="venue_page"/);
  assert.match(profilePage, /\/api\/public\/maps\/embed\?address=/);
  assert.doesNotMatch(profilePage, /function VenueProfileStyles|<Link href="\/">Dancr<\/Link>/);

  assert.match(profileStyles, /\.hero \{[\s\S]*?border-radius: 28px[\s\S]*?radial-gradient/);
  assert.match(profileStyles, /\.brand span \{[\s\S]*?color: #8730f5/);
  assert.match(profileStyles, /@media \(max-width: 720px\)[\s\S]*?\.hero \{[\s\S]*?grid-template-columns: 78px minmax\(0, 1fr\)/);
  assert.match(profileStyles, /\.dealSection :global\(\.club-deal-sticky\) \{[\s\S]*?bottom: calc\(78px \+ env\(safe-area-inset-bottom\)\)/);
});

test("venue follow controls keep their prior state when a production request fails", () => {
  assert.match(profileActions, /const \[isSaving, setIsSaving\] = useState\(false\)/);
  assert.match(profileActions, /const saved = await postVenueFollow[\s\S]*?if \(saved\) \{/);
  assert.match(profileActions, /response\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(profileActions, /catch \{[\s\S]*?Check your connection and try again/);
  assert.match(profileActions, /disabled=\{isSaving\}/);
  assert.match(profileActions, /<span role="status">\{status\}<\/span>/);
});
