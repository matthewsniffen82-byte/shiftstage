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
  heading?: string;
  showConnectLabel?: boolean;
  showHeading?: boolean;
  trackClicks?: boolean;
};

const platformLabels: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  x: "X",
  onlyfans: "OnlyFans",
};

export function SocialLinks({ dancerId, heading = "Socials", links, showConnectLabel = false, showHeading = true, trackClicks = true }: SocialLinksProps) {
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
    <div className="social-links-control">
      {showHeading ? (
        <div className="social-list-heading">
          {showConnectLabel ? <span>Connect</span> : null}
          <h2 id="profile-social-heading">{heading}</h2>
        </div>
      ) : null}
      <div className="social-list" aria-label="External profiles">
        {links.map((link) => (
          <a
            aria-label={`${platformLabels[link.platform]} (opens in a new tab after a third-party warning)`}
            className={`social-link social-link-${link.platform}`}
            data-third-party-social-link="true"
            href={link.url}
            key={link.id}
            onClick={trackClicks ? () => recordClick(link.platform) : undefined}
            rel="noopener noreferrer"
            target="_blank"
            title={platformLabels[link.platform]}
          >
            <SocialPlatformIcon platform={link.platform} />
          </a>
        ))}
      </div>
    </div>
  );
}

export function SocialPlatformIcon({ platform }: { platform: SocialPlatform }) {
  if (platform === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="5" />
        <circle cx="12" cy="12" r="3.4" />
        <path d="M17.2 6.8h.01" />
      </svg>
    );
  }
  if (platform === "tiktok") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15.8 3c.3 2.5 1.8 4.1 4.2 4.4v3.2c-1.6 0-3-.5-4.2-1.4v6.1c0 3.3-2.3 5.7-5.5 5.7A5.2 5.2 0 0 1 5 15.8c0-3.1 2.4-5.4 5.5-5.4.4 0 .8 0 1.1.1v3.4a2.6 2.6 0 0 0-1.2-.3 2.1 2.1 0 0 0-2.1 2.2c0 1.3.9 2.2 2.1 2.2s2.1-.9 2.1-2.4V3h3.3Z" />
      </svg>
    );
  }
  if (platform === "snapchat") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.2c2.7 0 4.6 2 4.6 4.8v2.5c0 .6.5.9 1.1 1.1.6.2 1.2.4 1.2.9 0 .6-.7.9-1.5 1.1-.4.1-.5.4-.3.8.6 1.1 1.5 1.8 2.7 2.1.3.1.4.5.2.8-.8.7-1.8.8-2.5.8-.5 0-.8.2-1.1.6-.6.7-1.3 1.1-2.2 1.1-.7 0-1.2-.2-1.7-.5a1.1 1.1 0 0 0-1.1 0c-.5.3-1 .5-1.7.5-.9 0-1.6-.4-2.2-1.1-.3-.4-.6-.6-1.1-.6-.7 0-1.7-.1-2.5-.8-.2-.3-.1-.7.2-.8 1.2-.3 2.1-1 2.7-2.1.2-.4.1-.7-.3-.8-.8-.2-1.5-.5-1.5-1.1 0-.5.6-.7 1.2-.9.6-.2 1.1-.5 1.1-1.1V8c0-2.8 1.9-4.8 4.6-4.8Z" />
      </svg>
    );
  }
  if (platform === "onlyfans") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9.2" cy="12" r="5.4" />
        <circle cx="9.2" cy="12" r="2.15" className="logo-cutout" />
        <path d="M13.9 8.2h6.2c.5 0 .8.5.6 1l-1 2.2c-.1.3-.4.5-.7.5h-3.2l-1.1 3.9c-.1.4-.5.7-.9.7h-3.1l2.3-7.5c.1-.5.5-.8.9-.8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}
