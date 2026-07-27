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

test("account-only live modal actions check for a customer profile while Going and Report stay public", () => {
  const handler = sourceBetween(
    homeSource,
    'modalBody.addEventListener("click"',
    'const modalCloseButton = document.getElementById("modalClose")',
  );

  assert.match(handler, /#followBtn, #notifyBtn, #goingBtn, #reportBtn/);
  assert.match(
    handler,
    /\(actionButton\.id === "followBtn" \|\| actionButton\.id === "notifyBtn"\) &&\s+!requireCustomerAccountForProfileAction\(actionButton\)/,
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

test("public Next profiles keep all actions visible while signed out and gate only Follow and Notify", () => {
  assert.doesNotMatch(actionsSource, /if \(!token\) \{\s+return/);
  assert.match(actionsSource, /showSignedOutRequirements = savedLoaded && !token/);
  assert.match(actionsSource, /profile-action-requirement">Sign in required/);
  assert.match(actionsSource, /profile-action-requirement">No sign-in needed/);
  for (const action of ["follow", "notify"]) {
    assert.match(
      actionsSource,
      new RegExp(`requireCustomerAccount\\("${action}"\\)`),
    );
  }
  assert.doesNotMatch(actionsSource, /requireCustomerAccount\("report"\)/);
  assert.doesNotMatch(actionsSource, /requireCustomerAccount\("going"\)/);
  assert.match(actionsSource, /onClick=\{\(\) => updateGoing\(nextShift\.id\)\}/);
  assert.match(actionsSource, /onClick=\{submitReport\}/);
  assert.match(actionsSource, /role="dialog"\s+aria-modal="true"/);
  assert.match(actionsSource, /aria-label="Close account prompt"/);
  assert.match(actionsSource, /href="\/account\?role=customer&mode=signup"/);
  assert.match(actionsSource, /href="\/account\?role=customer"/);
  assert.match(profilePageSource, /\.profile-account-gate \{ position: fixed; inset: 0; z-index: 120/);
  assert.match(profilePageSource, /\.live-actions \.profile-action-requirement/);
});

test("the live mobile profile labels protected actions before the tap and labels Going and Report as public", () => {
  assert.match(homeSource, /function profileActionRequirementMarkup\(requirement\)/);
  assert.match(homeSource, /Sign in required/);
  assert.match(homeSource, /No sign-in needed/);
  assert.match(
    homeSource,
    /profileActionButtonMarkup\([^)]*"account"[^)]*\)/,
  );
  assert.match(
    homeSource,
    /id="reportBtn"[^>]*>\$\{profileActionButtonMarkup\("report", "Report", "public"\)\}/,
  );
});

test("profile reports accept signed-out visitors and preserve optional signed-in attribution", () => {
  const reportHandler = sourceBetween(
    homeSource,
    'if (actionButton.id === "reportBtn")',
    "    });",
  );

  assert.match(reportHandler, /await postOptionalAuthJson\("\/api\/reports"/);
  assert.doesNotMatch(reportHandler, /postAuthenticatedJson\("\/api\/reports"/);
  assert.match(actionsSource, /if \(token\) headers\.authorization = `Bearer \$\{token\}`/);
  assert.doesNotMatch(reportsRouteSource, /Sign in to submit a report/);
  assert.doesNotMatch(reportsRouteSource, /targetType !== "contact_message" && !reporterId/);
  assert.match(reportsRouteSource, /reporter_id: reporterId/);
});
