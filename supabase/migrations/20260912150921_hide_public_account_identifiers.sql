-- Keep login-account identifiers and internal review metadata out of public rows.
-- Ownership policies retain their original joins, visibility checks and role rules.
begin;
set local search_path=pg_catalog,public;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table public.venues,public.dancer_profiles in share row exclusive mode;
do $guard$ begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('is_current_venue_owner','is_current_dancer_owner'))then raise exception 'PUBLIC_OWNER_HELPER_ALREADY_EXISTS';end if;
 if exists(select 1 from unnest(array['venues','dancer_profiles'])t cross join unnest(array['anon','authenticated'])r where has_table_privilege(r,'public.'||t,'SELECT'))then raise exception 'PUBLIC_OWNER_UNEXPECTED_TABLE_SELECT';end if;
 if exists(select 1 from jsonb_to_recordset('[{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"dancers read own reviews","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = approval_reviews.dancer_id) AND (dp.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"approval_reviews","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own club deals","qual":"(EXISTS ( SELECT 1\n   FROM venues v\n  WHERE ((v.id = club_deals.venue_id) AND (v.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"club_deals","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own finance account","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = club_finance_accounts.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"club_finance_accounts","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own invoice items","qual":"(EXISTS ( SELECT 1\n   FROM (club_invoices invoice\n     JOIN venues venue ON ((venue.id = invoice.venue_id)))\n  WHERE ((invoice.id = club_invoice_items.invoice_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"club_invoice_items","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own invoice reminders","qual":"(EXISTS ( SELECT 1\n   FROM (club_invoices invoice\n     JOIN venues venue ON ((venue.id = invoice.venue_id)))\n  WHERE ((invoice.id = club_invoice_reminders.invoice_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"club_invoice_reminders","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own invoices","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = club_invoices.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"club_invoices","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Dancers read own earnings","qual":"(EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = commission_events.dancer_id) AND (dancer.user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"commission_events","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Dancers read own earning history","qual":"(EXISTS ( SELECT 1\n   FROM (commission_events earning\n     JOIN dancer_profiles dancer ON ((dancer.id = earning.dancer_id)))\n  WHERE ((earning.id = dancer_earning_status_history.earning_id) AND (dancer.user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"dancer_earning_status_history","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own dancer NFC enrollments","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = dancer_nfc_enrollments.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"dancer_nfc_enrollments","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Dancers read own payout account","qual":"(EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = dancer_payout_accounts.dancer_id) AND (dancer.user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"dancer_payout_accounts","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Dancers read own payout batches","qual":"(EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = dancer_payout_batches.dancer_id) AND (dancer.user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"dancer_payout_batches","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Dancers read own payout items","qual":"(EXISTS ( SELECT 1\n   FROM (dancer_payout_batches batch\n     JOIN dancer_profiles dancer ON ((dancer.id = batch.dancer_id)))\n  WHERE ((batch.id = dancer_payout_items.payout_batch_id) AND (dancer.user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"dancer_payout_items","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"approved photos are public","qual":"(((review_status = ''approved''::review_status) AND (EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = dancer_photos.dancer_id) AND (dancer.status = ''approved''::dancer_status) AND (dancer.verification_status = ''approved''::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))) OR (EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = dancer_photos.dancer_id) AND (dancer.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"dancer_photos","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"dancers read own direction analytics","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = direction_requests.dancer_id) AND (dp.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"direction_requests","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"dancers read own MyDancr TV analytics","qual":"((EXISTS ( SELECT 1\n   FROM (mydancr_tv_videos video\n     JOIN dancer_profiles dancer ON ((dancer.id = video.dancer_id)))\n  WHERE ((video.id = mydancr_tv_events.video_id) AND (dancer.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"mydancr_tv_events","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"venue owners read MyDancr TV analytics","qual":"((EXISTS ( SELECT 1\n   FROM (mydancr_tv_videos video\n     JOIN venues venue ON ((venue.id = video.venue_id)))\n  WHERE ((video.id = mydancr_tv_events.video_id) AND (venue.owner_user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"mydancr_tv_events","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"venue owners read tagged MyDancr TV videos","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = mydancr_tv_videos.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"mydancr_tv_videos","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Dancers read own NATS affiliate account","qual":"(EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = nats_affiliate_accounts.dancer_id) AND (dancer.user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"nats_affiliate_accounts","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Dancers read own NATS commission exports","qual":"(EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = nats_commission_exports.dancer_id) AND (dancer.user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"nats_commission_exports","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own NFC tags","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = nfc_tags.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"nfc_tags","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own NFC tap events","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = nfc_tap_events.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"nfc_tap_events","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"dancers read own analytics","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = profile_views.dancer_id) AND (dp.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"profile_views","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Dancers read own QR redemption events","qual":"(EXISTS ( SELECT 1\n   FROM (qr_redemptions redemption\n     JOIN dancer_profiles dancer ON ((dancer.id = redemption.dancer_id)))\n  WHERE ((redemption.id = qr_redemption_events.qr_redemption_id) AND (dancer.user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"qr_redemption_events","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own QR redemption events","qual":"(EXISTS ( SELECT 1\n   FROM (qr_redemptions redemption\n     JOIN venues venue ON ((venue.id = redemption.venue_id)))\n  WHERE ((redemption.id = qr_redemption_events.qr_redemption_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"qr_redemption_events","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Dancers view own attributed redemptions","qual":"(dancer_id IN ( SELECT dancer_profiles.id\n   FROM dancer_profiles\n  WHERE (dancer_profiles.user_id = auth.uid())))","roles":["public"],"schemaname":"public","tablename":"qr_redemptions","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own QR redemptions","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = qr_redemptions.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"qr_redemptions","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"dancers read own ranking events","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = ranking_events.dancer_id) AND (dp.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"ranking_events","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"dancers read own schedule analytics","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = schedule_views.dancer_id) AND (dp.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"schedule_views","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"dancers read own location events","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = shift_location_events.dancer_id) AND (dp.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"shift_location_events","with_check":null},{"cmd":"ALL","permissive":"PERMISSIVE","policyname":"approved dancers manage own shifts","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = shifts.dancer_id) AND (dp.user_id = auth.uid()) AND (dp.status = ''approved''::dancer_status)))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"shifts","with_check":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = shifts.dancer_id) AND (dp.user_id = auth.uid()) AND (dp.status = ''approved''::dancer_status)))) OR is_admin())"},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"posted approved shifts are public","qual":"(((status = ''posted''::shift_status) AND (EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = shifts.dancer_id) AND (dancer.status = ''approved''::dancer_status) AND (dancer.verification_status = ''approved''::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))) OR (EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = shifts.dancer_id) AND (dancer.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"shifts","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"dancers read own social analytics","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = social_clicks.dancer_id) AND (dp.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"social_clicks","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"approved social links are public","qual":"(((is_active = true) AND (EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = social_links.dancer_id) AND (dancer.status = ''approved''::dancer_status) AND (dancer.verification_status = ''approved''::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))) OR (EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = social_links.dancer_id) AND (dancer.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"social_links","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"dancers read own subscription","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dp\n  WHERE ((dp.id = subscriptions.dancer_id) AND (dp.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"subscriptions","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"approved rankings are public","qual":"((EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = trending_scores.dancer_id) AND (dancer.status = ''approved''::dancer_status) AND (dancer.verification_status = ''approved''::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL)))) OR (EXISTS ( SELECT 1\n   FROM dancer_profiles dancer\n  WHERE ((dancer.id = trending_scores.dancer_id) AND (dancer.user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"trending_scores","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue team reads own activity","qual":"((EXISTS ( SELECT 1\n   FROM venues v\n  WHERE ((v.id = venue_activity_log.venue_id) AND (v.owner_user_id = auth.uid())))) OR (EXISTS ( SELECT 1\n   FROM venue_team_members m\n  WHERE ((m.venue_id = venue_activity_log.venue_id) AND (m.user_id = auth.uid()) AND (m.status = ''active''::text)))))","roles":["public"],"schemaname":"public","tablename":"venue_activity_log","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue teams read own Club Deal requests","qual":"((EXISTS ( SELECT 1\n   FROM venues v\n  WHERE ((v.id = venue_club_deal_requests.venue_id) AND (v.owner_user_id = auth.uid())))) OR (EXISTS ( SELECT 1\n   FROM venue_team_members m\n  WHERE ((m.venue_id = venue_club_deal_requests.venue_id) AND (m.user_id = auth.uid()) AND (m.status = ''active''::text)))))","roles":["public"],"schemaname":"public","tablename":"venue_club_deal_requests","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue team reads own NFC support requests","qual":"((EXISTS ( SELECT 1\n   FROM venues v\n  WHERE ((v.id = venue_nfc_support_requests.venue_id) AND (v.owner_user_id = auth.uid())))) OR (EXISTS ( SELECT 1\n   FROM venue_team_members m\n  WHERE ((m.venue_id = venue_nfc_support_requests.venue_id) AND (m.user_id = auth.uid()) AND (m.status = ''active''::text)))))","roles":["public"],"schemaname":"public","tablename":"venue_nfc_support_requests","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"venue owners read venue analytics","qual":"((EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = venue_page_events.venue_id) AND (venue.owner_user_id = auth.uid())))) OR is_admin())","roles":["public"],"schemaname":"public","tablename":"venue_page_events","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own referral fee requests","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = venue_referral_fee_change_requests.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"venue_referral_fee_change_requests","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own referral fee terms","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = venue_referral_fee_terms.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"venue_referral_fee_terms","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue owners read own team invitations","qual":"(EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = venue_team_invitations.venue_id) AND (venue.owner_user_id = auth.uid()))))","roles":["public"],"schemaname":"public","tablename":"venue_team_invitations","with_check":null},{"cmd":"SELECT","permissive":"PERMISSIVE","policyname":"Venue users read own team membership","qual":"((user_id = auth.uid()) OR (EXISTS ( SELECT 1\n   FROM venues venue\n  WHERE ((venue.id = venue_team_members.venue_id) AND (venue.owner_user_id = auth.uid())))))","roles":["public"],"schemaname":"public","tablename":"venue_team_members","with_check":null}]'::jsonb)e(schemaname text,tablename text,policyname text,permissive text,roles text[],cmd text,qual text,with_check text)
   left join pg_policies p on p.schemaname=e.schemaname and p.tablename=e.tablename and p.policyname=e.policyname
   where p.policyname is null or row(p.permissive,p.roles::text[],p.cmd,p.qual,p.with_check)is distinct from row(e.permissive,e.roles,e.cmd,e.qual,e.with_check))then raise exception 'PUBLIC_OWNER_POLICY_DRIFT';end if;
