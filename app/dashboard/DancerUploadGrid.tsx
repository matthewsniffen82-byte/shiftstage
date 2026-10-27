"use client";

import { useContext, type ReactNode } from "react";
import { DancerProfileUploadContext, type ProfileUploadKind } from "./DancerProfileUploadContext";
import type { MediaLibraryItem } from "./media-library-items";

// The uploader owns its local previews; the workspace supplies the shared grid.
export default function DancerUploadGrid({ kind, items, children }: {
  kind: ProfileUploadKind; items: MediaLibraryItem[]; children: ReactNode;
}) {
  const workspace = useContext(DancerProfileUploadContext);
  return workspace?.renderLibrary ? workspace.renderLibrary(kind, items) : children;
}
