export default function NfcIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect x="3.5" y="2.5" width="10" height="19" rx="2" />
      <path d="M7.4 18.5h2.2" />
      <path d="M15.5 8.2a4.4 4.4 0 0 1 0 7.6" />
      <path d="M18 5.5a7.5 7.5 0 0 1 0 13" />
    </svg>
  );
}
