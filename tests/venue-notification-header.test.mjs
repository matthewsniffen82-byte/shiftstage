import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

test("venue accounts receive the global notification bell", () => {
  const quickActions =
    liveApp.match(/function renderCustomerQuickActions[\s\S]*?\n    }/)?.[0] || "";
  const quickPanel =
    liveApp.match(/function toggleCustomerQuickPanel[\s\S]*?\n    }/)?.[0] || "";

  assert.match(
    quickActions,
    /showNotifications = isCustomerSession\(\) \|\| isDancerSession\(\) \|\| isVenueSession\(\)/,
  );
  assert.match(
    quickPanel,
    /isCustomerSession\(\) \|\| isDancerSession\(\) \|\| isVenueSession\(\)/,
  );
  assert.match(liveApp, /aria-label="Open notifications"/);
  assert.match(
    liveApp,
    /No new alerts yet\. Venue account and dancer affiliation updates will appear here\./,
  );
});

test("opening a venue dashboard refreshes its real notifications", () => {
  const openVenueDashboard =
    liveApp.match(/async function loadAndRevealVenueDashboard[\s\S]*?\n    }/)?.[0] || "";

  assert.match(openVenueDashboard, /loadLiveNotifications\(\)/);
  assert.match(liveApp, /getAuthenticatedJson\("\/api\/notifications"\)/);
});
