begin;

create table public.notification_email_signins (
  id uuid primary key default gen_random_uuid(),
  delivery_tag text not null unique,
  recipient_id uuid not null references public.app_users(id) on delete cascade,
  recipient_role text not null check (recipient_role in ('venue','dancer','customer')),
  email_tag text not null,
  venue_id uuid references public.venues(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  used_at timestamptz
);
create index notification_email_signins_recipient on public.notification_email_signins(recipient_id);
create index notification_email_signins_venue on public.notification_email_signins(venue_id) where venue_id is not null;
create index notification_email_signins_expiry on public.notification_email_signins(expires_at);
alter table public.notification_email_signins enable row level security;
revoke all on public.notification_email_signins from public,anon,authenticated;
grant select,insert,update,delete on public.notification_email_signins to service_role;

-- Use the worker's actual recipient for queued mail. Never infer an account from an email address.
create function public.prepare_notification_email_signin(p_source text,p_delivery uuid,p_recipient uuid,
  p_role text,p_email text,p_email_tag text,p_delivery_tag text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare recipient uuid; club uuid; receipt uuid;
begin
  case p_source
    when 'venue' then
      select recipient_id,venue_id into recipient,club from public.venue_email_deliveries
        where id=p_delivery and status='sending' and destination=p_email and p_role='venue';
    when 'dancer' then
      select recipient_id into recipient from public.dancer_media_email_deliveries
        where id=p_delivery and status='sending' and destination=p_email and p_role='dancer';
    when 'digest' then
      select recipient_id into recipient from public.club_offer_digests
        where id=p_delivery and status='sending' and destination=p_email and p_role='customer';
    when 'notification' then recipient:=p_recipient;
    else return null;
  end case;
  if not exists(select 1 from public.app_users where id=recipient and role::text=p_role
    and account_state='active' and lower(btrim(email))=lower(btrim(p_email))) then return null; end if;
  insert into public.notification_email_signins(delivery_tag,recipient_id,recipient_role,email_tag,venue_id)
    values(p_delivery_tag,recipient,p_role,p_email_tag,club) on conflict(delivery_tag) do nothing returning id into receipt;
  if receipt is null then
    select id into receipt from public.notification_email_signins where delivery_tag=p_delivery_tag and recipient_id=recipient
      and recipient_role=p_role and email_tag=p_email_tag and venue_id is not distinct from club;
  end if;
  return receipt;
end $$;
revoke all on function public.prepare_notification_email_signin(text,uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_notification_email_signin(text,uuid,uuid,text,text,text,text) to service_role;

insert into public.lifecycle_retention_rules(source,policy_id,policy_revision,due_expression)
select 'notification_email_signins',policy_id,policy_revision,'t.expires_at + interval ''1 day'''
from public.lifecycle_retention_rules where source='venue_email_deliveries';
commit;
