import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/report-harmful-content.json";
import Link from "next/link";
export const metadata = { title: "Report Harmful Content | MyDancr" };
export default function Page() { return <LegalDocument document={document}><p><Link href="/report-harmful-content/submit">Submit a safety report or intimate-image removal request</Link>. No account is required.</p></LegalDocument>; }
