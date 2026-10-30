export function DancerIdentityBadge({ verified }: { verified?: boolean }) {
  if (verified !== true) return null;
  return <button type="button" className="dancer-identity-badge is-profile" data-identity-verified-badge=""
    aria-label="ID verified. Learn about verification" aria-haspopup="dialog"
    title="Identity and age 18+ verified through Ondato.">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="m12 1.5 2.9 1.9 3.4.3 1.3 3.2 2.4 2.5-.8 3.4.3 3.4-2.9 1.9-1.8 2.9-3.5-.3-3.3.8-2.5-2.4-3.2-1.3-.3-3.4L1.5 12l1.9-2.9.3-3.4 3.2-1.3L9.4 2l2.6-.5Z" />
      <path d="m7.5 12 3 3 6-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>;
}
