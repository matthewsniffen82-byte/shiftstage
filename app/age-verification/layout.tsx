import type { ReactNode } from "react";

export default function AgeVerificationLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        body.dancr-button-system {
          margin: 0 !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          overflow-x: hidden !important;
          background: #050507 !important;
        }
      `}</style>
      {children}
    </>
  );
}
