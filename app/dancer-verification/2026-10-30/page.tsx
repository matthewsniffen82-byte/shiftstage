import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/dancer-verification-2026-10-30.json";
export const metadata = { title: "Dancer Verification and Biometric Privacy Notice | MyDancr" };
export default function Page() { return <LegalDocument document={document} />; }
