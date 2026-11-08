"use client";
import MediaBatchReview, { type ReviewProgress } from "../components/MediaBatchReview";

export default function VenueMediaReviewPanel({ venueId, active, refreshKey, reviewDancer, profileReview, locked, onReviewStateChange, onBusyChange, onSubmitted }: {
  venueId: string; active: boolean; refreshKey?: string | null;
  reviewDancer: { id: string; stageName: string }; profileReview?: boolean; locked?: boolean; onReviewStateChange?: ReviewProgress;
  onBusyChange?: (busy: boolean) => void; onSubmitted?: (message: string) => void;
}) {
  return <MediaBatchReview role="venue" venueId={venueId} dancerId={reviewDancer.id} active={active}
    refreshKey={refreshKey} profileReview={profileReview} locked={locked} onPendingChange={onReviewStateChange} onBusyChange={onBusyChange} onSubmitted={onSubmitted} />;
}