end $guard$;
create function public.is_current_venue_owner(p_venue_id uuid)
returns boolean language sql stable security definer set search_path=''
as $function$
 select case when auth.uid() is null then false else exists(
   select 1 from public.venues v where v.id=p_venue_id and v.owner_user_id=auth.uid()
 )end;
$function$;
create function public.is_current_dancer_owner(p_dancer_id uuid)
returns boolean language sql stable security definer set search_path=''
as $function$
 select case when auth.uid() is null then false else exists(
   select 1 from public.dancer_profiles d where d.id=p_dancer_id and d.user_id=auth.uid()
 )end;
$function$;
revoke all on function public.is_current_venue_owner(uuid),public.is_current_dancer_owner(uuid) from public,anon,authenticated,service_role;
grant execute on function public.is_current_venue_owner(uuid),public.is_current_dancer_owner(uuid) to anon,authenticated,service_role;
alter policy "dancers read own reviews" on public."approval_reviews" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = approval_reviews.dancer_id) AND (public.is_current_dancer_owner(dp.id))))) OR is_admin()));
alter policy "Venue owners read own club deals" on public."club_deals" using((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = club_deals.venue_id) AND (public.is_current_venue_owner(v.id))))));
alter policy "Venue owners read own finance account" on public."club_finance_accounts" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = club_finance_accounts.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Venue owners read own invoice items" on public."club_invoice_items" using((EXISTS ( SELECT 1
   FROM (club_invoices invoice
     JOIN venues venue ON ((venue.id = invoice.venue_id)))
  WHERE ((invoice.id = club_invoice_items.invoice_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Venue owners read own invoice reminders" on public."club_invoice_reminders" using((EXISTS ( SELECT 1
   FROM (club_invoices invoice
     JOIN venues venue ON ((venue.id = invoice.venue_id)))
  WHERE ((invoice.id = club_invoice_reminders.invoice_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Venue owners read own invoices" on public."club_invoices" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = club_invoices.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Dancers read own earnings" on public."commission_events" using((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = commission_events.dancer_id) AND (public.is_current_dancer_owner(dancer.id))))));
alter policy "Dancers read own earning history" on public."dancer_earning_status_history" using((EXISTS ( SELECT 1
   FROM (commission_events earning
     JOIN dancer_profiles dancer ON ((dancer.id = earning.dancer_id)))
  WHERE ((earning.id = dancer_earning_status_history.earning_id) AND (public.is_current_dancer_owner(dancer.id))))));
alter policy "Venue owners read own dancer NFC enrollments" on public."dancer_nfc_enrollments" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = dancer_nfc_enrollments.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Dancers read own payout account" on public."dancer_payout_accounts" using((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = dancer_payout_accounts.dancer_id) AND (public.is_current_dancer_owner(dancer.id))))));
alter policy "Dancers read own payout batches" on public."dancer_payout_batches" using((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = dancer_payout_batches.dancer_id) AND (public.is_current_dancer_owner(dancer.id))))));
alter policy "Dancers read own payout items" on public."dancer_payout_items" using((EXISTS ( SELECT 1
   FROM (dancer_payout_batches batch
     JOIN dancer_profiles dancer ON ((dancer.id = batch.dancer_id)))
  WHERE ((batch.id = dancer_payout_items.payout_batch_id) AND (public.is_current_dancer_owner(dancer.id))))));
