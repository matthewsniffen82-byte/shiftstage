import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [dashboardSource, liveShellSource] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source start: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("routed dancer dashboard deletes only the selected shift without reloading the list", () => {
  const deleteFlow = sourceBetween(
    dashboardSource,
    "async function cancelShift(shiftId: string)",
    "async function checkOutShift(shiftId: string)",
  );

  assert.match(deleteFlow, /setDeletingShiftId\(shiftId\)/);
  assert.match(deleteFlow, /setShifts\(\(current\) => current\.filter/);
  assert.doesNotMatch(deleteFlow, /loadShifts/);
  assert.doesNotMatch(deleteFlow, /setStatus\(""\)/);
  assert.match(dashboardSource, /aria-busy=\{deletingShiftId === String\(shift\.id\)\}/);
  assert.match(dashboardSource, /className="shift-panel-feedback" role="status" aria-live="polite"/);
});

test("compatibility dashboard keeps the shift manager mounted while deletion is pending", () => {
  const deleteFlow = sourceBetween(
    liveShellSource,
    "function handleShiftManagerAction(action, trigger = null)",
    "function postVerifiedShift()",
  );

  assert.match(deleteFlow, /row\.classList\.add\("is-deleting"\)/);
  assert.match(deleteFlow, /trigger\.textContent = "Deleting\.\.\."/);
  assert.match(deleteFlow, /await patchAuthenticatedJson\("\/api\/dancer\/shifts"/);
  assert.match(deleteFlow, /if \(row\?\.isConnected && shiftList\) \{\s*row\.remove\(\)/);
  assert.match(deleteFlow, /renderDancerShiftManager\(\)/);
  assert.match(deleteFlow, /renderShiftVerificationPanel\(\)/);
  assert.doesNotMatch(deleteFlow, /renderDancerManagement\(\)/);
  assert.doesNotMatch(deleteFlow, /renderDancerSetup\(\)/);
  assert.doesNotMatch(deleteFlow, /shiftPostResult/);
  assert.match(liveShellSource, /\.shift-manager-row\.is-deleting\s*\{\s*opacity:/);
});
