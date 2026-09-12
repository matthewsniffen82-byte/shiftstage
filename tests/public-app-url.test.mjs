import assert from "node:assert/strict";
import test from "node:test";

import {
  MYDANCR_PUBLIC_APP_URL,
  publicAppUrl,
} from "../src/lib/dancr/public-app-url.ts";

test("production links always use the canonical MyDancr origin", () => {
  assert.equal(publicAppUrl({ NODE_ENV: "production" }), MYDANCR_PUBLIC_APP_URL);
  assert.equal(
    publicAppUrl({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://stackeddbets.com" }),
    "https://www.mydancr.com",
  );
  assert.equal(
    publicAppUrl({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://mydancr.com/legacy/path" }),
    "https://www.mydancr.com",
  );
  assert.equal(
    publicAppUrl({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "not a url" }),
    "https://www.mydancr.com",
  );
});

test("local development may use a local origin without weakening production links", () => {
  assert.equal(
    publicAppUrl({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:3000/path" }),
    "http://localhost:3000",
  );
  assert.equal(
    publicAppUrl({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "https://untrusted.example" }),
    "https://www.mydancr.com",
  );
});

const isolatedEnvironment = {
  NODE_ENV: "production",
  VERCEL: "1",
  DANCR_ISOLATED_SUPABASE_REF: "abcdefghijklmnopqrst",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  VERCEL_PROJECT_PRODUCTION_URL: "dancr-recovery-example.vercel.app",
  NEXT_PUBLIC_SITE_URL: "https://dancr-recovery-example.vercel.app",
};

test("an explicitly isolated deployment keeps account links on its own Vercel project", () => {
  assert.equal(publicAppUrl(isolatedEnvironment), isolatedEnvironment.NEXT_PUBLIC_SITE_URL);
  assert.equal(publicAppUrl({ ...isolatedEnvironment, NEXT_PUBLIC_SITE_URL: `${isolatedEnvironment.NEXT_PUBLIC_SITE_URL}/` }), isolatedEnvironment.NEXT_PUBLIC_SITE_URL);
});

for (const [name, overrides] of [
  ["missing hosting marker", { VERCEL: undefined }],
  ["empty isolated reference", { DANCR_ISOLATED_SUPABASE_REF: "" }],
  ["invalid isolated reference", { DANCR_ISOLATED_SUPABASE_REF: "invalid" }],
  ["production backend", { DANCR_ISOLATED_SUPABASE_REF: "hfmzwadzabmgxkjzmqun", NEXT_PUBLIC_SUPABASE_URL: "https://hfmzwadzabmgxkjzmqun.supabase.co" }],
  ["mismatched backend", { NEXT_PUBLIC_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co" }],
  ["missing backend", { NEXT_PUBLIC_SUPABASE_URL: undefined }],
  ["missing project domain", { VERCEL_PROJECT_PRODUCTION_URL: undefined }],
  ["live Vercel project", { VERCEL_PROJECT_PRODUCTION_URL: "shiftstage.vercel.app", NEXT_PUBLIC_SITE_URL: "https://shiftstage.vercel.app" }],
  ["custom domain", { VERCEL_PROJECT_PRODUCTION_URL: "outside.example", NEXT_PUBLIC_SITE_URL: "https://outside.example" }],
  ["nested Vercel domain", { VERCEL_PROJECT_PRODUCTION_URL: "outside.dancr-recovery-example.vercel.app", NEXT_PUBLIC_SITE_URL: "https://outside.dancr-recovery-example.vercel.app" }],
  ["production site", { NEXT_PUBLIC_SITE_URL: "https://www.mydancr.com" }],
  ["different project", { NEXT_PUBLIC_SITE_URL: "https://different-project.vercel.app" }],
  ["insecure scheme", { NEXT_PUBLIC_SITE_URL: "http://dancr-recovery-example.vercel.app" }],
  ["user information", { NEXT_PUBLIC_SITE_URL: "https://name@dancr-recovery-example.vercel.app" }],
  ["path", { NEXT_PUBLIC_SITE_URL: "https://dancr-recovery-example.vercel.app/auth/callback" }],
  ["query", { NEXT_PUBLIC_SITE_URL: "https://dancr-recovery-example.vercel.app?test=1" }],
  ["fragment", { NEXT_PUBLIC_SITE_URL: "https://dancr-recovery-example.vercel.app#test" }],
  ["port", { NEXT_PUBLIC_SITE_URL: "https://dancr-recovery-example.vercel.app:8443" }],
  ["empty site", { NEXT_PUBLIC_SITE_URL: "" }],
]) {
  test(`isolated account links fail closed for ${name}`, () => {
    assert.throws(() => publicAppUrl({ ...isolatedEnvironment, ...overrides }), /Invalid isolated application configuration/);
  });
}

test("an ordinary preview keeps canonical links unless isolation is explicitly configured", () => {
  assert.equal(publicAppUrl({ ...isolatedEnvironment, DANCR_ISOLATED_SUPABASE_REF: undefined }), MYDANCR_PUBLIC_APP_URL);
});
