/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/admin/tv/import": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/dancer/tv/videos/\\[id\\]": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/cron/video-moderation": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
