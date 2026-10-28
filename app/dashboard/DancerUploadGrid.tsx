"use client";

import { useContext, useEffect, type ReactNode } from "react";
import { DancerMediaPreviewContext, DancerProfileUploadContext, type ProfileUploadKind } from "./DancerProfileUploadContext";
import type { MediaLibraryItem } from "./media-library-items";

// The uploader owns its local previews; the workspace supplies the shared grid.
export default function DancerUploadGrid({ kind, items, children }: {
  kind: ProfileUploadKind; items: MediaLibraryItem[]; children: ReactNode;
}) {
  const workspace = useContext(DancerProfileUploadContext);
  const publishPreview = useContext(DancerMediaPreviewContext);
  // Only local receipts belong here. Saved rows come from the owner's library,
  // so an older uploader refresh cannot overwrite a newer server status.
  const snapshot = JSON.stringify(items.filter(item => item.previewKey).map(item => ({
    id: item.id, previewKey: item.previewKey, previousId: item.previousId,
    status: item.status === "rejected" ? "rejected" : item.upload?.error ? "failed" : item.status,
    imageUrl: item.videoUrl?.startsWith("blob:") ? null : item.imageUrl,
    videoUrl: item.videoUrl,
  })));
  useEffect(() => { if (kind === "videos") publishPreview?.(snapshot); }, [kind, publishPreview, snapshot]);
  useEffect(() => () => { if (kind === "videos") publishPreview?.("[]"); }, [kind, publishPreview]);
  return workspace?.renderLibrary ? workspace.renderLibrary(kind, items) : children;
}
