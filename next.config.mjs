/** @type {import('next').NextConfig} */
const nextConfig = {
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
