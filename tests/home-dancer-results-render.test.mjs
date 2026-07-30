import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeSource = fs.readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");

test("populated Dancers results render without the removed list-limit state", () => {
  assert.doesNotMatch(homeSource, /\bshouldLimit\b/);
  assert.match(
    homeSource,
    /const showsVenueDirectoryLink = activeTab === "venues" && !selectedVenue;[\s\S]*?viewAllBtn\.hidden = !showsVenueDirectoryLink \|\| !allItems\.length;/,
  );
  assert.match(
    homeSource,
    /if \(activeTab === "tonight" \|\| activeTab === "dancers"\) \{\s*renderHomeDancerGrid\(city, items, activeTab\);\s*return;/,
  );
});
