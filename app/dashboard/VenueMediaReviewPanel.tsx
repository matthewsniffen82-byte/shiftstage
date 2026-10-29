"use client";
import MediaBatchReview from "../components/MediaBatchReview";

export default function VenueMediaReviewPanel({ venueId, active, refreshKey, onCountChange, reviewDancer, onReviewStateChange, onBusyChange }: {
  venueId: string; active: boolean; refreshKey?: string | null; onCountChange: (count: number) => void;
  reviewDancer?: { id: string; stageName: string }; onReviewStateChange?: (pending: number | null) => void;
  onBusyChange?: (busy: boolean) => void; updatesOnly?: boolean;
}) {
  return <MediaBatchReview role="venue" venueId={venueId} dancerId={reviewDancer?.id} active={active}
    refreshKey={refreshKey} onCountChange={onCountChange} onPendingChange={onReviewStateChange} onBusyChange={onBusyChange} />;
}
