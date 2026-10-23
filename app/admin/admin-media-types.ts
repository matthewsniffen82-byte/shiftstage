export type MediaReviewItem = {
  id: string; queue_key: string; kind: "photo" | "video"; stage: string; dancer_name: string;
  venue_name: string | null; created_at: string; updated_at: string; previewUrl: string;
  caption: string | null; club_reviewed_at: string | null; club_reviewer_name: string | null;
  club_review_notes: string | null; claimed_by: string | null; claimed_by_name: string | null;
};
export type MediaReviewPage = { items: MediaReviewItem[]; total: number; nextCursor: string | null; counts: { staff: number; club: number; processing: number } };
