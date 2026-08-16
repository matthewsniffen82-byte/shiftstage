import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  liveShell,
  dancerTvStudio,
  dashboardClient,
  venueNfcPanel,
  venueTeamPanel,
  adminNfcPanel,
] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueNfcTagPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/VenueTeamPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminNfcInventoryPanel.tsx", import.meta.url), "utf8"),
]);

test("secondary account panels do not claim data is empty while requests are loading", () => {
  assert.match(
    dancerTvStudio,
    /\{!isLoading && workspace && !workspace\.videos\.length \? <p className="tv-no-videos">No videos submitted yet\.<\/p>/,
  );
  assert.match(
    dashboardClient,
    /const \[isLoading, setIsLoading\] = useState\(true\);[\s\S]*?disabled=\{isLoading \|\| isSaving \|\| !venues\.length\}[\s\S]*?\{!isLoading && !activeAffiliations\.length \? <small>No venue has verified your profile yet\.<\/small>/,
  );
  assert.match(
    venueNfcPanel,
    /const \[isLoading, setIsLoading\] = useState\(true\);[\s\S]*?: !isLoading \? <p>No dancers have tapped this venue&apos;s dressing-room sticker yet\.<\/p>/,
  );
  assert.match(
    venueTeamPanel,
    /const \[isLoading, setIsLoading\] = useState\(true\);[\s\S]*?\{!isLoading && !activity\.length \? <p>No venue team changes have been recorded yet\.<\/p>/,
  );
  assert.match(
    adminNfcPanel,
    /const \[isLoading, setIsLoading\] = useState\(true\);[\s\S]*?\{!isLoading && !tags\.length \? <p>No NFC stickers have been assigned\.<\/p>/,
  );
});

test("legacy dashboard notifications and support distinguish loading, error, and empty states", () => {
  assert.match(
    liveShell,
    /let liveNotificationsState = authSession\?\.accessToken \? "loading" : "idle";[\s\S]*?if \(liveNotificationsState === "loading"\)[\s\S]*?Loading notifications…[\s\S]*?if \(liveNotificationsState === "error"\)[\s\S]*?Notifications are temporarily unavailable\.[\s\S]*?No notifications yet\./,
  );
  assert.match(
    liveShell,
    /let liveSupportThreadsState = authSession\?\.accessToken \? "loading" : "idle";[\s\S]*?if \(liveSupportThreadsState === "loading"\)[\s\S]*?Loading support conversations…[\s\S]*?if \(liveSupportThreadsState === "error"\)[\s\S]*?Support conversations are temporarily unavailable\.[\s\S]*?No support conversations yet\./,
  );
  assert.match(
    liveShell,
    /async function loadLiveNotifications\(\)[\s\S]*?liveNotificationsState = "loading";[\s\S]*?liveNotificationsState = "ready";[\s\S]*?liveNotificationsState = "error";/,
  );
  assert.match(
    liveShell,
    /async function loadLiveSupportThreads\(\)[\s\S]*?liveSupportThreadsState = "loading";[\s\S]*?liveSupportThreadsState = "ready";[\s\S]*?liveSupportThreadsState = "error";/,
  );
});

test("legacy customer dashboard uses loading placeholders until saved data settles", () => {
  assert.match(
    liveShell,
    /let liveCustomerDashboardState = authSession\?\.accessToken[\s\S]*?async function loadLiveCustomerDashboardData\(\)[\s\S]*?liveCustomerDashboardState = "loading";[\s\S]*?liveCustomerDashboardState = loaded \? "ready" : "error";/,
  );
  assert.match(
    liveShell,
    /const dashboardLoading = liveCustomerDashboardState === "loading";[\s\S]*?Loading your saved dancers, clubs, and private alerts…[\s\S]*?Loading followed dancers working now…[\s\S]*?Loading followed clubs…/,
  );
  assert.match(
    liveShell,
    /dashTonightViewAll\.hidden = dashboardLoading \|\| dashboardError[\s\S]*?dashVenueViewAll\.hidden = dashboardLoading \|\| dashboardError/,
  );
});
