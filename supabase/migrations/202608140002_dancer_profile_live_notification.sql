create or replace function public.notify_dancer_profile_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue_name text;
begin
  if new.status = 'approved'
    and new.verification_status = 'approved'
    and new.is_public = true
    and new.venue_approved_at is not null
    and (
      old.status is distinct from new.status
      or old.verification_status is distinct from new.verification_status
      or old.is_public is distinct from new.is_public
    )
  then
    select venue.name
    into v_venue_name
    from public.venues venue
    where venue.id = new.venue_approved_venue_id;

    insert into public.notifications (
      recipient_id,
      notification_type,
      channel,
      title,
      body,
      payload,
      sent_at
    ) values (
      new.user_id,
      'venue_affiliation_status',
      'in_app',
      'Your profile is live',
      case
        when v_venue_name is not null then 'Approved through ' || v_venue_name || '. Customers can now discover your profile on MyDancr.'
        else 'Your dressing-room tap was approved. Customers can now discover your profile on MyDancr.'
      end,
      jsonb_build_object(
        'kind', 'dancer_profile_live',
        'dancerId', new.id,
        'dancerSlug', new.slug,
        'venueId', new.venue_approved_venue_id,
        'venueName', v_venue_name
      ),
      coalesce(new.approved_at, now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_dancer_profile_live_after_activation on public.dancer_profiles;
create trigger notify_dancer_profile_live_after_activation
after update of status, verification_status, is_public on public.dancer_profiles
for each row execute function public.notify_dancer_profile_live();

revoke all on function public.notify_dancer_profile_live() from public, anon, authenticated;

comment on function public.notify_dancer_profile_live() is
  'Creates the dancer in-app profile-live confirmation only after verified public activation.';
