-- Inbox recipients may mark messages read; message identity/content is server-owned.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

revoke update on public.notifications from public, anon, authenticated;
revoke update (id, recipient_id, notification_type, channel, title, body, payload,
  read_at, sent_at, created_at) on public.notifications from public, anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

commit;
