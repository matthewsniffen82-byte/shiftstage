import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminClient, dispatch, input, result, route] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-dispatch.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-input.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance-admin-result.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/finance/route.ts", import.meta.url), "utf8"),
]);

test("admin finance transport authenticates before delegating one parsed request", () => {
  assert.match(route, /await requireAdmin\(client, user\.id\)/);
  assert.equal((route.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length, 2);
  assert.match(route, /const body = await readBoundedJsonObject\(request, \{/);
  assert.match(route, /MAX_FINANCE_ADMIN_BODY_BYTES = 16_384/);
  assert.doesNotMatch(route, /request\.json\(/);
  assert.match(route, /dispatchAdminFinanceAction\(admin, user\.id, body\)/);
  assert.match(route, /NextResponse\.json\(\{ \.\.\.result\.body, session: session \|\| null \}, \{ status: result\.status \}\)/);
  assert.doesNotMatch(route, /body\.action ===/);
  assert.doesNotMatch(route, /recordManualClubInvoicePayment|processDancerPayouts|runQrFinanceAutomation/);
});

test("admin finance mutations use the refresh-aware role-isolated request boundary", () => {
  assert.match(adminClient, /requestAdminJson,/);
  assert.equal((adminClient.match(/requestAdminJson\("\/api\/admin\/finance"/g) || []).length, 6);
  assert.doesNotMatch(adminClient, /fetch\("\/api\/admin\/finance"/);
  assert.doesNotMatch(adminClient, /authorization: `Bearer \$\{token\}`[^\n]*[\s\S]{0,140}record_manual_payment/);
  assert.match(route, /NextResponse\.json\(\{ ok: true, finance, session: session \|\| null \}\)/);
});

test("admin finance mutations are abortable and serialized across every command", () => {
  const manager = adminClient.match(/function FinanceManager[\s\S]*?(?=function AdminClubDealManager)/)?.[0] || "";
  assert.match(manager, /const mountedRef = useRef\(false\);/);
  assert.match(manager, /const actionSequenceRef = useRef\(0\);/);
  assert.match(manager, /const actionAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(manager, /const actionInFlightRef = useRef\(false\);/);
  assert.match(manager, /function beginFinanceAction\(\)/);
  assert.match(manager, /if \(!mountedRef\.current \|\| actionInFlightRef\.current\) return null;/);
  assert.match(manager, /function isCurrentFinanceAction/);
  assert.match(manager, /function finishFinanceAction/);
  assert.equal((manager.match(/signal: request\.controller\.signal/g) || []).length, 6);
  assert.equal((manager.match(/const request = beginFinanceAction\(\)/g) || []).length, 6);
});

test("the dispatcher preserves every supported production finance action", () => {
  for (const action of [
    "run_automation",
    "process_payouts",
    "record_manual_payment",
    "update_payout_settings",
    "manage_earning",
    "retry_payout",
    "verify_nats_affiliate",
    "disable_nats_affiliate",
    "retry_nats_export",
    "reconcile_nats_export",
  ]) {
    assert.match(input, new RegExp(`"${action}"`));
    assert.match(dispatch, new RegExp(`command\\.action === "${action}"`));
  }
  assert.doesNotMatch(dispatch, /body\.action ===/);
  assert.match(dispatch, /parseAdminFinanceCommand\(input\)/);
  assert.match(input, /parseAdminFinanceAction\(body\)/);
  assert.match(dispatch, /return unsupportedCommand\(command\)/);
  assert.match(dispatch, /function unsupportedCommand\(command: never\)/);
  assert.match(input, /function unsupportedAction\(action: never\)/);
  assert.match(dispatch, /return invalid\("Unsupported finance action\."\)/);
});

test("the dispatcher preserves validation limits and explicit client errors", () => {
  assert.match(input, /parseAdminFinanceBody\(input\)/);
  assert.match(dispatch, /if \(!parsed\.ok\) return invalid\(parsed\.error\)/);
  assert.match(input, /Number\.isSafeInteger\(parsed\)/);
  assert.match(input, /Number\.MAX_SAFE_INTEGER/);
  assert.match(input, /Payment total must be a positive whole number of cents\./);
  assert.match(input, /const UUID_PATTERN/);
  assert.match(input, /Payment reference must be 160 characters or fewer\./);
  assert.match(input, /boundedInteger\(body\.earningsHoldDays, 0, 90/);
  assert.match(input, /boundedInteger\(body\.minimumPayoutCents, 1, 10_000_000/);
  assert.equal((input.match(/reason\.value\.length < 3 \|\| reason\.value\.length > 500/g) || []).length, 2);
  assert.match(dispatch, /return \{ status: 400, body: \{ ok: false, error \} \}/);
});

test("successful writes refresh finance without letting a failed read misreport the mutation", () => {
  assert.match(dispatch, /from "\.\/finance-admin-result"/);
  assert.equal((dispatch.match(/successfulFinanceMutation\(\(\) => getAdminFinanceOverview\(client\)/g) || []).length, 10);
  assert.match(result, /financeRefreshRequired: true/);
  assert.match(result, /ADMIN_FINANCE_POST_WRITE_REFRESH_FAILED/);
  assert.doesNotMatch(dispatch, /finance: await getAdminFinanceOverview\(client\)/);
  assert.match(adminClient, /function applyFinanceMutationResponse/);
  assert.match(adminClient, /data\.financeRefreshRequired === true/);
  assert.match(adminClient, /finance && typeof finance === "object" && !Array\.isArray\(finance\)/);
  assert.equal((adminClient.match(/applyFinanceMutationResponse\(data, onFinanceChange/g) || []).length, 6);
  assert.match(dispatch, /recordManualClubInvoicePayment\(client, command\)/);
  assert.match(dispatch, /updatePayoutSettings\(client, adminUserId, command\)/);
  assert.match(dispatch, /manageDancerEarning\(client, adminUserId, command\)/);
  assert.match(dispatch, /retryDancerPayout\(client, adminUserId, command\)/);
  assert.match(dispatch, /verifyNatsAffiliateLink\(client, adminUserId, command\.dancerId, command\.reason\)/);
  assert.match(dispatch, /disableNatsAffiliateLink\(client, adminUserId, command\.dancerId, command\.reason\)/);
  assert.match(dispatch, /retryFailedNatsCommissionExport\(client, adminUserId, command\.exportId, command\.reason\)/);
  assert.match(dispatch, /reconcileNatsCommissionExport\(client, adminUserId, command\.exportId, command\.resolution, command\.reason\)/);
  assert.doesNotMatch(dispatch, /bitsafe|yoursafe|reconcileBitsafe/i);
});
