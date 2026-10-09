"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DANCER_AGREEMENT_VERSION, type DancerAgreementAccess } from "@/src/lib/dancr/dancer-agreement-version";
import { readSession, requestDashboardJson } from "./dashboard-session";
import "./dancer-agreement-gate.css";

export default function DancerAgreementGate({ children }: { children: ReactNode }) {
  const [agreement, setAgreement] = useState<DancerAgreementAccess | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const isDashboard = pathname === "/dashboard/dancer";

  useEffect(() => {
    // Agreement review belongs to the dashboard's existing profile setup step.
    if (isDashboard) return;
    const controller = new AbortController();
    const userId = readSession()?.account?.id;
    const sameAccount = () => userId ? readSession()?.account?.id === userId : !readSession()?.accessToken;
    setAgreement(null);
    setError("");
    void requestDashboardJson("/api/dancer/agreement", {
      cache: "no-store", signal: controller.signal, timeoutMs: 15000,
    }).then(data => {
      if (controller.signal.aborted || !sameAccount()) return;
      if (data.agreement?.version !== DANCER_AGREEMENT_VERSION) {
        throw new Error("Unable to check your agreement. Please try again.");
      }
      setAgreement(data.agreement);
      if (data.agreement.required && !data.agreement.accepted) router.replace("/dashboard/dancer");
    }).catch(failure => {
      if (!controller.signal.aborted && sameAccount()) setError(failure instanceof Error ? failure.message : "Unable to check your agreement. Please try again.");
    });
    const checkAccount = () => {
      if (!sameAccount()) {
        controller.abort();
        setAgreement(null);
        setAttempt(value => value + 1);
      }
    };
    window.addEventListener("storage", checkAccount);
    window.addEventListener("pageshow", checkAccount);
    window.addEventListener("focus", checkAccount);
    return () => {
      controller.abort();
      window.removeEventListener("storage", checkAccount);
      window.removeEventListener("pageshow", checkAccount);
      window.removeEventListener("focus", checkAccount);
    };
  }, [attempt, isDashboard, pathname, router]);

  if (isDashboard || (agreement?.version === DANCER_AGREEMENT_VERSION
    && (agreement.required === false || agreement.accepted === true))) return <>{children}</>;

  if (!error) {
    return <main className="dancer-agreement-gate" aria-busy="true">
      <span className="dancer-agreement-loading-status" role="status">Loading dancer dashboard</span>
    </main>;
  }

  return <main className="dancer-agreement-gate">
    <section aria-labelledby="agreement-heading">
      <h1 id="agreement-heading">Unable to open this dancer tool</h1>
      <p role="alert">{error}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>
      <p className="dancer-agreement-note"><Link href="/dashboard/dancer">Back to dashboard</Link>{" · "}<a href="mailto:support@mydancr.com">Contact support</a></p>
    </section>
  </main>;
}
