import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MYDANCR_PUBLIC_APP_URL } from "../src/lib/dancr/public-app-url.ts";
import { isPrivateDocumentPath } from "../src/lib/security/document-content-security-policy.mjs";

const root = new URL("../", import.meta.url);
const tokenHeaders = ["x-dancr-session-access", "x-dancr-session-refresh", "x-dancr-session-expires"];
const corsHeaders = ["access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-headers", "access-control-expose-headers"];

class EdgeChallengeError extends Error {}

async function fetchForVerification(url, options) {
  const response = await fetch(url, options);
  if (response.headers.get("x-vercel-mitigated") === "challenge") {
    await response.body?.cancel().catch(() => undefined);
    throw new EdgeChallengeError("The edge challenged this verification request.");
  }
  return response;
}

function scriptAttributes(source) {
  const attributes = new Map();
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g;
  for (const [, name, doubleQuoted, singleQuoted, unquoted] of source.matchAll(pattern)) {
    if (!attributes.has(name.toLowerCase())) attributes.set(name.toLowerCase(), doubleQuoted ?? singleQuoted ?? unquoted ?? "");
  }
  return attributes;
}

export function inspectDocument(response, html, { privateDocument = false, hashed = false, callback = false } = {}) {
  const csp = response.headers.get("content-security-policy") || "";
  const scripts = csp.split(";").find(value => value.trim().startsWith("script-src ")) || "";
  const nonce = scripts.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1] || "";
  const inline = [...html.matchAll(/<script\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/script\s*>/gi)]
    .map(([, attributes, source]) => ({ attributes: scriptAttributes(attributes), source }))
    .filter(({ attributes }) => !attributes.has("src")
      && !/^application\/(?:ld\+)?json$/i.test(attributes.get("type") || ""));
  const permitted = inline.every(({ attributes, source }) => {
    const suppliedNonce = attributes.get("nonce");
    const hash = createHash("sha256").update(source).digest("base64");
    return (nonce && suppliedNonce === nonce) || scripts.includes(`'sha256-${hash}'`);
  });
  const checks = {
    status: response.status === 200,
    html: /text\/html/i.test(response.headers.get("content-type") || "") && /<html\b/i.test(html),
    noCredentialHeaders: tokenHeaders.every(name => !response.headers.has(name)),
    noFraming: /(?:^|;)\s*frame-ancestors 'none'(?:;|$)/.test(csp) && response.headers.get("x-frame-options")?.toUpperCase() === "DENY",
    noPlugins: /(?:^|;)\s*object-src 'none'(?:;|$)/.test(csp),
    noInlineHandlers: /(?:^|;)\s*script-src-attr 'none'(?:;|$)/.test(csp),
    noSniff: response.headers.get("x-content-type-options")?.toLowerCase() === "nosniff",
    httpsPolicy: Number((response.headers.get("strict-transport-security") || "").match(/(?:^|;)\s*max-age=(\d+)\b/)?.[1]) >= 31_536_000,
    controlledInlineScripts: inline.length > 0 && permitted && !/unsafe-inline|unsafe-eval/.test(scripts),
  };
  if (privateDocument) {
    checks.freshNonceShape = /^[A-Za-z0-9+/]{32}$/.test(nonce);
    checks.privateNoStore = /\bprivate\b/.test(response.headers.get("cache-control") || "") && /\bno-store\b/.test(response.headers.get("cache-control") || "");
  }
  if (hashed) checks.exactHashes = /'sha256-[A-Za-z0-9+/=]+'/.test(scripts) && !nonce;
  if (callback) {
    checks.noReferrer = response.headers.get("referrer-policy") === "no-referrer";
    checks.noStore = /\bno-store\b/.test(response.headers.get("cache-control") || "");
  }
  return { checks, nonce, inlineScriptCount: inline.length, ok: Object.values(checks).every(Boolean) };
}

