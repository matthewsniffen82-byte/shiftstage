"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function VenueAdminUtilities() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > Math.max(480, window.innerHeight * .75));
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return visible ? createPortal(<button className="venue-scroll-top" type="button" aria-label="Scroll to top" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 12 6-6 6 6M12 6v14" /></svg>
  </button>, document.body) : null;
}
