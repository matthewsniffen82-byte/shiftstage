export type MediaReviewItem = {
  id: string; queue_key: string; kind: "photo" | "video"; stage: string; dancer_name: string;
  venue_name: string | null; created_at: string; updated_at: string; previewUrl: string; posterUrl?: string;
  caption: string | null; club_reviewed_at: string | null; club_reviewer_name: string | null;
  club_review_notes: string | null; claimed_by: string | null; claimed_by_name: string | null;
  upload_context?: string | null; decision?: string; review_notes?: string | null;
};
export type MediaReviewPage = { items: MediaReviewItem[]; total: number; nextCursor: string | null; counts: { staff: number; club: number; processing: number } };
export type MediaReviewDancer = { id: string; stageName: string; count: number; photoCount: number; videoCount: number; previewKind: "photo" | "video"; previewUrl: string };
export type MediaReviewDancersPage = { dancers: MediaReviewDancer[]; dancerCount: number; total: number; counts: MediaReviewPage["counts"] };