alter policy "approved photos are public" on public."dancer_photos" using((((review_status = 'approved'::review_status) AND (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = dancer_photos.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))) OR (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = dancer_photos.dancer_id) AND (public.is_current_dancer_owner(dancer.id))))) OR is_admin()));
alter policy "dancers read own direction analytics" on public."direction_requests" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = direction_requests.dancer_id) AND (public.is_current_dancer_owner(dp.id))))) OR is_admin()));
alter policy "dancers read own MyDancr TV analytics" on public."mydancr_tv_events" using(((EXISTS ( SELECT 1
   FROM (mydancr_tv_videos video
     JOIN dancer_profiles dancer ON ((dancer.id = video.dancer_id)))
  WHERE ((video.id = mydancr_tv_events.video_id) AND (public.is_current_dancer_owner(dancer.id))))) OR is_admin()));
alter policy "venue owners read MyDancr TV analytics" on public."mydancr_tv_events" using(((EXISTS ( SELECT 1
   FROM (mydancr_tv_videos video
     JOIN venues venue ON ((venue.id = video.venue_id)))
  WHERE ((video.id = mydancr_tv_events.video_id) AND (public.is_current_venue_owner(venue.id))))) OR is_admin()));
alter policy "venue owners read tagged MyDancr TV videos" on public."mydancr_tv_videos" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = mydancr_tv_videos.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Dancers read own NATS affiliate account" on public."nats_affiliate_accounts" using((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = nats_affiliate_accounts.dancer_id) AND (public.is_current_dancer_owner(dancer.id))))));
alter policy "Dancers read own NATS commission exports" on public."nats_commission_exports" using((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = nats_commission_exports.dancer_id) AND (public.is_current_dancer_owner(dancer.id))))));
alter policy "Venue owners read own NFC tags" on public."nfc_tags" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = nfc_tags.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Venue owners read own NFC tap events" on public."nfc_tap_events" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = nfc_tap_events.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "dancers read own analytics" on public."profile_views" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = profile_views.dancer_id) AND (public.is_current_dancer_owner(dp.id))))) OR is_admin()));
alter policy "Dancers read own QR redemption events" on public."qr_redemption_events" using((EXISTS ( SELECT 1
   FROM (qr_redemptions redemption
     JOIN dancer_profiles dancer ON ((dancer.id = redemption.dancer_id)))
  WHERE ((redemption.id = qr_redemption_events.qr_redemption_id) AND (public.is_current_dancer_owner(dancer.id))))));
