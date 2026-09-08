"use client";

import { useState } from "react";

export type DancerDashboardSection = "status" | "profile" | "schedule" | "performance" | "account";

export function DancerDashboardIcon({ section }: { section: DancerDashboardSection }) {
  const paths: Record<DancerDashboardSection, string> = {
    status: "M12 3 4.5 6v5.5c0 4.2 3.2 7.6 7.5 9.5 4.3-1.9 7.5-5.3 7.5-9.5V6L12 3Zm-3.5 9 2.3 2.3 4.7-4.7",
    profile: "M14 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-9M14 4l3-3 4 4-3 3-4-4ZM14 4l-7 7-1 5 5-1 7-7M14 4l4 4",
    schedule: "M7 3v4M17 3v4M4 10h16M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM8 14h2M14 14h2M8 17h2",
    performance: "M4 20h17M6 16v-5M12 16V8M18 16V4",
    account: "M5 17H3V9a9 9 0 0 1 18 0v8h-2M3 11h3v7H3v-7ZM18 11h3v7h-3v-7ZM18 18c0 2-2 3-5 3h-2",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[section]} /></svg>;
}

export function DancerDashboardAvatar({ avatarUrl, name }: { avatarUrl: string; name: string }) {
  const [failedUrl, setFailedUrl] = useState("");
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || "").join("").toLocaleUpperCase();
  return <span className="dancer-dashboard-avatar" aria-hidden="true">
    {avatarUrl && avatarUrl !== failedUrl ? <img src={avatarUrl} alt="" width={60} height={60} decoding="async" onError={() => setFailedUrl(avatarUrl)} /> : initials ? <span>{initials}</span> : (
      <svg className="dancer-dashboard-avatar-placeholder" width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
    )}
  </span>;
}
