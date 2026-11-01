import { permanentRedirect } from "next/navigation";
import { DANCER_AGREEMENT_HREF } from "@/src/lib/dancr/dancer-agreement-version";

// Historical acceptance evidence is retained privately; public links show the approved set.
export default function Page() { permanentRedirect(DANCER_AGREEMENT_HREF); }
