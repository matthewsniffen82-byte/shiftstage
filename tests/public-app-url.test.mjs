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
