import type { SocialPlatform } from "./types";

const MAX_EXTERNAL_URL_LENGTH = 2_048;
const CONTROL_OR_MARKUP_CHARACTER = /[\u0000-\u001f\u007f<>]/u;
const SOCIAL_HANDLE_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/u;

const SOCIAL_PROFILE_HOSTS: Record<SocialPlatform, readonly string[]> = {
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  snapchat: ["snapchat.com"],
  x: ["x.com", "twitter.com"],
  onlyfans: ["onlyfans.com"],
};

const SOCIAL_PROFILE_BASE_URL: Record<SocialPlatform, string> = {
  instagram: "https://instagram.com/",
  tiktok: "https://tiktok.com/@",
  snapchat: "https://snapchat.com/add/",
  x: "https://x.com/",
  onlyfans: "https://onlyfans.com/",
};

export function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_EXTERNAL_URL_LENGTH || CONTROL_OR_MARKUP_CHARACTER.test(text)) return null;

  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function safeSocialProfileUrl(platform: unknown, value: unknown) {
  if (!isSocialPlatform(platform) || typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_EXTERNAL_URL_LENGTH || CONTROL_OR_MARKUP_CHARACTER.test(text)) return null;

  const parsedUrl = safeHttpUrl(text);
  if (!parsedUrl) {
    const handle = normalizeSocialHandle(text);
    return handle ? `${SOCIAL_PROFILE_BASE_URL[platform]}${handle}` : null;
  }

  const parsed = new URL(parsedUrl);
  if (parsed.port || !isAllowedSocialHostname(platform, parsed.hostname)) return null;
  const handle = socialHandleFromPath(platform, parsed.pathname);
  return handle ? `${SOCIAL_PROFILE_BASE_URL[platform]}${handle}` : null;
}

export function socialProfileHandle(platform: unknown, value: unknown) {
  const url = safeSocialProfileUrl(platform, value);
  if (!url || !isSocialPlatform(platform)) return "";
  return socialHandleFromPath(platform, new URL(url).pathname);
}

function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SOCIAL_PROFILE_HOSTS, value);
}

function isAllowedSocialHostname(platform: SocialPlatform, hostname: string) {
  const normalizedHost = hostname.toLowerCase().replace(/\.$/u, "");
  return SOCIAL_PROFILE_HOSTS[platform].some(
    (allowedHost) => normalizedHost === allowedHost || normalizedHost.endsWith(`.${allowedHost}`),
  );
}

function socialHandleFromPath(platform: SocialPlatform, pathname: string) {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map(safeDecodeURIComponent);

  if (platform === "snapchat") {
    if (segments[0]?.toLowerCase() !== "add") return "";
    return normalizeSocialHandle(segments[1] || "");
  }

  const firstSegment = segments[0] || "";
  if (platform === "tiktok" && !firstSegment.startsWith("@")) return "";
  return normalizeSocialHandle(firstSegment);
}

function normalizeSocialHandle(value: string) {
  const handle = value.trim().replace(/^@/u, "");
  return SOCIAL_HANDLE_PATTERN.test(handle) ? handle : "";
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
