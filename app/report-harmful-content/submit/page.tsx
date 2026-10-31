import PublicSafetyIntake from "./PublicSafetyIntake";
import Link from "next/link";
import "@/app/components/legal-document.css";
export const metadata = { title: "Submit a safety report | MyDancr" };
export default function Page() {
  return <main className="legal-document-shell"><nav className="legal-document-nav"><Link href="/">MyDancr</Link><Link href="/report-harmful-content">Reporting policy</Link></nav><h1>Report harmful content</h1><PublicSafetyIntake /></main>;
}
