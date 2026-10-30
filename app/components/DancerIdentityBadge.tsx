export function DancerIdentityBadge({ verified }: { verified?: boolean }) {
  if (verified !== true) return null;
  return <button type="button" className="dancer-identity-badge is-profile" data-identity-verified-badge=""
    aria-label="ID verified. Learn about verification" aria-haspopup="dialog"
    title="Identity and age 18+ verified through Ondato.">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 2 3 5v6c0 5.1 3.4 9.1 9 11 5.6-1.9 9-5.9 9-11V5l-9-3Z" />
      <path d="m7.5 12 3 3 6-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>;
}
