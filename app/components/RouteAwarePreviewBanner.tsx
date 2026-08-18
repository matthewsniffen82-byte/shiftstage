"use client";

import { usePathname } from "next/navigation";
import { MyDancrPreviewBanner } from "./MyDancrPreviewBanner";

export function RouteAwarePreviewBanner() {
  const pathname = usePathname();
  if (pathname.startsWith("/age-verification")) return null;
  return <MyDancrPreviewBanner />;
}
