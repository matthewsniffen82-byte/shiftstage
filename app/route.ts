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
#authPage .auth-admin-entry{width:100%;min-height:54px;display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:9px;padding:9px 12px;color:#f8fafc;text-decoration:none;border:1px solid rgba(255,255,255,.12);border-radius:15px;background:rgba(24,24,32,.72);box-shadow:inset 0 1px 0 rgba(255,255,255,.035)}
#authPage .auth-admin-entry:hover,#authPage .auth-admin-entry:focus-visible{border-color:rgba(124,58,237,.8);background:rgba(43,34,68,.88);outline:0;box-shadow:0 0 0 3px rgba(124,58,237,.2),inset 0 1px 0 rgba(255,255,255,.06)}
#authPage .auth-admin-entry-mark{width:30px;aspect-ratio:1;display:grid;place-items:center;border-radius:50%;color:#fff;background:rgba(91,33,218,.8);font-size:7px;font-weight:950;letter-spacing:.03em}
#authPage .auth-admin-entry-copy{min-width:0;display:grid;gap:1px}
#authPage .auth-admin-entry-copy strong{font-size:15px;line-height:1.15}
#authPage .auth-admin-entry-copy small{color:rgba(226,226,237,.62);font-size:10px;line-height:1.2}
#authPage .auth-admin-entry-arrow{color:#c4b5fd;font-size:20px;line-height:1}
#authPage.venue-request-succeeded .auth-admin-entry{display:none}
</style>`;

const ADMIN_AUTH_ENTRY_HTML = `<a class="auth-admin-entry" id="platformAdminAuthLink" href="/admin" aria-label="Open Platform admin sign in or signup"><span class="auth-admin-entry-mark" aria-hidden="true">ADMIN</span><span class="auth-admin-entry-copy"><strong>Platform admin</strong><small>Private admin access</small></span><span class="auth-admin-entry-arrow" aria-hidden="true">›</span></a>`;

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
