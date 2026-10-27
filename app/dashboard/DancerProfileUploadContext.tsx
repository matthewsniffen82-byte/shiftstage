"use client";

import { createContext, type ReactNode } from "react";
import type { MediaLibraryItem } from "./media-library-items";

export type ProfileUploadKind = "photos" | "videos";

// Controls the editor and chooser while upload/review queues stay mounted.
export const DancerProfileUploadContext = createContext<{
  active: ProfileUploadKind | null;
  open: (kind: ProfileUploadKind) => void;
  libraryEditor?: boolean;
  busy?: boolean;
  displayedMedia?: { photos: string[]; videos: string[] };
  renderLibrary?: (kind: ProfileUploadKind, uploads: MediaLibraryItem[]) => ReactNode;
} | null>(null);
