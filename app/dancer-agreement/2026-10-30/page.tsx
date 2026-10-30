import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/dancer-agreement-2026-10-30.json";
export const metadata = { title: "Dancer Agreement — October 30, 2026 | MyDancr" };
export default function Page() { return <LegalDocument document={document} />; }
