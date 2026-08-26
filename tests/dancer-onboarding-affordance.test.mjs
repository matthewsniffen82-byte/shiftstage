import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const onboarding = dashboard.match(/function DancerOnboardingCommand[\s\S]*?function DancerAvatarPanel/)?.[0] || "";

test("onboarding rows expose explicit controls from the existing authoritative state", () => {
  assert.match(onboarding, /const controlLabel = step\.locked[\s\S]*?"Locked"[\s\S]*?"Complete"[\s\S]*?"Continue" : "Start"[\s\S]*?"Continue" : "Set up"[\s\S]*?"Verify"/);
  assert.match(onboarding, /const displayComplete = step\.complete && \(!isPayoutStep \|\| natsAccountStatus === "active"\)/);
  assert.match(onboarding, /disabled=\{step\.locked\}/);
  assert.match(onboarding, /className="dancer-onboarding-step-control-icon"[\s\S]*?<rect x="5" y="10"/);
  assert.doesNotMatch(onboarding, /dancer-onboarding-step-toggle/);
  assert.doesNotMatch(onboarding, /dancer-onboarding-step-state/);
});

test("optional payouts stay visibly optional without entering the title or progression rules", () => {
  assert.match(onboarding, /label: "Commission payouts"/);
  assert.match(onboarding, /optional: true/);
  assert.match(onboarding, /step\.optional \? <em>Optional<\/em> : null/);
  assert.match(onboarding, /const payoutStepComplete = payoutSubmitted \|\| payoutSkipped/);
  assert.match(onboarding, /isPayoutStep && payoutSkipped \? "is-deferred"/);
});

test("onboarding cards are compact while the fixed navigation retains safe scrolling clearance", () => {
  assert.match(dashboard, /\.dancer-onboarding-steps > li > button \{ width: 100%; min-height: 58px;/);
  assert.match(dashboard, /\.dancer-onboarding-steps > li > button \{ min-height: 60px; grid-template-columns: 30px minmax\(0,1fr\) auto/);
  assert.match(dashboard, /\.dashboard-shell-dancer \{ padding-bottom: max\(128px, calc\(env\(safe-area-inset-bottom\) \+ 104px\)\); \}/);
});

test("Help & Account is a separate utility accordion with a stateful chevron", () => {
  const accountSection = dashboard.match(/<DashboardSection[\s\S]*?id="dancer-account"[\s\S]*?<\/DashboardSection>/)?.[0] || "";
  assert.match(accountSection, /emphasis="utility"/);
  assert.match(accountSection, /"Help & Account"/);
  assert.match(accountSection, /toggleAffordance="chevron"/);
  assert.match(dashboard, /toggleAffordance === "chevron"[\s\S]*?<path d="m7 9 5 5 5-5"/);
  assert.match(dashboard, /\.venue-dashboard-section\[open\] \.venue-dashboard-section-toggle\.is-chevron \{ transform: rotate\(180deg\)/);
});
