import type { ReactNode, Ref } from "react";

export function mediaItemCount(count: number) {
  return `${count} media item${count === 1 ? "" : "s"}`;
}

type Props = {
  name: string;
  subtitle?: ReactNode;
  count: number;
  label: string;
  detail?: ReactNode;
  portrait: ReactNode;
  accessibleLabel: string;
  disabled: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onOpen: () => void;
};

export default function MediaReviewDancerCard({ name, subtitle, count, label, detail, portrait, accessibleLabel, disabled, buttonRef, onOpen }: Props) {
  return <article className="venue-dancer-card">
    <div className="venue-card-portrait media-batch-preview">
      <button className="ir-profile-link venue-card-profile" type="button" ref={buttonRef}
        disabled={disabled} aria-label={accessibleLabel} onClick={onOpen}>
        {portrait}
        <span className="venue-card-caption">
          <strong>{name}</strong>
          {subtitle && <small>{subtitle}</small>}
          <small className={count > 0 ? "venue-media-item-count" : undefined}>{mediaItemCount(count)}</small>
          {detail && <small>{detail}</small>}
        </span>
      </button>
      <h4 className="media-batch-label">{label}</h4>
    </div>
  </article>;
}
