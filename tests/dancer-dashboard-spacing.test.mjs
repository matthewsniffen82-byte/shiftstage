import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("approved dancer dashboard cards share one consistent spacing value", () => {
  assert.match(
    page,
    /#dancerDashboard \.page-inner\.dashboard-wide\s*\{[^}]*--dancer-dashboard-box-gap:\s*18px;[^}]*gap:\s*var\(--dancer-dashboard-box-gap\)\s*!important;/s,
  );
  assert.match(
    page,
    /#dancerDashboard \.dashboard-status-row\s*\{[^}]*gap:\s*var\(--dancer-dashboard-box-gap\)\s*!important;/s,
  );
});
