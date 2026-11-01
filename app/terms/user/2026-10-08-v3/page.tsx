import { permanentRedirect } from "next/navigation";
import { USER_TERMS_HREF } from "@/src/lib/dancr/user-terms-version";

export default function UserTermsVersionPage() { permanentRedirect(USER_TERMS_HREF); }
