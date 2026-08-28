import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BROWSER_AUTH_SESSION_KEY,
  clearBrowserAuthSession,
  persistBrowserAuthSession,
  persistRefreshedBrowserAuthSession,
  readBrowserAccessToken,
  readBrowserAuthSession,
} from "../src/lib/dancr/browser-session.ts";

const [
  boundarySource,
  headerSource,
  dancerActionsSource,
  venueActionsSource,
  directionsSource,
  tvSource,
  nfcSource,
  dealRedemptionSource,
  venueClaimSource,
  venueInvitationSource,
  dmcaCounterSource,
  accountSource,
] = await Promise.all([
  readFile(new URL("../src/lib/dancr/browser-session.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/PublicProfileHeader.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/VenueProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/DirectionsLink.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/nfc/[token]/NfcTapClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/deals/redeem/[token]/RedeemDealClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/claim/VenueClaimForm.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venue-team/invite/[token]/VenueTeamInviteClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dmca/counter/[id]/DmcaCounterForm.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
]);

test("the browser auth boundary safely reads sessions and enforces optional account roles", () => {
  const previousWindow = globalThis.window;
  const stored = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return stored.get(key) ?? null;
      },
      setItem(key, value) {
        stored.set(key, String(value));
      },
      removeItem(key) {
        stored.delete(key);
      },
    },
  };

  try {
    stored.set(BROWSER_AUTH_SESSION_KEY, JSON.stringify({
      accessToken: "customer-access",
      account: { role: "customer", displayName: "Customer" },
    }));
    assert.deepEqual(readBrowserAuthSession(), {
      accessToken: "customer-access",
      account: { role: "customer", displayName: "Customer" },
    });
    assert.equal(readBrowserAccessToken(), "customer-access");
    assert.equal(readBrowserAccessToken("customer"), "customer-access");
    assert.equal(readBrowserAccessToken("dancer"), "");

    stored.set(BROWSER_AUTH_SESSION_KEY, "not-json");
    assert.equal(readBrowserAuthSession(), null);
    assert.equal(readBrowserAccessToken(), "");

    stored.set(BROWSER_AUTH_SESSION_KEY, JSON.stringify([]));
    assert.equal(readBrowserAuthSession(), null);

    stored.set(BROWSER_AUTH_SESSION_KEY, JSON.stringify({
      accessToken: 123,
      account: { role: "customer" },
    }));
    assert.equal(readBrowserAccessToken("customer"), "");

    assert.equal(persistBrowserAuthSession({
      accessToken: "venue-access",
      refreshToken: "venue-refresh",
      expiresAt: 100,
      account: { role: "venue", email: "venue@example.com" },
    }), true);
    assert.equal(readBrowserAccessToken("venue"), "venue-access");
    assert.equal(persistRefreshedBrowserAuthSession({
      accessToken: "rotated-access",
      expiresAt: 200,
    }), true);
    assert.deepEqual(readBrowserAuthSession(), {
      accessToken: "rotated-access",
      refreshToken: "venue-refresh",
      expiresAt: 200,
      account: { role: "venue", email: "venue@example.com" },
    });
    assert.equal(persistBrowserAuthSession({ account: { role: "venue" } }), false);
    assert.equal(persistRefreshedBrowserAuthSession([]), false);
    assert.equal(clearBrowserAuthSession(), true);
    assert.equal(readBrowserAuthSession(), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("the standalone account surface uses the canonical session lifecycle", () => {
  assert.match(accountSource, /readBrowserAuthSession\(\)/);
  assert.match(accountSource, /persistBrowserAuthSession\(session\)/);
  assert.match(accountSource, /clearBrowserAuthSession\(\)/);
  assert.doesNotMatch(accountSource, /dancrAuthSessionV1/);
  assert.doesNotMatch(accountSource, /const SESSION_KEY/);
  assert.doesNotMatch(accountSource, /window\.localStorage\.(?:getItem|setItem|removeItem)\(/);
});

test("public profile, venue, directions, and TV clients share one authenticated-session reader", () => {
  assert.match(boundarySource, /export const BROWSER_AUTH_SESSION_KEY = "dancrAuthSessionV1"/);
  assert.match(boundarySource, /typeof window === "undefined"/);
  assert.match(boundarySource, /!Array\.isArray\(parsed\)/);

  for (const source of [
    headerSource,
    dancerActionsSource,
    venueActionsSource,
    directionsSource,
    tvSource,
  ]) {
    assert.match(source, /from "@\/src\/lib\/dancr\/browser-session"/);
    assert.doesNotMatch(source, /const SESSION_KEY = "dancrAuthSessionV1"/);
    assert.doesNotMatch(source, /localStorage\.getItem\("dancrAuthSessionV1"\)/);
  }

  assert.match(headerSource, /readBrowserAuthSession\(\)/);
  assert.match(dancerActionsSource, /readBrowserAccessToken\("customer"\)/);
  assert.match(venueActionsSource, /readBrowserAccessToken\("customer"\)/);
  assert.match(directionsSource, /readBrowserAccessToken\(\)/);
  assert.match(tvSource, /readBrowserAccessToken\("customer"\)/);
  assert.match(tvSource, /readBrowserAccessToken\(\)/);
  assert.match(tvSource, /readBrowserAuthSession\(\)/);

  assert.match(tvSource, /const VIEWER_SESSION_KEY = "mydancrTvViewerSessionV1"/);
  assert.match(tvSource, /function readViewerSessionId\(\)/);
  assert.match(tvSource, /window\.localStorage\.getItem\(VIEWER_SESSION_KEY\)/);
  assert.match(tvSource, /window\.localStorage\.setItem\(VIEWER_SESSION_KEY, id\)/);
});

test("public dancer profile state loads cancel when the dancer or shift changes", () => {
  const stateLoader = dancerActionsSource.match(
    /useEffect\(\(\) => \{[\s\S]*?setSavedLoaded\(false\);[\s\S]*?\}, \[actionShiftId, dancerId, setGoingCount\]\);/,
  )?.[0] || "";

  assert.match(stateLoader, /const controller = new AbortController\(\);/);
  assert.match(stateLoader, /fetch\(`\/api\/customer\/going\?shiftId=[\s\S]*?signal: controller\.signal/);
  assert.match(stateLoader, /fetch\("\/api\/customer\/saved", \{[\s\S]*?signal: controller\.signal/);
  assert.match(stateLoader, /if \(controller\.signal\.aborted\) return;/);
  assert.match(stateLoader, /return \(\) => controller\.abort\(\);/);
  assert.doesNotMatch(stateLoader, /let active = true;/);
});

test("venue profile saved state ignores responses after the venue changes", () => {
  assert.match(venueActionsSource, /fetch\("\/api\/customer\/saved", \{[\s\S]*?signal: controller\.signal/);
  assert.equal((venueActionsSource.match(/if \(controller\.signal\.aborted\) return;/g) || []).length, 2);
  assert.match(venueActionsSource, /return \(\) => controller\.abort\(\);/);
});

test("standalone NFC, redemption, venue access, and DMCA clients use the same session boundary", () => {
  for (const source of [
    nfcSource,
    dealRedemptionSource,
    venueClaimSource,
    venueInvitationSource,
    dmcaCounterSource,
  ]) {
    assert.match(source, /from "@\/src\/lib\/dancr\/browser-session"/);
    assert.doesNotMatch(source, /dancrAuthSessionV1/);
    assert.doesNotMatch(source, /const SESSION_KEY/);
  }

  assert.match(nfcSource, /readBrowserAuthSession\(\)/);
  assert.match(nfcSource, /persistRefreshedBrowserAuthSession\(data\.session\)/);
  assert.doesNotMatch(nfcSource, /function readAuthSession\(|function persistRefreshedSession\(/);
  assert.match(nfcSource, /const TAP_SESSION_KEY = "mydancrNfcTapSessionV1"/);
  assert.match(nfcSource, /const DEAL_INTENT_KEY = "mydancrPendingNfcDealV2"/);

  assert.match(dealRedemptionSource, /readBrowserAccessToken\("venue"\)/);
  assert.doesNotMatch(dealRedemptionSource, /function readVenueSession\(/);
  assert.match(dealRedemptionSource, /const DEAL_SESSION_KEY = "mydancrDealSessionV1"/);

  assert.match(venueClaimSource, /readBrowserAuthSession\(\)/);
  assert.match(venueClaimSource, /persistBrowserAuthSession\(nextSession\)/);
  assert.doesNotMatch(venueClaimSource, /function readSession\(/);
  assert.match(venueInvitationSource, /persistBrowserAuthSession\(\{/);
  assert.match(dmcaCounterSource, /readBrowserAccessToken\(\)/);
  assert.doesNotMatch(dmcaCounterSource, /function readToken\(/);
});

test("venue invitation discovery cancels stale token loads", () => {
  assert.match(venueInvitationSource, /fetch\(`\/api\/venue\/team\/invitations\?token=\$\{encodeURIComponent\(token\)\}`, \{[\s\S]*?signal: controller\.signal/);
  assert.equal((venueInvitationSource.match(/if \(controller\.signal\.aborted\) return;/g) || []).length, 2);
  assert.match(venueInvitationSource, /return \(\) => controller\.abort\(\);/);
  assert.doesNotMatch(venueInvitationSource, /let cancelled = false;/);
});

test("venue invitation acceptance prevents duplicate and stale submissions", () => {
  assert.match(venueInvitationSource, /const mountedRef = useRef\(false\);/);
  assert.match(venueInvitationSource, /const submitAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(venueInvitationSource, /const submitInFlightRef = useRef\(false\);/);
  assert.match(venueInvitationSource, /if \(!invitation \|\| submitInFlightRef\.current\) return;/);
  assert.match(venueInvitationSource, /fetch\("\/api\/auth", \{[\s\S]*?signal: controller\.signal/);
  assert.match(venueInvitationSource, /if \(!mountedRef\.current \|\| controller\.signal\.aborted\) return;/);
  assert.match(venueInvitationSource, /submitAbortRef\.current\?\.abort\(\);/);
  assert.match(venueInvitationSource, /if \(mountedRef\.current && !redirecting\) setIsWorking\(false\);/);
});
