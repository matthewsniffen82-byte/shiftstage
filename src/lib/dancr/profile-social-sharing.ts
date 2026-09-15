export const PROFILE_SHARE_PLATFORMS = [
  { key: "x", label: "X" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "reddit", label: "Reddit" },
  { key: "snapchat", label: "Snapchat" },
] as const;

export type ProfileSharePlatform = (typeof PROFILE_SHARE_PLATFORMS)[number]["key"];

// Keep the classic homepage's socialShareUrl in sync (covered by parity tests).
export function profileSocialShareUrl(platform: ProfileSharePlatform, profileUrl: string, text: string) {
  const url = encodeURIComponent(profileUrl);
  const title = encodeURIComponent(text);
  switch (platform) {
    case "x": return `https://x.com/intent/tweet?text=${title}&url=${url}`;
    case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
    case "reddit": return `https://www.reddit.com/submit?url=${url}&title=${title}&type=LINK`;
    case "snapchat": return `https://www.snapchat.com/share?link=${url}`;
    case "instagram": return "https://www.instagram.com/";
  }
}
