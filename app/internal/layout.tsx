import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./internal.css";
import "./internal-dashboard.css";

export const metadata: Metadata = { title: "MyDancr • Internal", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function InternalLayout({ children }: { children: ReactNode }) { return children; }