alter policy "Venue owners read own QR redemption events" on public."qr_redemption_events" using((EXISTS ( SELECT 1
   FROM (qr_redemptions redemption
     JOIN venues venue ON ((venue.id = redemption.venue_id)))
  WHERE ((redemption.id = qr_redemption_events.qr_redemption_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Dancers view own attributed redemptions" on public."qr_redemptions" using((dancer_id IN ( SELECT dancer_profiles.id
   FROM dancer_profiles
  WHERE (public.is_current_dancer_owner(dancer_profiles.id)))));
alter policy "Venue owners read own QR redemptions" on public."qr_redemptions" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = qr_redemptions.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "dancers read own ranking events" on public."ranking_events" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = ranking_events.dancer_id) AND (public.is_current_dancer_owner(dp.id))))) OR is_admin()));
alter policy "dancers read own schedule analytics" on public."schedule_views" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = schedule_views.dancer_id) AND (public.is_current_dancer_owner(dp.id))))) OR is_admin()));
alter policy "dancers read own location events" on public."shift_location_events" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = shift_location_events.dancer_id) AND (public.is_current_dancer_owner(dp.id))))) OR is_admin()));
alter policy "approved dancers manage own shifts" on public."shifts" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = shifts.dancer_id) AND (public.is_current_dancer_owner(dp.id)) AND (dp.status = 'approved'::dancer_status)))) OR is_admin())) with check(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = shifts.dancer_id) AND (public.is_current_dancer_owner(dp.id)) AND (dp.status = 'approved'::dancer_status)))) OR is_admin()));
alter policy "posted approved shifts are public" on public."shifts" using((((status = 'posted'::shift_status) AND (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = shifts.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))) OR (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = shifts.dancer_id) AND (public.is_current_dancer_owner(dancer.id))))) OR is_admin()));
alter policy "dancers read own social analytics" on public."social_clicks" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = social_clicks.dancer_id) AND (public.is_current_dancer_owner(dp.id))))) OR is_admin()));
alter policy "approved social links are public" on public."social_links" using((((is_active = true) AND (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = social_links.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL))))) OR (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = social_links.dancer_id) AND (public.is_current_dancer_owner(dancer.id))))) OR is_admin()));
alter policy "dancers read own subscription" on public."subscriptions" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dp
  WHERE ((dp.id = subscriptions.dancer_id) AND (public.is_current_dancer_owner(dp.id))))) OR is_admin()));
