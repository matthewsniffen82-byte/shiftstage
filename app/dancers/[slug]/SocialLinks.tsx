"use client";

import type { SocialPlatform } from "@/src/lib/dancr/types";

type PublicSocialLink = {
  id: string;
  platform: SocialPlatform;
  handle: string;
  url: string;
};

type SocialLinksProps = {
  dancerId: string;
  links: PublicSocialLink[];
};

const platformLabels: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  x: "X",
  onlyfans: "OnlyFans",
};

export function SocialLinks({ dancerId, links }: SocialLinksProps) {
  if (!links.length) return null;

  function recordClick(platform: SocialPlatform) {
    const body = JSON.stringify({
      type: "social_click",
      dancerId,
      platform,
      source: "public_profile",
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }

    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }

  return (
    <div className="social-list" aria-label="Social links">
      {links.map((link) => (
        <a href={link.url} key={link.id} onClick={() => recordClick(link.platform)} rel="noreferrer" target="_blank">
          <span>{platformLabels[link.platform]}</span>
          <strong>{link.handle}</strong>
        </a>
      ))}
    </div>
  );
}
