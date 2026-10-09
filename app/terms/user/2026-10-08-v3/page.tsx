import LegalDocument from "@/app/components/LegalDocument";
import document from "@/src/content/legal/user-terms-2026-10-08-v3.json";

export const metadata = { title: "User Terms — October 8, 2026 | MyDancr" };
export default function UserTermsVersionPage() {
  return <LegalDocument document={document} />;
}