alter policy "approved rankings are public" on public."trending_scores" using(((EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = trending_scores.dancer_id) AND (dancer.status = 'approved'::dancer_status) AND (dancer.verification_status = 'approved'::review_status) AND (dancer.venue_approved_at IS NOT NULL) AND (dancer.is_public = true) AND (dancer.disabled_at IS NULL)))) OR (EXISTS ( SELECT 1
   FROM dancer_profiles dancer
  WHERE ((dancer.id = trending_scores.dancer_id) AND (public.is_current_dancer_owner(dancer.id))))) OR is_admin()));
alter policy "Venue team reads own activity" on public."venue_activity_log" using(((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_activity_log.venue_id) AND (public.is_current_venue_owner(v.id))))) OR (EXISTS ( SELECT 1
   FROM venue_team_members m
  WHERE ((m.venue_id = venue_activity_log.venue_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));
alter policy "Venue teams read own Club Deal requests" on public."venue_club_deal_requests" using(((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_club_deal_requests.venue_id) AND (public.is_current_venue_owner(v.id))))) OR (EXISTS ( SELECT 1
   FROM venue_team_members m
  WHERE ((m.venue_id = venue_club_deal_requests.venue_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));
alter policy "Venue team reads own NFC support requests" on public."venue_nfc_support_requests" using(((EXISTS ( SELECT 1
   FROM venues v
  WHERE ((v.id = venue_nfc_support_requests.venue_id) AND (public.is_current_venue_owner(v.id))))) OR (EXISTS ( SELECT 1
   FROM venue_team_members m
  WHERE ((m.venue_id = venue_nfc_support_requests.venue_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));
alter policy "venue owners read venue analytics" on public."venue_page_events" using(((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_page_events.venue_id) AND (public.is_current_venue_owner(venue.id))))) OR is_admin()));
alter policy "Venue owners read own referral fee requests" on public."venue_referral_fee_change_requests" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_referral_fee_change_requests.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Venue owners read own referral fee terms" on public."venue_referral_fee_terms" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_referral_fee_terms.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Venue owners read own team invitations" on public."venue_team_invitations" using((EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_team_invitations.venue_id) AND (public.is_current_venue_owner(venue.id))))));
alter policy "Venue users read own team membership" on public."venue_team_members" using(((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM venues venue
  WHERE ((venue.id = venue_team_members.venue_id) AND (public.is_current_venue_owner(venue.id)))))));
revoke select(owner_user_id)on public.venues from public,anon,authenticated;
revoke select(user_id,created_at,updated_at,dmca_suspended_at,venue_approved_by_user_id,venue_approved_venue_id,identity_saved_at)on public.dancer_profiles from public,anon,authenticated;
do $guard$ begin
 if exists(select 1 from(values('venues','owner_user_id'),('dancer_profiles','user_id'),('dancer_profiles','created_at'),('dancer_profiles','updated_at'),('dancer_profiles','dmca_suspended_at'),('dancer_profiles','venue_approved_by_user_id'),('dancer_profiles','venue_approved_venue_id'),('dancer_profiles','identity_saved_at'))c(table_name,column_name)cross join unnest(array['anon','authenticated'])r where has_column_privilege(r,'public.'||c.table_name,c.column_name,'SELECT'))then raise exception 'PUBLIC_OWNER_COLUMN_ACCESS_REMAINS';end if;
 if exists(select 1 from pg_policies p where schemaname='public'and (coalesce(qual,'')||' '||coalesce(with_check,''))~'((v|venue)[.]owner_user_id|(dancer|dp|dancer_profiles)[.]user_id) = auth[.]uid')then raise exception 'PUBLIC_OWNER_QUALIFIED_DEPENDENCY_REMAINS';end if;
end $guard$;
commit;
