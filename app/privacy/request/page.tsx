import Link from "next/link";
import PrivacyRequestForm from "./PrivacyRequestForm";
import "@/app/components/legal-document.css";
export const metadata = { title: "Privacy request | MyDancr" };
export default function Page() {
  return <main className="legal-document-shell"><nav className="legal-document-nav"><Link href="/">MyDancr</Link><Link href="/privacy">Privacy Policy</Link></nav><h1>Make a privacy request</h1><p>No account is required. Tell us what you need and how to contact you. Do not include passwords, identity documents, or intimate images. You can also email <a href="mailto:support@mydancr.com">support@mydancr.com</a>.</p><PrivacyRequestForm /></main>;
}
