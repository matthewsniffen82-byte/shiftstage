"use client";

import { useState } from "react";
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
  const [expanded, setExpanded] = useState(false);
  if (!links.length) return null;
  const visibleLinks = expanded ? links : links.slice(0, 3);

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
    <div className="social-links-control">
      <div className="social-list" aria-label="Social links">
        {visibleLinks.map((link) => (
          <a href={link.url} key={link.id} onClick={() => recordClick(link.platform)} rel="noreferrer" target="_blank">
            <span>{platformLabels[link.platform]}</span>
            <strong>{link.handle}</strong>
          </a>
        ))}
      </div>
      {links.length > 3 ? (
        <button
          aria-expanded={expanded}
          className="social-list-toggle"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "Show fewer links" : `Show ${links.length - 3} more links`}
        </button>
      ) : null}
    </div>
  );
}
