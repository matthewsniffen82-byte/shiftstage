import "../dancer-dashboard.css";
import "../dashboard-polish.css";
import "../professional-dashboard-compact.css";
import "../dancer-profile-builder-polish.css";
import "../dancer-onboarding.css";
import "../dancer-premium.css";
import "../dancer-profile-workspace.css";
import "../dancer-upload-actions.css";
import "../../components/dashboard-header.css";
import "../dancer-onboarding-compact.css";
import type { ReactNode } from "react";
import DancerAgreementGate from "../DancerAgreementGate";

export default function DancerLayout({ children }: { children: ReactNode }) {
  return <DancerAgreementGate>{children}</DancerAgreementGate>;
}
