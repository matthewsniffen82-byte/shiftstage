import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/dancer-verification.json";
export const metadata = { title: "Dancer Verification and Biometric Privacy Notice | MyDancr" };
export default function Page() { return <LegalDocument document={document} />; }
