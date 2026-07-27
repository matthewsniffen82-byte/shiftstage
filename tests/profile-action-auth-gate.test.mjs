import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [homeSource, actionsSource, profilePageSource, reportsRouteSource] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
]);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Expected ${start}`);
  assert.notEqual(endIndex, -1, `Expected ${end}`);
  return source.slice(startIndex, endIndex);
}

test("account-only live modal actions check for a customer profile while Going stays public", () => {
  const handler = sourceBetween(
    homeSource,
    'modalBody.addEventListener("click"',
    'const modalCloseButton = document.getElementById("modalClose")',
  );

  assert.match(handler, /#followBtn, #notifyBtn, #goingBtn, #reportBtn/);
  assert.match(
    handler,
    /if \(actionButton\.id !== "goingBtn" && !requireCustomerAccountForProfileAction\(actionButton\)\) return/,
  );
  assert.ok(
    handler.indexOf("requireCustomerAccountForProfileAction(actionButton)") <
      handler.indexOf('if (actionButton.id === "followBtn")'),
    "The account gate must run before any account-only optimistic update.",
  );
});

test("signed-out profile actions open a dismissible account prompt with working signup and sign-in links", () => {
  assert.match(
    homeSource,
    /id="accountRequiredPopover" role="dialog" aria-modal="true"[^>]*hidden/,
  );
  assert.match(homeSource, /id="accountRequiredClose"[^>]*aria-label="Close account prompt"/);
  assert.match(
    homeSource,
    /id="accountRequiredCreateLink" href="\/account\?role=customer&amp;mode=signup"/,
  );
  assert.match(
    homeSource,
    /id="accountRequiredSignInLink" href="\/account\?role=customer"/,
  );
  assert.match(homeSource, /accountRequiredClose\?\.addEventListener\("click"/);
  assert.match(
    homeSource,
    /if \(event\.target === accountRequiredPopover\) closeAccountRequiredPrompt\(\)/,
  );
  assert.match(
    homeSource,
    /if \(accountRequiredPopover && !accountRequiredPopover\.hidden\) \{\s+closeAccountRequiredPrompt\(\)/,
  );
  assert.match(homeSource, /accountRequiredCreateLink\?\.addEventListener\("click"[\s\S]*openFreshCustomerSignup\(\)/);
});

test("public Next profiles keep all actions visible while signed out and gate only account-owned actions", () => {
  assert.doesNotMatch(actionsSource, /if \(!token\) \{\s+return/);
  for (const action of ["follow", "notify", "report"]) {
    assert.match(
      actionsSource,
      new RegExp(`requireCustomerAccount\\("${action}"\\)`),
    );
  }
  assert.doesNotMatch(actionsSource, /requireCustomerAccount\("going"\)/);
  assert.match(actionsSource, /onClick=\{\(\) => updateGoing\(nextShift\.id\)\}/);
  assert.match(actionsSource, /role="dialog"\s+aria-modal="true"/);
  assert.match(actionsSource, /aria-label="Close account prompt"/);
  assert.match(actionsSource, /href="\/account\?role=customer&mode=signup"/);
  assert.match(actionsSource, /href="\/account\?role=customer"/);
  assert.match(profilePageSource, /\.profile-account-gate \{ position: fixed; inset: 0; z-index: 120/);
});

test("profile reports require authentication in both the client and API", () => {
  const reportHandler = sourceBetween(
    homeSource,
    'if (actionButton.id === "reportBtn")',
    "    });",
  );

  assert.match(reportHandler, /await postAuthenticatedJson\("\/api\/reports"/);
  assert.doesNotMatch(reportHandler, /postOptionalAuthJson/);
  assert.match(
    reportsRouteSource,
    /if \(targetType !== "contact_message" && !reporterId\)/,
  );
  assert.match(reportsRouteSource, /Sign in to submit a report/);
  assert.match(reportsRouteSource, /status: 401/);
  assert.match(reportsRouteSource, /reporter_id: reporterId/);
});
