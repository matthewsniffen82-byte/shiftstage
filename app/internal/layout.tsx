import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Manrope } from "next/font/google";
import "./internal.css";
import "./internal-dashboard.css";
import "./internal-grid.css";
import "./internal-guest.css";
import "./internal-brand.css";
import "./internal-guest-colors.css";
import "@/public/venue-roster-header.css";
import "../dashboard/venue-operations.css";

const wordmarkFont = Manrope({ weight: "800", subsets: ["latin"], display: "swap", variable: "--font-mydancr-wordmark" });

// The roster, table links and follow-return page share a fresh document nonce.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "MyDancr • Internal", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function InternalLayout({ children }: { children: ReactNode }) { return <div className={`internal-page-surface ${wordmarkFont.variable}`}>{children}</div>; }
