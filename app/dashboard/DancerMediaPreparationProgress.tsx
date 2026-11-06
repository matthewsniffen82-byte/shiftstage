"use client";

export default function DancerMediaPreparationProgress({ label, showLabel = true, className = "dancer-media-slot-progress" }: {
  label: string;
  showLabel?: boolean;
  className?: string;
}) {
  return <div className={className}>
    {showLabel ? <span role="status">Uploading…</span> : null}
    <span className="dancer-upload-progress is-indeterminate" role="progressbar" aria-label={`${label}: Uploading`}>
      <span />
    </span>
  </div>;
}
