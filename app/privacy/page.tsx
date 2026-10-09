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
    <p><strong>VIP and table requests.</strong> Club staff can see requests associated with a table; people using the same table link can see and cancel its open requests. Club owners and managers can see VIP names and requests. For VIP activation, MyDancr records the account, invitation, club, accepted terms version and server time to document acceptance. Opening a table roster or its terms box is not recorded as checkbox acceptance. These features do not subscribe you to marketing or opt you into a club customer list.</p>
    <p><strong>Club customer lists.</strong> Following a club stays private unless you separately choose to share your name, account email, and optional city with that club. Its owners and managers can see the details you share. You can stop sharing in Saved clubs; unfollowing also removes your follower details. Guest-list contact details remain available for an active visit under the permission given when joining. Neither choice subscribes you to marketing emails or texts.</p>
    <p>California residents: read our <Link href="/privacy/california">California Privacy Notice</Link>.</p>
  </LegalDocument>;
}
