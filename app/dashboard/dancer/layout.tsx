import type { ReactNode } from "react";
import DancerAgreementGate from "../DancerAgreementGate";

export default function DancerLayout({ children }: { children: ReactNode }) {
  return <DancerAgreementGate>{children}</DancerAgreementGate>;
}
