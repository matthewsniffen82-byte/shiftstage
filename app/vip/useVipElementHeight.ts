"use client";

import { useEffect, type RefObject } from "react";

export function useVipElementHeight(source: RefObject<HTMLElement | null>, target: RefObject<HTMLElement | null>, property: string, active = true) {
  useEffect(() => {
    const element = source.current, surface = target.current;
    if (!active || !element || !surface || typeof window === "undefined") return;
    const measure = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height > 0) surface.style.setProperty(property, `${height}px`);
    };
    // Text wrapping, browser zoom, and orientation changes can all resize the sticky controls.
    measure();
    const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      surface.style.removeProperty(property);
    };
  }, [source, target, property, active]);
}
