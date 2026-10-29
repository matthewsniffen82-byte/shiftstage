"use client";

import { createContext, type ReactNode } from "react";
import type { MediaLibraryItem } from "./media-library-items";

export type ProfileUploadKind = "photos" | "videos";

// A library strip can reuse its mounted uploader's local video previews while
// the server is still preparing posters. The uploader retains URL ownership.
export const DancerMediaPreviewContext = createContext<((snapshot: string) => void) | null>(null);

// Controls the editor and chooser while upload/review queues stay mounted.
export const DancerProfileUploadContext = createContext<{
  active: ProfileUploadKind | null;
  open: (kind: ProfileUploadKind) => void;
  libraryEditor?: boolean;
  busy?: boolean;
  venueId?: string | null;
  displayedMedia?: { photos: string[]; videos: string[] };
  renderLibrary?: (kind: ProfileUploadKind, uploads: MediaLibraryItem[]) => ReactNode;
} | null>(null);
