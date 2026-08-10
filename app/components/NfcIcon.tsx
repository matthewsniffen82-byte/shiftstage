export default function NfcIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M5.2 7.1a7.1 7.1 0 0 1 0 9.8" />
      <path d="M8.4 9.2a4.1 4.1 0 0 1 0 5.6" />
      <path d="M11.5 11.25a1.1 1.1 0 0 1 0 1.5" />
      <path d="M15.1 6.2v11.6l3.7-2.6V8.8l-3.7-2.6Z" />
    </svg>
  );
}
