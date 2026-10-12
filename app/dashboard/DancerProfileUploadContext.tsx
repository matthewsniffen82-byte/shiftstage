"use client";

import { createContext } from "react";

export type ProfileUploadKind = "photos" | "videos";

// Only controls the chooser. Upload and review queues stay mounted outside it.
export const DancerProfileUploadContext = createContext<{
  active: ProfileUploadKind | null;
  open: (kind: ProfileUploadKind) => void;
} | null>(null);
