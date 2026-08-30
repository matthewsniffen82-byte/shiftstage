import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createActiveEditProfileScript,
  createRootContentSecurityPolicy,
} from "./src/lib/security/root-content-security-policy.mjs";

/** @type {import('next').NextConfig} */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "font-src 'self' data: https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self' https://www.google.com",
  "img-src 'self' data: blob: https:",
  "manifest-src 'self'",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

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

const immutableStaticAssetCacheControl = "public, max-age=31536000, immutable";
const immutableStaticAssetSources = [
  "/dancr-aesthetic.v1.css",
  "/dancr-brand-tokens.v1.css",
  "/dancr-button-system.v1.css",
  "/mobile-social-strip.css",
  "/mydancr-icon.svg",
  "/outputs/dancr-hero.png",
  "/outputs/dancr-hero.webp",
  "/outputs/mydancr-logo-current.png",
  "/outputs/mydancr-logo.png",
  "/profile-video-progress-line.js",
  "/profile-video-scroll-controls.css",
  "/third-party-social-link-warning.css",
  "/third-party-social-link-warning.js",
  "/trending-flame-clean.png",
  "/trending-flame.png",
  "/venue-logos/:path*",
  "/video-autoplay-recovery.js",
  "/video-sound-preference.js",
];

const liveShellHtml = readFileSync(new URL("./outputs/index.html", import.meta.url), "utf8");
const liveShellSha256 = createHash("sha256")
  .update(liveShellHtml.replace(/\r\n?/g, "\n"))
  .digest("hex");
const rootContentSecurityPolicy = createRootContentSecurityPolicy(
  liveShellHtml,
  [createActiveEditProfileScript(liveShellSha256)],
);

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
      ...immutableStaticAssetSources.map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: immutableStaticAssetCacheControl }],
      })),
    ];
  },
  outputFileTracingRoot: process.cwd(),
  env: {
    DANCR_VIDEO_MODERATION_MODE:
      process.env.DANCR_VIDEO_MODERATION_MODE || "ai",
  },
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/admin/tv/import": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/admin/tv/videos": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/dancer/tv/videos/\\[id\\]": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/cron/video-moderation": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
