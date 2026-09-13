begin;

-- Venue affiliation approves venue-specific work, not a dancer's public profile.
-- Match the existing verified + explicitly published application contract while
-- preserving owner/admin branches, column privileges and all write restrictions.
alter policy "approved public dancers are public" on public.dancer_profiles
using (
  (status = 'approved' and verification_status = 'approved'
   and is_public = true and disabled_at is null)
  or user_id = auth.uid()
  or public.is_admin()
);

alter policy "approved photos are public" on public.dancer_photos
using (
  (review_status = 'approved' and exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = dancer_photos.dancer_id
      and dancer.status = 'approved' and dancer.verification_status = 'approved'
      and dancer.is_public = true and dancer.disabled_at is null
  ))
  or exists (
    select 1 from public.dancer_profiles dancer
    where dancer.id = dancer_photos.dancer_id
      and public.is_current_dancer_owner(dancer.id)
  )
  or public.is_admin()
);

commit;
