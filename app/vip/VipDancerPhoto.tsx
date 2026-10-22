"use client";

import { useEffect, useState } from "react";
import { readBrowserAuthSession, isCurrentBrowserSession } from "@/src/lib/dancr/browser-session";
import type { VipDancer } from "@/src/lib/dancr/vip-types";

export default function VipDancerPhoto({ dancer, width, height }: { dancer: VipDancer; width: number; height: number }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const protectedPhoto = dancer.photoUrl?.startsWith("/api/internal/avatar/") === true;
  useEffect(() => {
    setUrl(""); setFailed(false);
    if (!protectedPhoto || !dancer.photoUrl) return;
    const session = readBrowserAuthSession();
    if (!session?.accessToken) return;
    const controller = new AbortController();
    let objectUrl = "";
    const headers: Record<string, string> = { authorization: `Bearer ${session.accessToken}` };
    if (session.refreshToken) headers["x-dancr-refresh-token"] = session.refreshToken;
    const timer = setTimeout(() => controller.abort(), 15000);
    void fetch(dancer.photoUrl, { headers, cache: "no-store", signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Photo unavailable."); return response.blob(); })
      .then(blob => {
        if (controller.signal.aborted || !isCurrentBrowserSession(session)) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [dancer.photoUrl, protectedPhoto]);
  const src = protectedPhoto ? url : dancer.photoUrl;
  return src && !failed ? <img src={src} alt="" width={width} height={height} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <>{dancer.stage_name.slice(0, 2).toUpperCase()}</>;
}
