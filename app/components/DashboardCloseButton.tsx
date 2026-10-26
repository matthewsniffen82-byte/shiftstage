"use client";

import { useEffect, useState } from "react";
import { dashboardHomeReturnHref } from "@/src/lib/dancr/home-return";

export function DashboardCloseButton({
  fallbackHref = "/",
  label = "Back to MyDancr",
}: {
  fallbackHref?: string;
  label?: string;
}) {
  const [href, setHref] = useState(fallbackHref);
  useEffect(() => { setHref(dashboardHomeReturnHref(fallbackHref)); }, [fallbackHref]);

  return (
    <a
      aria-label={label}
      className="dancr-home-back"
      href={href}
    >
      <span aria-hidden="true">‹</span> Back to MyDancr
    </a>
  );
}
