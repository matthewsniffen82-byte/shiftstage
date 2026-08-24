import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [statements, finance, venueRoute, dancerRoute, venueFinanceRoute, dancerFinanceRoute] = await Promise.all([
  readFile(new URL("../src/lib/dancr/finance-statements.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/finance.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/finance/statement/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/finance/statement/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/venue/finance/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/finance/route.ts", import.meta.url), "utf8"),
]);

test("finance statement generation uses one dedicated boundary", () => {
  for (const operation of [
    "getVenueStatementRows",
    "getDancerStatementRows",
    "venueStatementCsv",
    "dancerStatementCsv",
  ]) {
    assert.match(statements, new RegExp(`export (?:async )?function ${operation}`));
    assert.doesNotMatch(finance, new RegExp(`export (?:async )?function ${operation}`));
  }
  assert.match(venueRoute, /from "@\/src\/lib\/dancr\/finance-statements"/);
  assert.match(dancerRoute, /from "@\/src\/lib\/dancr\/finance-statements"/);
});

test("statements remain scoped to the authorized owner and requested month", () => {
  assert.match(statements, /requireVenueAccess\(client, userId, "view_finance"\)/);
  assert.match(statements, /await getDancerForUser\(client, userId\)/);
  assert.match(statements, /eq\("venue_id", venue\.id\)/);
  assert.match(statements, /eq\("dancer_id", dancer\.id\)/);
  assert.equal((statements.match(/eq\("commission_month", `\$\{month\}-01`\)/g) || []).length, 2);
  assert.equal((statements.match(/limit\(MAX_FINANCE_ROWS\)/g) || []).length, 2);
});

test("CSV exports preserve financial columns and spreadsheet injection protection", () => {
  for (const column of [
    "MyDancr referral fee",
    "Venue payment status",
    "Gross commission",
    "Dancer rate",
    "Dancer commission",
  ]) {
    assert.match(statements, new RegExp(column));
  }
  assert.match(statements, /\^\[=\+\\-@\]/);
  assert.match(statements, /replaceAll\('\"', '\"\"'\)/);
  assert.match(statements, /join\("\\r\\n"\)/);
});

test("statement routes preserve month validation and private downloads", () => {
  for (const route of [venueRoute, dancerRoute]) {
    assert.match(route, /\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$/);
    assert.match(route, /"content-type": "text\/csv; charset=utf-8"/);
    assert.match(route, /"cache-control": "private, no-store"/);
  }
});

test("finance access checks return refreshed sessions before protected statement downloads", () => {
  for (const route of [venueFinanceRoute, dancerFinanceRoute]) {
    assert.match(route, /searchParams\.get\("access"\) === "1"/);
    assert.match(route, /session: authContext\.session \|\| null/);
    assert.match(route, /"cache-control": "private, no-store"/);
  }
  assert.match(venueFinanceRoute, /requireActiveVenueAccount\(client, user\.id\)/);
  assert.match(dancerFinanceRoute, /requireActiveDancer\(client, user\.id\)/);
});
