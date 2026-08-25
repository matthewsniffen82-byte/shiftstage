begin;

alter type public.notification_type add value if not exists 'venue_publication_status';

create or replace function public.notify_venue_card_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active is true
    and new.page_review_status = 'published'
    and new.published_at is not null
    and old.published_at is null
  then
    insert into public.notifications (
      recipient_id,
      notification_type,
      channel,
      title,
      body,
      payload,
      sent_at
    )
    select
      recipients.user_id,
      'venue_publication_status',
      'in_app',
      'Your venue card is live',
      new.name || ' is now visible in MyDancr venue discovery and on its public venue page.',
      jsonb_build_object(
        'kind', 'venue_card_live',
        'status', 'live',
        'venueId', new.id,
        'venueSlug', new.slug,
        'venueName', new.name,
        'publishedAt', new.published_at
      ),
      new.published_at
    from (
      select new.owner_user_id as user_id
      union
      select member.user_id
      from public.venue_team_members as member
      where member.venue_id = new.id
        and member.status = 'active'
    ) as recipients
    join public.app_users as account
      on account.id = recipients.user_id
     and account.role = 'venue'
     and account.account_state = 'active'
    where recipients.user_id is not null
      and not exists (
        select 1
        from public.notifications as existing
        where existing.recipient_id = recipients.user_id
          and existing.notification_type = 'venue_publication_status'
          and existing.payload @> jsonb_build_object(
            'kind', 'venue_card_live',
            'venueId', new.id
          )
      );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_venue_card_live_after_publication on public.venues;
create trigger notify_venue_card_live_after_publication
after update of is_active, published_at, page_review_status on public.venues
for each row execute function public.notify_venue_card_live();

revoke all on function public.notify_venue_card_live() from public, anon, authenticated;

comment on function public.notify_venue_card_live() is
  'Creates one durable in-app notification for the active venue owner and team when the venue card is first published.';

commit;
