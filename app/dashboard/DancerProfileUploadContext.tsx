"use client";

import { createContext } from "react";

export type ProfileUploadKind = "photos" | "videos";

// Controls the editor and chooser while upload/review queues stay mounted.
export const DancerProfileUploadContext = createContext<{
  active: ProfileUploadKind | null;
  open: (kind: ProfileUploadKind) => void;
  libraryEditor?: boolean;
  busy?: boolean;
  displayedMedia?: { photos: string[]; videos: string[] };
} | null>(null);
