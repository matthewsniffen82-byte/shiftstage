import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { myDancrPreviewBannerHtml } from "./components/MyDancrPreviewBanner";

import { LIVE_SHELL_SHA256 } from "../src/generated/live-shell-version";
import { LIVE_SHELL_SCRIPT_SHA256 } from "../src/generated/live-shell-script-version.mjs";
import {
  createActiveEditProfileScript,
  createRootContentSecurityPolicy,
} from "../src/lib/security/root-content-security-policy.mjs";
import { externalizeLiveShellAppScript } from "../src/lib/dancr/live-shell-script.mjs";
import { versionStaticAssetReferences, versionedStaticAssetUrl } from "../src/lib/dancr/static-asset-cache.mjs";
import { externalizeLiveShellStyles } from "../src/lib/dancr/live-shell-styles.mjs";

export const runtime = "nodejs";
// The live shell is a checked-in production artifact. Rendering this route at
// request time prevents Vercel's build cache from reusing an older shell while
// still allowing the response itself to be cached briefly at the edge.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADMIN_AUTH_ENTRY_STYLES = `<style>
#authPage .auth-admin-entry{justify-self:center;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 8px;color:#aeb0bc;font-size:12px;font-weight:500;text-decoration:none;border:0;border-radius:8px;background:transparent;box-shadow:none}
#authPage .auth-admin-entry:hover{color:#fff;text-decoration:underline;text-underline-offset:3px}
#authPage .auth-admin-entry:focus-visible{outline:2px solid #c4b5fd;outline-offset:3px}
#authPage.venue-request-succeeded .auth-admin-entry{display:none}
</style>`;

const ADMIN_AUTH_ENTRY_HTML = `<a class="auth-admin-entry" id="platformAdminAuthLink" href="/admin" aria-label="Open Platform admin sign in or signup">Platform admin</a>`;

let productionShell: ReturnType<typeof renderLiveShell> | undefined;

export async function GET() {
  // Only deployment files live here. Discovery, accounts and live schedules
  // still load through their existing APIs and retain their HTTP freshness.
  const rendered = process.env.NODE_ENV === "production"
    ? productionShell ??= renderLiveShell().catch((error) => {
        productionShell = undefined;
        throw error;
      })
    : renderLiveShell();
  const { html, headers } = await rendered;
  // Never retain a Response/body stream across callers.
  return new Response(html, { headers });
}

async function renderLiveShell() {
  const htmlPath = path.join(process.cwd(), "outputs", "index.html");
  const html = await readFile(htmlPath, "utf8");
  const normalizedHtml = html.replace(/\r\n?/g, "\n");
  const liveShellSha256 = createHash("sha256").update(normalizedHtml).digest("hex");
  const scriptVersion = process.env.NODE_ENV === "production" ? LIVE_SHELL_SCRIPT_SHA256 : liveShellSha256;
  const withExternalAppScript = externalizeLiveShellAppScript(
    normalizedHtml,
    `/live-shell.js?v=${scriptVersion}`,
  );
  // Development keeps live CSS edits visible without rebuilding the artifact.
  const withCompactStyles = process.env.NODE_ENV === "production"
    ? externalizeLiveShellStyles(withExternalAppScript)
    : withExternalAppScript;
  const activeEditProfileMarker = `<script>${createActiveEditProfileScript(liveShellSha256)}</script>`;
  const withBase = withCompactStyles.replace("<head>", `<head><base href="/outputs/">${activeEditProfileMarker}`);
  const withLiveProfileAssets = withBase.replace(
    "</head>",
    `<link rel="stylesheet" href="/mobile-social-strip.css?v=4"><link rel="stylesheet" href="/third-party-social-link-warning.css?v=3"><link rel="stylesheet" href="/profile-video-scroll-controls.css?v=4"><script src="/profile-video-progress-line.js?v=1" defer></script><script src="/video-sound-preference.js?v=1" defer></script><script src="/video-autoplay-recovery.js?v=4" defer></script><script src="/third-party-social-link-warning.js?v=1" defer></script>${ADMIN_AUTH_ENTRY_STYLES}</head>`,
  );
  const withPushInvitations = withLiveProfileAssets.replace("</head>", `<link rel="stylesheet" href="/mydancr-push-invitations.css"><script defer src="/mydancr-push-invitations.js" data-device-module="${versionedStaticAssetUrl("/mydancr-push-device.js")}"></script></head>`);
  const withPreviewBanner = withPushInvitations.replace(
    '<body class="dancr-button-system">',
    `<body class="dancr-button-system">${myDancrPreviewBannerHtml}`,
  );
  const withAdminAuthEntry = withPreviewBanner.replace(
    '<section class="recovery-popover" id="passwordRecoveryCard"',
    `${ADMIN_AUTH_ENTRY_HTML}<section class="recovery-popover" id="passwordRecoveryCard"`,
  );
  const release = process.env.VERCEL_GIT_COMMIT_SHA || '';
  const withPerformance = process.env.NODE_ENV === 'production' && /^[a-f0-9]{40}$/.test(release)
    ? withAdminAuthEntry.replace('</head>', `<script defer src="/mydancr-performance.js" data-release="${release}"></script></head>`)
    : withAdminAuthEntry;
  const withVersionedAssets = versionStaticAssetReferences(withPerformance);
  const contentSecurityPolicy = createRootContentSecurityPolicy(withVersionedAssets);

  return {
    html: withVersionedAssets,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
      "content-security-policy": contentSecurityPolicy,
      "x-dancr-live-shell-version": liveShellSha256,
      "x-dancr-live-shell-build-version": LIVE_SHELL_SHA256,
      "x-dancr-live-shell-script-version": scriptVersion,
    },
  };
}
