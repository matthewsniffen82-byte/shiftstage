import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/report-harmful-content.json";
export const metadata = { title: "Report Harmful Content | MyDancr" };
export default function Page() { return <LegalDocument document={document} />; }
