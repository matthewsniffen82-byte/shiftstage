import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  migration,
  dmcaLibrary,
  noticeRoute,
  counterRoute,
  adminRoute,
  restorationRoute,
  dmcaPage,
  noticeForm,
  counterForm,
  adminPanel,
  adminClient,
  liveShell,
  vercelConfig,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/202607280002_dmca_compliance.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dmca.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dmca/notices/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dmca/cases/[id]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/dmca/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/dmca-restoration/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dmca/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dmca/DmcaNoticeForm.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dmca/counter/[id]/DmcaCounterForm.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminDmcaPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../vercel.json", import.meta.url), "utf8"),
]);

test("public DMCA notices require the statutory claimant identity and declarations", () => {
  assert.match(noticeRoute, /createDmcaNotice/);
  assert.match(noticeForm, /goodFaithConfirmed/);
  assert.match(noticeForm, /accuracyConfirmed/);
  assert.match(noticeForm, /authorityConfirmed/);
  assert.match(noticeForm, /Electronic signature/);
  assert.match(dmcaLibrary, /The reported URL must be on mydancr\.com\./);
  assert.match(dmcaLibrary, /request_ip_hash/);
  assert.match(dmcaLibrary, /Too many copyright notices were submitted/);
  assert.match(dmcaLibrary, /confirmationSent: confirmation\.delivered/);
  assert.match(noticeForm, /email delivery could not be confirmed/);
  assert.match(migration, /create table if not exists public\.dmca_cases/);
});

test("public DMCA notice submissions prevent duplicate and stale requests", () => {
  assert.match(noticeForm, /const mountedRef = useRef\(false\);/);
  assert.match(noticeForm, /const submitAbortRef = useRef<AbortController \| null>\(null\);/);
  assert.match(noticeForm, /const submitInFlightRef = useRef\(false\);/);
  assert.match(noticeForm, /if \(submitInFlightRef\.current\) return;/);
  assert.match(noticeForm, /fetch\("\/api\/dmca\/notices", \{[\s\S]*?signal: controller\.signal/);
  assert.match(noticeForm, /if \(!mountedRef\.current \|\| controller\.signal\.aborted\) return;/);
  assert.match(noticeForm, /submitAbortRef\.current\?\.abort\(\);/);
  assert.match(noticeForm, /if \(mountedRef\.current\) setIsSubmitting\(false\);/);
});

test("validated takedowns disable exact videos, notify uploaders, and enforce repeat-infringer strikes", () => {
  assert.match(migration, /create or replace function public\.apply_dmca_takedown/);
  assert.match(migration, /update public\.mydancr_tv_videos[\s\S]*?status = 'hidden'/);
  assert.match(migration, /insert into public\.dmca_strikes/);
  assert.match(migration, /v_strike_count >= 3/);
  assert.match(migration, /update public\.app_users[\s\S]*?account_state = 'disabled'/);
  assert.match(migration, /update public\.dancer_profiles[\s\S]*?status = 'disabled'/);
  assert.match(migration, /'dmca_status'/);
  assert.match(dmcaLibrary, /\.from\("app_users"\)[\s\S]*?subject: `MyDancr copyright notice/);
  assert.match(dmcaLibrary, /repeatInfringerEnforced[\s\S]*?three active copyright strikes/);
  assert.match(adminRoute, /applyDmcaAdminAction/);
  assert.match(adminPanel, /Disable reported video/);
  assert.match(adminPanel, /Record filed court action/);
});

test("copyright operations preserve refreshed admin sessions for every legal action", () => {
  assert.equal((adminRoute.match(/const \{ client, session, user \} = await createRequestSupabaseContext\(request\)/g) || []).length, 2);
  assert.equal((adminRoute.match(/session: session \|\| null/g) || []).length, 3);
  assert.equal((adminPanel.match(/requestAdminJson\("\/api\/admin\/dmca"/g) || []).length, 3);
  assert.doesNotMatch(adminPanel, /readAdminAccessToken|authorization:|fetch\("\/api\/admin\/dmca"/);
});

test("counter-notices are uploader-authenticated, forwarded, and wait 10 to 14 business days", () => {
  assert.match(counterRoute, /createRequestSupabaseContext/);
  assert.match(dmcaLibrary, /mistakeBeliefConfirmed/);
  assert.match(dmcaLibrary, /perjuryConfirmed/);
  assert.match(dmcaLibrary, /jurisdictionConfirmed/);
  assert.match(dmcaLibrary, /serviceConfirmed/);
  assert.match(dmcaLibrary, /addBusinessDays\(counterReceivedAt, 10\)/);
  assert.match(dmcaLibrary, /addBusinessDays\(counterReceivedAt, 14\)/);
  assert.match(dmcaLibrary, /sendTransactionalEmail\(\{[\s\S]*?Counter-notice for MyDancr copyright case/);
  assert.match(dmcaLibrary, /forwardPendingDmcaCounterNotices/);
  assert.match(dmcaLibrary, /Unable to roll back an uncommitted DMCA counter-notice/);
  assert.match(counterForm, /accept service of process/);
  assert.match(counterForm, /United States Federal District Court/);
});

test("eligible counter-notices restore content and rescind strikes unless a court filing is recorded", () => {
  assert.match(migration, /create or replace function public\.restore_dmca_case/);
  assert.match(migration, /v_case\.court_filing_received/);
  assert.match(migration, /v_case\.restore_eligible_at > v_now/);
  assert.match(migration, /v_counter\.forwarded_to_claimant_at is null/);
  assert.match(migration, /active = false/);
  assert.match(migration, /status = 'restored'/);
  assert.match(restorationRoute, /authorizeCronRequest/);
  assert.match(restorationRoute, /restoreEligibleDmcaCases/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/dmca-restoration"[\s\S]*?"schedule": "30 9 \* \* \*"/);
});

test("copyright contact, public policy, and admin registration controls are visible", () => {
  assert.match(dmcaPage, /Repeat-infringer policy/);
  assert.match(dmcaPage, /three active strikes are suspended/);
  assert.match(dmcaPage, /Copyright contact/);
  assert.match(adminPanel, /Registered with the U\.S\. Copyright Office/);
  assert.match(adminPanel, /Registration renewal date/);
  assert.match(adminClient, /<AdminDmcaPanel \/>/);
  assert.match(liveShell, /href="\/dmca">Copyright \/ DMCA/);
  assert.match(liveShell, /Only upload content and music you own or are authorized to use/);
});
