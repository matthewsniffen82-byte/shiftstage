import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const PRIVATE_PATH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.vercel|node_modules|package(?:-lock)?\.json|npm-shrinkwrap\.json|tsconfig\.json)(?:\/|$)|\.(?:map(?:\.(?:gz|br))?|pem|key|p12|pfx|sql|bak|env|log|tsx?|jsx)$/i;
const TEXT_FILE = /\.(?:[cm]?js|css|html?|json|rsc|body|txt|xml|svg|webmanifest)$/i;
const PRIVATE_LITERAL = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsb_secret_[A-Za-z0-9_-]{16,}|\b(?:sk_live_|sk_test_|rk_live_|rk_test_|sk-proj-|sk-svcacct-|whsec_)[A-Za-z0-9_-]{16,}/;
const SERVER_SECRET_NAME = /(?:SECRET|PASSWORD|TOKEN|(?:^|_)KEY|ADMIN_SIGNUP_CODE|DATABASE_URL)$/;
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

// Diagnostics deliberately contain neither asset names nor matched values.
function reject(reason) {
  throw new Error(`Public build security rejected: ${reason}.`);
}

function privateValues(environment) {
  const values = Object.entries(environment)
    .filter(([name, value]) => !name.startsWith("NEXT_PUBLIC_")
      && SERVER_SECRET_NAME.test(name) && typeof value === "string" && value.length >= 8)
    .flatMap(([, value]) => [value, JSON.stringify(value).slice(1, -1),
      encodeURIComponent(value), Buffer.from(value).toString("base64")]);
  return [...new Set(values)];
}

function checkText(text, secrets) {
  if (/(?:\/\/[#@]|\/\*[#@])\s*source(?:Mapping)?URL\s*=|webpack-internal:\/\//.test(text)) {
    reject("browser debugging artifact");
  }
  if (PRIVATE_LITERAL.test(text) || secrets.some(secret => text.includes(secret))) {
    reject("private credential material");
  }
  for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    let payload;
    try { payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
    catch { continue; }
    if (payload?.role !== "anon") reject("non-public token material");
  }
}

/** Check only browser/static output, never private server bundles or build caches. */
export async function verifyPublicBuild({ root, environment = {} }) {
  const secrets = privateValues(environment);
  const result = { files: 0, textFiles: 0, textBytes: 0 };
  const checkFile = async (filename, relative) => {
    if (PRIVATE_PATH.test(relative)) reject("private file or source map");
    const info = await lstat(filename);
    if (info.isSymbolicLink() || !info.isFile()) reject("non-regular public file");
    result.files += 1;
    if (!TEXT_FILE.test(relative)) return;
    if (info.size > MAX_TEXT_BYTES) reject("text asset exceeds inspection limit");
    const text = await readFile(filename, "utf8");
    checkText(text, secrets);
    result.textFiles += 1;
    result.textBytes += info.size;
  };
  const walk = async (directory, prefix, renderedOnly = false) => {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) reject("non-regular public directory");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`;
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) reject("linked public artifact");
      if (!renderedOnly && PRIVATE_PATH.test(relative)) reject("private file or source map");
      if (entry.isDirectory()) await walk(filename, relative, renderedOnly);
      else if (!renderedOnly || /\.(?:html|rsc|body|json)$/.test(entry.name)) {
        // JSON under server/pages is prerendered page data; server/app JSON files
        // are internal trace metadata, so that tree selects only rendered forms.
        if ((renderedOnly === "app" && /\.json$/.test(entry.name)) || /\.nft\.json$/.test(entry.name)) continue;
        await checkFile(filename, relative);
      }
    }
  };

  const config = JSON.parse(await readFile(path.join(root, ".next/required-server-files.json"), "utf8")).config;
  if (config?.productionBrowserSourceMaps !== false
    || config?.typescript?.ignoreBuildErrors !== false
    || config?.eslint?.ignoreDuringBuilds !== false) reject("unsafe build configuration");
  if (Object.keys(config.env || {}).some(name => name !== "DANCR_VIDEO_MODERATION_MODE")) {
    reject("unreviewed explicit browser environment");
  }
  if (config.env?.DANCR_VIDEO_MODERATION_MODE
    && !["ai", "demo_auto_approve"].includes(config.env.DANCR_VIDEO_MODERATION_MODE.trim().toLowerCase())) {
    reject("invalid public moderation setting");
  }
  const routes = JSON.parse(await readFile(path.join(root, ".next/routes-manifest.json"), "utf8"));
  if (!Array.isArray(routes.headers)) reject("invalid emitted header configuration");
  for (const rule of routes.headers) {
    if (!Array.isArray(rule.headers)) reject("invalid emitted header configuration");
    if (rule.headers.some(header => /^(?:x-)?sourcemap$/i.test(header.key))) {
      reject("source map response header");
    }
  }
  await walk(path.join(root, "public"), "public");
  await walk(path.join(root, ".next/static"), "static");
  await walk(path.join(root, ".next/server/app"), "rendered/app", "app");
  await walk(path.join(root, ".next/server/pages"), "rendered/pages", "pages");
  await checkFile(path.join(root, "outputs/index.html"), "shell/index.html");
  await checkFile(path.join(root, "outputs/live-shell-app.js"), "shell/live-shell-app.js");
  return result;
}
