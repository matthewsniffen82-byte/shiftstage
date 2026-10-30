import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/dancer-agreement-2026-10-08-v3.json";
export const metadata = { title: "Dancer Agreement — October 8, 2026 | MyDancr" };
export default function Page() { return <LegalDocument document={document} />; }
