"use client";
import MediaBatchReview from "../components/MediaBatchReview";

export default function VenueMediaReviewPanel({ venueId, active, refreshKey, reviewDancer, onReviewStateChange, onBusyChange, onSubmitted }: {
  venueId: string; active: boolean; refreshKey?: string | null;
  reviewDancer: { id: string; stageName: string }; onReviewStateChange?: (pending: number | null) => void;
  onBusyChange?: (busy: boolean) => void; onSubmitted?: (message: string) => void;
}) {
  return <MediaBatchReview role="venue" venueId={venueId} dancerId={reviewDancer.id} active={active}
    refreshKey={refreshKey} onPendingChange={onReviewStateChange} onBusyChange={onBusyChange} onSubmitted={onSubmitted} />;
}
