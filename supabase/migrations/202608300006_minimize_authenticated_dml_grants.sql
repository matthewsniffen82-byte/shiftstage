begin;

-- These tables are written only by the service role or trusted database
-- functions. Their browser-role policies are read-only, so retain the reads
-- while removing legacy DML grants that RLS previously had to fail closed.
revoke insert, update, delete on table
  public.commission_events,
  public.dancer_earning_status_history,
  public.dancer_payout_accounts,
  public.dancer_payout_batches,
  public.dancer_payout_items,
  public.financial_audit_events,
  public.mydancr_tv_events,
  public.nats_affiliate_accounts,
  public.nats_agent_affiliate_accounts,
  public.nats_agent_commission_exports,
  public.nats_commission_exports,
  public.payment_provider_webhook_events,
  public.payout_settings,
  public.support_ai_runs,
  public.venue_page_events
from anon, authenticated;

-- Inserts for these analytics tables are already server-mediated. Preserve
-- their legitimate read policies while removing unused mutation privileges.
revoke update, delete on table
  public.direction_requests,
  public.profile_views,
  public.schedule_views,
  public.social_clicks,
  public.support_messages
from anon, authenticated;

-- Users can create/update their own support threads but never delete them.
revoke delete on table public.support_threads from anon, authenticated;

-- Clearing notifications is an intended authenticated flow. Keep DELETE for
-- authenticated users and make the row boundary explicit instead of routing
-- this simple owner-scoped action through the service role.
revoke delete on table public.notifications from anon;
drop policy if exists "users delete own notifications" on public.notifications;
create policy "users delete own notifications"
on public.notifications
for delete
to authenticated
using (recipient_id = auth.uid());

commit;
