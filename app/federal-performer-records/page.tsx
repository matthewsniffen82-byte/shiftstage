import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/federal-performer-records.json";
export const metadata = { title: "Federal Performer Records Notice | MyDancr" };
export default function Page() { return <LegalDocument document={document} />; }
