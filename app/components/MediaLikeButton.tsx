import type { MediaLikeType } from "@/src/lib/dancr/use-anonymous-media-likes";

export function MediaLikeButton({
  mediaType,
  liked,
  likeCount,
  pending,
  className = "",
  onToggle,
}: {
  mediaType: MediaLikeType;
  liked: boolean;
  likeCount: number;
  pending: boolean;
  className?: string;
  onToggle: () => void;
}) {
  const label = `${liked ? "Unlike" : "Like"} this ${mediaType}`;
  return (
    <button
      aria-label={`${label}. ${formatLikeCount(likeCount)} ${likeCount === 1 ? "like" : "likes"}.`}
      aria-pressed={liked}
      className={`${className}${liked ? " is-liked" : ""}`}
      disabled={pending}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <HeartIcon />
      <span aria-hidden="true">{formatLikeCount(likeCount)}</span>
    </button>
  );
}

function HeartIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20.8 8.6C20.8 13.9 12 19 12 19S3.2 13.9 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z" />
    </svg>
  );
}

function formatLikeCount(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
