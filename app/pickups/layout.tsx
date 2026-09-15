import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./pickup.css";
export const metadata: Metadata = { title: "Club Pickup | MyDancr", robots: { index: false, follow: false }, referrer: "same-origin" };
export default function PickupLayout({ children }: { children: ReactNode }) {
  return <main className="pickup-page" data-global-navigation-swipe="ignore">{children}</main>;
}
