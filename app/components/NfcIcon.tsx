export default function NfcIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 28 28"
    >
      <path d="M8.8 9.2a6.8 6.8 0 0 1 0 9.6" />
      <path d="M5.2 5.6a11.8 11.8 0 0 1 0 16.8" />
      <path d="M12 12.1a2.7 2.7 0 0 1 0 3.8" />
      <rect x="15" y="7" width="8" height="14" rx="2" />
    </svg>
  );
}