async function readHtml(response) {
  if (!response.body) throw new Error("Missing document body.");
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Document exceeds the verification byte budget.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function checkBrowserBoundaries() {
  const paths = ["admin", "dashboard", "account"].flatMap(area => {
    const directory = new URL(`app/${area}/`, root);
    return readdirSync(directory, { recursive: true }).map(String).map(path => path.replaceAll("\\", "/"))
      .filter(path => /(?:^|\/)page\.tsx$/.test(path))
      .map(path => `/${area}${path === "page.tsx" ? "" : "/" + path.slice(0, -"/page.tsx".length)}`);
  }).sort();
  const results = [], nonces = new Set();
  const summary = () => ({ capturedUtc: new Date().toISOString(), origin: MYDANCR_PUBLIC_APP_URL,
    privateDocuments: paths.length, ok: results.every(result => result.ok), requests: results.length, results });
  // The ordinary account entry redirects to the homepage. This synthetic value
  // selects its dedicated sign-in HTML; fetching HTML executes no client code.
  const accountDocument = "/account?venue_nfc=" + "browser-boundary-verification-".padEnd(48, "x");
  const documents = [
    { path: "/", hashed: true },
    ...paths.map(path => ({ path: path === "/account" ? accountDocument : path, privateDocument: true })),
    { path: accountDocument, privateDocument: true },
    { path: "/auth/callback", hashed: true, callback: true },
  ];
  // Fixed public origin, no credentials, GET/OPTIONS only, no automatic retries.
  for (const document of documents) {
    try {
      const response = await fetchForVerification(MYDANCR_PUBLIC_APP_URL + document.path, {
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { accept: "text/html" },
      });
      const inspected = inspectDocument(response, await readHtml(response), document);
      if (document.privateDocument) {
        inspected.checks.coveredPath = isPrivateDocumentPath(new URL(document.path, MYDANCR_PUBLIC_APP_URL).pathname);
        inspected.checks.uniqueNonce = !!inspected.nonce && !nonces.has(inspected.nonce);
        nonces.add(inspected.nonce);
      }
      results.push({ path: document.path, method: "GET", status: response.status, inlineScriptCount: inspected.inlineScriptCount,
        checks: inspected.checks, ok: Object.values(inspected.checks).every(Boolean) });
    } catch (error) {
      const challenged = error instanceof EdgeChallengeError;
      results.push({ path: document.path, method: "GET", ok: false, error: challenged ? "EDGE_CHALLENGE" : "DOCUMENT_CHECK_FAILED" });
      if (challenged) return summary();
    }
  }
  try {
    const response = await fetchForVerification(MYDANCR_PUBLIC_APP_URL + "/account", {
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    const location = response.headers.get("location");
    const destination = location ? new URL(location, MYDANCR_PUBLIC_APP_URL) : null;
    results.push({ path: "/account", method: "GET", status: response.status,
      ok: response.status === 307 && destination?.origin === MYDANCR_PUBLIC_APP_URL
        && destination.pathname === "/" && destination.searchParams.get("auth") === "login"
        && tokenHeaders.every(name => !response.headers.has(name)) });
  } catch (error) {
    const challenged = error instanceof EdgeChallengeError;
    results.push({ path: "/account", method: "GET", ok: false, error: challenged ? "EDGE_CHALLENGE" : "ACCOUNT_REDIRECT_CHECK_FAILED" });
    if (challenged) return summary();
  }
  for (const path of ["/api/account", "/api/admin/sales-agents", "/api/auth", "/api/stripe/webhook"]) {
    for (const origin of ["https://unrelated.example", "null"]) {
      try {
        const response = await fetchForVerification(MYDANCR_PUBLIC_APP_URL + path, {
          method: "OPTIONS", redirect: "error", signal: AbortSignal.timeout(15_000),
          headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,x-dancr-refresh-token" },
        });
        await response.body?.cancel();
        results.push({ path, method: "OPTIONS", origin, status: response.status,
          ok: response.status === 204 && corsHeaders.every(name => !response.headers.has(name)) });
      } catch (error) {
        const challenged = error instanceof EdgeChallengeError;
        results.push({ path, method: "OPTIONS", origin, ok: false, error: challenged ? "EDGE_CHALLENGE" : "PREFLIGHT_CHECK_FAILED" });
        if (challenged) return summary();
      }
    }
  }
  return summary();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkBrowserBoundaries();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
