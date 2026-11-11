"use client";

import { useEffect, useRef, useState } from "react";
import { readBrowserAuthSession, isCurrentBrowserSession } from "@/src/lib/dancr/browser-session";
import { deferMediaLoad } from "@/src/lib/defer-media-load";
import type { VipDancer } from "@/src/lib/dancr/vip-types";

export default function VipDancerPhoto({ dancer, width, height, eager = false }: { dancer: Pick<VipDancer, "stage_name" | "photoUrl">; width: number; height: number; eager?: boolean }) {
  const placeholder = useRef<HTMLSpanElement>(null);
  const [photo, setPhoto] = useState<{ source: string; blobUrl: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const protectedPhoto = dancer.photoUrl?.startsWith("/api/internal/avatar/") === true;
  useEffect(() => {
    setPhoto(null); setFailed(false);
    if (!protectedPhoto || !dancer.photoUrl) return;
    const photoUrl = dancer.photoUrl;
    const session = readBrowserAuthSession();
    if (!session?.accessToken) return;
    const controller = new AbortController();
    let objectUrl = "";
    const headers: Record<string, string> = { authorization: `Bearer ${session.accessToken}` };
    if (session.refreshToken) headers["x-dancr-refresh-token"] = session.refreshToken;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopWaiting = deferMediaLoad(placeholder.current, () => {
      if (!isCurrentBrowserSession(session)) return;
      timer = setTimeout(() => controller.abort(), 15000);
      void fetch(photoUrl, { headers, cache: "no-store", priority: eager ? "high" : "auto", signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Photo unavailable."); return response.blob(); })
      .then(blob => {
        if (controller.signal.aborted || !isCurrentBrowserSession(session)) return;
        objectUrl = URL.createObjectURL(blob); setPhoto({ source: photoUrl, blobUrl: objectUrl });
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => clearTimeout(timer));
    }, { eager });
    return () => { stopWaiting(); controller.abort(); clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [dancer.photoUrl, protectedPhoto, eager]);
  const src = protectedPhoto ? photo && photo.source === dancer.photoUrl && photo.blobUrl : dancer.photoUrl;
  if (!src || failed) return <span ref={placeholder} style={{ display: "block", width, height }} aria-hidden="true" />;
  return <img key={src} src={src} alt="" width={width} height={height}
    loading={eager || protectedPhoto ? "eager" : "lazy"} fetchPriority={eager ? "high" : undefined}
    decoding="async" referrerPolicy="no-referrer"
    onLoad={event => { event.currentTarget.dataset.vipPhotoReady = "true"; }} onError={() => setFailed(true)} />;
}
