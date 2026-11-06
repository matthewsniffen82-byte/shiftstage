"use client";

import { useEffect, useRef, useState } from "react";

/** Keep small brand fills violet when Samsung recolors nested CSS backgrounds. */
export default function SamsungBrandFill() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (!/SamsungBrowser/i.test(navigator.userAgent)) return;
    const canvas = ref.current;
    if (!canvas?.parentElement) return;
    try {
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = getComputedStyle(canvas.parentElement).getPropertyValue("--dancr-color-brand-primary").trim() || "#6d28ff";
      context.fillRect(0, 0, 1, 1);
      setPainted(true);
    } catch { /* Keep the CSS fill if canvas is unavailable. */ }
  }, []);
  return <canvas ref={ref} width={1} height={1} aria-hidden="true" style={{
    display: painted ? "block" : "none", position: "absolute", inset: 0, width: "100%", height: "100%",
    borderRadius: "inherit", pointerEvents: "none", zIndex: -1,
  }} />;
}
