import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicApiError } from "../api-error-policy";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type DancerMediaEditor = { dancerId: string; venueId: string | null; onboarding: boolean; clubs: { id: string; name: string }[] };
export async function dancerMediaEditor(admin: SupabaseClient, userId: string, request: Request, allowNoClub = false): Promise<DancerMediaEditor> {
  const requested = request.headers.get("x-dancer-media-venue") || null;
  if (requested && !uuid.test(requested)) throw new PublicApiError("INVALID_REQUEST", "Choose a valid club.", 400);
  const { data, error } = await admin.rpc("dancer_media_editor_context", { p_actor: userId, p_venue: requested });
  if (error) throw new PublicApiError(error.code === "40001" ? "CONFLICT" : "FORBIDDEN", error.code === "40001"
    ? "Your check-in changed. Open the current club editor and try again." : "Choose one of your connected clubs.", error.code === "40001" ? 409 : 403);
  const context = data as DancerMediaEditor;
  if (context.onboarding) return { ...context, venueId: null };
  if (!context.venueId && !allowNoClub) throw new PublicApiError("INVALID_REQUEST", "Choose a club to edit its media.", 400);
  return context;
}

export async function assertEditorMedia(admin: SupabaseClient, userId: string, context: DancerMediaEditor, kind: string, id: string) {
  if (!context.venueId) return;
  const { data, error } = await admin.rpc("dancer_club_media_statuses", { p_user_id: userId });
  if (error) throw error;
  if (!Array.isArray(data) || !data.some(row => row.venueId === context.venueId && row.kind === kind && !row.hidden && (row.id === id || row.photoId === id))) {
    throw new PublicApiError("FORBIDDEN", "This media does not belong to the selected club.", 403);
  }
}

export async function editClubMedia(admin: SupabaseClient, userId: string, context: DancerMediaEditor, kind: string, id: string, action: string, pinned?: boolean) {
  const { data, error } = await admin.rpc("edit_dancer_club_media", { p_actor: userId, p_venue: context.venueId,
    p_kind: kind, p_id: id, p_action: action, p_pinned: pinned ?? null });
  if (error) throw new PublicApiError("CONFLICT", "This club's media changed. Refresh and try again.", 409);
  return action === "remove" ? { ...data, deletedIds: [id] } : data;
}

export async function clubPhotoInput<T extends { isPrimary?: boolean; replacementPhotoId?: string | null; editorVenueId?: string | null }>(
  admin: SupabaseClient, userId: string, context: DancerMediaEditor, input: T,
) {
  if (!context.venueId) return input;
  if (input.editorVenueId && input.editorVenueId !== context.venueId) throw new PublicApiError("CONFLICT", "Return to the club where you started this upload.", 409);
  if (input.replacementPhotoId) await assertEditorMedia(admin, userId, context, "photo", input.replacementPhotoId);
  // Club edits add a new reviewed version. They never overwrite another
  // club's published image or the dancer's original global main photo.
  return { ...input, editorVenueId: context.venueId, editorIsMain: input.isPrimary === true,
    editorReplacesPhotoId: input.replacementPhotoId || null,
    isPrimary: false, sortOrder: undefined, replaceExisting: false, replacementPhotoId: undefined, uploadContext: "profile_gallery" };
}
