import type { Metadata } from "next";
import GuidesClient from "./GuidesClient";
import "./guides.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Onboarding guides | MyDancr",
  description: "Role guides and one-page cheat sheets for MyDancr club teams and dancers.",
  robots: { index: false, follow: false },
};

export default function GuidesPage() {
  return <GuidesClient />;
}
