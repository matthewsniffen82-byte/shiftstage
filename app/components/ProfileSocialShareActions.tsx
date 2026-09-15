"use client";

import { useState } from "react";
import { SocialPlatformIcon } from "@/app/dancers/[slug]/SocialLinks";
import { PROFILE_SHARE_PLATFORMS, profileSocialShareUrl, type ProfileSharePlatform } from "@/src/lib/dancr/profile-social-sharing";
import "@/src/live-shell/styles/profile-social-sharing.css";

export function ProfileSocialShareActions({ profileUrl, stageName }: { profileUrl: string; stageName: string }) {
  // Associate clipboard feedback with its URL so another profile never inherits it.
  const [instagram, setInstagram] = useState<{ url: string; message: string } | null>(null);
  if (!profileUrl) return null;
  const text = `View ${stageName}'s verified dancer profile on MyDancr.`;

  async function prepareInstagram() {
    setInstagram({ url: profileUrl, message: "Copying your profile link…" });
    try {
      await navigator.clipboard.writeText(profileUrl);
      setInstagram({ url: profileUrl, message: "Link copied. Open Instagram and paste it into a message, your bio, or a Story link sticker." });
    } catch {
      setInstagram({ url: profileUrl, message: "Select and copy the link below, then paste it into Instagram." });
    }
  }

  return (
    <div className="profile-social-share">
      <div className="profile-social-options" role="group" aria-label="Share profile to social media">
        {PROFILE_SHARE_PLATFORMS.map(({ key, label }) => key === "instagram" ? (
          <button className="profile-social-option" key={key} type="button" onClick={prepareInstagram} aria-label="Share to Instagram: copy profile link" aria-expanded={instagram?.url === profileUrl}>
            <ProfileShareIcon platform={key} /><span>{label}</span>
          </button>
        ) : (
          <a className="profile-social-option" key={key} href={profileSocialShareUrl(key, profileUrl, text)} target="_blank" rel="noopener noreferrer" aria-label={`Share to ${label} (opens in a new tab)`}>
            <ProfileShareIcon platform={key} /><span>{label}</span>
          </a>
        ))}
      </div>
      {instagram?.url === profileUrl ? (
        <div className="profile-instagram-guide">
          <p role="status">{instagram.message}</p>
          <input aria-label="Profile link for Instagram" value={profileUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
          <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer">Open Instagram</a>
        </div>
      ) : null}
    </div>
  );
}

function ProfileShareIcon({ platform }: { platform: ProfileSharePlatform }) {
  if (platform === "facebook") return <svg viewBox="0 0 24 24" aria-hidden="true" className="profile-share-icon-fill"><path d="M14 21v-8h3l.5-4H14V7c0-1.2.4-2 2-2h2V1.5c-.4-.1-1.8-.2-3-.2-3 0-5 1.8-5 5.2V9H7v4h3v8Z" /></svg>;
  if (platform === "reddit") return <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="14.5" rx="8" ry="5.5" /><path d="m12 9 1.3-6L18 4M4.4 11a2 2 0 1 0-1.1 3M19.6 11a2 2 0 1 1 1.1 3M8.5 16.5c1.8 1.5 5.2 1.5 7 0" /><circle cx="20" cy="4" r="2" /><circle cx="8.5" cy="13.5" r=".8" /><circle cx="15.5" cy="13.5" r=".8" /></svg>;
  return <span className={platform === "x" || platform === "snapchat" ? "profile-share-icon-fill" : ""}><SocialPlatformIcon platform={platform} /></span>;
}
