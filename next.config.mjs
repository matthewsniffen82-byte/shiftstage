/** @type {import('next').NextConfig} */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://raw.githubusercontent.com",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'self' https://www.google.com",
  "img-src 'self' data: blob: https:",
  "manifest-src 'self'",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
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
];

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
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
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
