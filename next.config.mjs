/** @type {import('next').NextConfig} */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), fullscreen=(self), payment=(self), usb=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
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
