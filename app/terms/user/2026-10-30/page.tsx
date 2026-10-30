import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/user-terms-2026-10-30.json";
export const metadata = { title: "User Terms — October 30, 2026 | MyDancr" };
export default function Page() { return <LegalDocument document={document} />; }
