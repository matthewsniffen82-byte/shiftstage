import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk } from "next/font/google";
import "./pickup.css";
const pickupUi = Inter({ subsets: ["latin"], display: "swap", variable: "--pickup-font-ui" });
const pickupDisplay = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--pickup-font-display" });
export const metadata: Metadata = { title: "Club Pickup | MyDancr", robots: { index: false, follow: false }, referrer: "same-origin" };
export default function PickupLayout({ children }: { children: ReactNode }) {
  return <main className={`pickup-page ${pickupUi.variable} ${pickupDisplay.variable}`} data-global-navigation-swipe="ignore">{children}</main>;
}
