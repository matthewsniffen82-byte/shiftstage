import type { Metadata } from "next";
import Link from "next/link";
import LegalDocument from "../components/LegalDocument";
import document from "@/src/content/legal/privacy.json";

export const metadata: Metadata = {
  title: "Privacy Policy | mydancr",
  description: "MyDancr's Privacy Policy and information about your privacy rights.",
};

export default function PrivacyPage() {
  return <LegalDocument document={document}>
    <p><strong>Club customer lists.</strong> Following a club stays private unless you separately choose to share your name, account email, and optional city with that club. Its owners and managers can see the details you share. You can stop sharing in Saved clubs; unfollowing also removes your follower details. Guest-list contact details remain available for an active visit under the permission given when joining. Neither choice subscribes you to marketing emails or texts.</p>
    <p>California residents: read our <Link href="/privacy/california">California Privacy Notice</Link>.</p>
  </LegalDocument>;
}
