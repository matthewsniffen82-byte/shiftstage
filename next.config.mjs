import { staticAssetCacheHeaders } from "./src/lib/dancr/static-asset-cache.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validatePublicSupabaseConfig } from "./src/lib/supabase/public-config.mjs";
import { validatePublicEnvironment } from "./src/lib/security/public-environment.mjs";
import { contentSecurityPolicy } from "./src/lib/security/document-content-security-policy.mjs";
import {
  createActiveEditProfileScript,
  createRootContentSecurityPolicy,
} from "./src/lib/security/root-content-security-policy.mjs";

// Reject accidental private keys before Next can embed public variables in assets.
validatePublicEnvironment(process.env);
validatePublicSupabaseConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  allowMissing: process.env.VERCEL_ENV !== "production",
  allowLocal: process.env.VERCEL_ENV !== "production",
});

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), fullscreen=(self), payment=(self), usb=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "X-XSS-Protection", value: "0" },
];

const apiContentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const liveShellHtml = readFileSync(new URL("./outputs/index.html", import.meta.url), "utf8");
const liveShellSha256 = createHash("sha256")
  .update(liveShellHtml.replace(/\r\n?/g, "\n"))
  .digest("hex");
const rootContentSecurityPolicy = createRootContentSecurityPolicy(
  liveShellHtml,
  [createActiveEditProfileScript(liveShellSha256)],
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Content-Security-Policy", value: apiContentSecurityPolicy },
        ],
      },
      {
        source: "/",
        headers: [{ key: "Content-Security-Policy", value: rootContentSecurityPolicy }],
      },
      ...staticAssetCacheHeaders(),
    ];
  },
  outputFileTracingRoot: process.cwd(),
  env: {
    DANCR_VIDEO_MODERATION_MODE:
      process.env.DANCR_VIDEO_MODERATION_MODE || "ai",
  },
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/": ["./public/outputs/live-shell.css"],
    "/live-shell.js": ["./outputs/live-shell-app.js"],
    "/api/admin/tv/import": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/admin/tv/videos": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/dancer/tv/videos/\\[id\\]": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/cron/video-moderation": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
