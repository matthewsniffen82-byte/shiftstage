# Step 1 API surface inventory

Source: bb14ecd162af1594c1b031d8aeb38442bbe114d6. This lists direct guard calls found in each route, not a proof of complete authorization. Some routes delegate to guarded services or return a retired-feature response. Cron routes use authorizeCronRequest and Stripe uses signature verification. Review the service implementation and each HTTP method before changing a boundary.

| Route | Methods | Direct guard/validation calls |
| --- | --- | --- |
| app/api/account-recovery/route.ts | POST | enforceAccountRecoveryRateLimit |
| app/api/account/route.ts | GET, PATCH, DELETE | createRequestSupabaseContext |
| app/api/admin/approvals/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/avatars/recenter/route.ts | POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/dancers/[id]/photos/[photoId]/route.ts | DELETE | createRequestSupabaseContext, requireAdmin |
| app/api/admin/dancers/[id]/route.ts | GET, PATCH, DELETE | createRequestSupabaseContext, requireAdmin |
| app/api/admin/dancers/[id]/social-links/[socialId]/route.ts | DELETE | createRequestSupabaseContext, requireAdmin |
| app/api/admin/dancers/route.ts | GET | createRequestSupabaseContext, requireAdmin |
| app/api/admin/deals/route.ts | GET, POST, PATCH | createRequestSupabaseContext, requireAdmin |
| app/api/admin/dmca/route.ts | GET, PATCH | createRequestSupabaseContext, requireAdmin |
| app/api/admin/finance/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/image-moderation/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/monitoring/route.ts | GET | createRequestSupabaseContext, requireAdmin |
| app/api/admin/nfc-tags/route.ts | GET, POST, PATCH | createRequestSupabaseContext, requireAdmin |
| app/api/admin/operations/route.ts | GET | createRequestSupabaseContext, requireAdmin |
| app/api/admin/pilot-analytics/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin, requiredUuid, requiredText |
| app/api/admin/rankings/recalculate/route.ts | POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/referral-fees/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/reports/route.ts | GET, PATCH | createRequestSupabaseContext, requireAdmin |
| app/api/admin/sales-agents/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin, required |
| app/api/admin/subscriptions/route.ts | GET | createRequestSupabaseContext, requireAdmin |
| app/api/admin/support/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/tv/import/route.ts | POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/tv/videos/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/venue-claim-codes/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/venue-claims/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/venue-signup-requests/route.ts | GET, POST | createRequestSupabaseContext, requireAdmin |
| app/api/admin/venues/media/route.ts | POST, DELETE | createRequestSupabaseContext, requireAdmin |
| app/api/admin/venues/preview/route.ts | GET | createRequestSupabaseContext, requireAdmin |
| app/api/admin/venues/route.ts | GET, POST, PATCH | createRequestSupabaseContext, requireAdmin |
| app/api/agent/commissions/route.ts | GET, POST | createRequestSupabaseContext |
| app/api/auth/route.ts | PUT, DELETE, POST | createRequestSupabaseContext, enforceAccountRecoveryRateLimit, enforceAuthAttemptRateLimit, enforcePublicRequestRateLimit |
| app/api/cron/dmca-restoration/route.ts | GET | See delegated service / public or retired route |
| app/api/cron/finance/route.ts | GET | See delegated service / public or retired route |
| app/api/cron/image-moderation/route.ts | GET | See delegated service / public or retired route |
| app/api/cron/shift-checkins/route.ts | GET | See delegated service / public or retired route |
| app/api/cron/video-moderation/route.ts | GET | See delegated service / public or retired route |
| app/api/customer/deal-saves/route.ts | GET, POST | createRequestSupabaseContext, requireActiveCustomer, enforcePublicRequestRateLimit, requirePublicClubDeal, requirePublicDancer |
| app/api/customer/directions/route.ts | POST | createRequestSupabaseContext, requirePublicDancersAtVenue |
| app/api/customer/favorites/route.ts | POST | createRequestSupabaseContext, enforcePublicRequestRateLimit, requirePublicDancer |
| app/api/customer/follows/route.ts | POST | createRequestSupabaseContext, enforcePublicRequestRateLimit, requirePublicDancer |
| app/api/customer/going/route.ts | GET, POST | requirePublicShift, enforcePublicRequestRateLimit, createRequestSupabaseContext |
| app/api/customer/profile/route.ts | GET, PATCH | createRequestSupabaseContext |
| app/api/customer/saved/route.ts | GET | createRequestSupabaseContext |
| app/api/customer/venue-follows/route.ts | POST | createRequestSupabaseContext, enforcePublicRequestRateLimit, requirePublicVenue |
| app/api/dancer/analytics/route.ts | GET | createRequestSupabaseContext |
| app/api/dancer/avatar/route.ts | POST, DELETE | createRequestSupabaseContext, enforceDancerMediaRequestRateLimit |
| app/api/dancer/billing/checkout/route.ts | POST | createRequestSupabaseContext |
| app/api/dancer/billing/portal/route.ts | POST | createRequestSupabaseContext |
| app/api/dancer/billing/route.ts | GET | createRequestSupabaseContext |
| app/api/dancer/dashboard/route.ts | GET | createRequestSupabaseContext |
| app/api/dancer/finance/route.ts | GET, POST | createRequestSupabaseContext, requireActiveDancer |
| app/api/dancer/finance/statement/route.ts | GET | createRequestSupabaseContext |
| app/api/dancer/media/pin/route.ts | PATCH | createRequestSupabaseContext |
| app/api/dancer/photos/preview/route.ts | POST | createRequestSupabaseContext, enforcePublicRequestRateLimit |
| app/api/dancer/photos/route.ts | POST, DELETE | createRequestSupabaseContext, enforceDancerMediaRequestRateLimit |
| app/api/dancer/profile/route.ts | GET, PATCH | createRequestSupabaseContext, requireDancerSignupCity |
| app/api/dancer/profile/visibility/route.ts | PATCH | createRequestSupabaseContext |
| app/api/dancer/ranking-events/route.ts | GET | createRequestSupabaseContext |
| app/api/dancer/reviews/route.ts | GET | createRequestSupabaseContext |
| app/api/dancer/shifts/check-in/route.ts | POST, PATCH, DELETE | createRequestSupabaseContext |
| app/api/dancer/shifts/route.ts | GET, POST, PATCH | createRequestSupabaseContext |
| app/api/dancer/tv/videos/[id]/route.ts | PATCH, DELETE | createRequestSupabaseContext, enforceDancerMediaRequestRateLimit |
| app/api/dancer/tv/videos/route.ts | GET, POST | createRequestSupabaseContext, enforceDancerMediaRequestRateLimit |
| app/api/dancer/venue-verification/route.ts | GET, POST, DELETE | createRequestSupabaseContext |
| app/api/dancer/verification-documents/route.ts | GET, POST | createRequestSupabaseContext |
| app/api/dancer/weekly-report/route.ts | GET | createRequestSupabaseContext |
| app/api/deals/redeem/[token]/route.ts | GET, POST | See delegated service / public or retired route |
| app/api/deals/redemptions/[token]/events/route.ts | POST | enforceEventRateLimit, createRequestSupabaseContext |
| app/api/deals/redemptions/route.ts | POST | See delegated service / public or retired route |
| app/api/dmca/cases/[id]/route.ts | GET, POST | createRequestSupabaseContext |
| app/api/dmca/notices/route.ts | GET, POST | See delegated service / public or retired route |
| app/api/events/route.ts | POST | enforcePublicRequestRateLimit, requirePublicShiftForDancer, requirePublicDancersAtVenue |
| app/api/health/route.ts | GET | See delegated service / public or retired route |
| app/api/health/supabase/route.ts | GET | See delegated service / public or retired route |
| app/api/nfc/[token]/route.ts | GET, POST | enforcePublicRequestRateLimit, createRequestSupabaseContext |
| app/api/notifications/route.ts | GET, PATCH, DELETE | createRequestSupabaseContext, enforceNotificationMutationRateLimit, enforcePublicRequestRateLimit |
| app/api/public/cities/route.ts | GET | See delegated service / public or retired route |
| app/api/public/dancers/[slug]/route.ts | GET | See delegated service / public or retired route |
| app/api/public/dancers/route.ts | GET | See delegated service / public or retired route |
| app/api/public/discovery/route.ts | GET | See delegated service / public or retired route |
| app/api/public/engagement-shares/route.ts | POST | enforcePublicRequestRateLimit |
| app/api/public/maps/embed/route.ts | GET | See delegated service / public or retired route |
| app/api/public/media-likes/route.ts | GET, POST | enforcePublicRequestRateLimit |
| app/api/public/share-qr/route.ts | GET | See delegated service / public or retired route |
| app/api/public/tv/[id]/events/route.ts | POST | enforcePublicRequestRateLimit |
| app/api/public/tv/count/route.ts | GET | See delegated service / public or retired route |
| app/api/public/tv/route.ts | GET | createRequestSupabaseContext |
| app/api/public/venue-events/route.ts | POST | enforcePublicRequestRateLimit, requirePublicDancersAtVenue |
| app/api/public/venues/[slug]/route.ts | GET | See delegated service / public or retired route |
| app/api/public/venues/route.ts | GET | See delegated service / public or retired route |
| app/api/reports/route.ts | POST | enforcePublicRequestRateLimit, requireReportableDancer, requireReportableVenue |
| app/api/stripe/webhook/route.ts | POST | See delegated service / public or retired route |
| app/api/support/route.ts | GET, POST | createRequestSupabaseContext |
| app/api/venue/access-code/preview/route.ts | POST | enforceAccountRecoveryRateLimit |
| app/api/venue/claims/route.ts | GET, POST | See delegated service / public or retired route |
| app/api/venue/cover-image/route.ts | POST, DELETE | createRequestSupabaseContext, requireActiveVenueAccount, requireVenueAccess |
| app/api/venue/dancer-verifications/route.ts | GET, POST, DELETE | createRequestSupabaseContext, requireActiveVenueAccount, requireVenueAccess |
| app/api/venue/dashboard/route.ts | GET | createRequestSupabaseContext, requireActiveVenueAccount, requireVenueAccess |
| app/api/venue/deal-requests/route.ts | GET, POST | createRequestSupabaseContext, requireVenueAccess |
| app/api/venue/deal/qr/route.ts | GET, POST | See delegated service / public or retired route |
| app/api/venue/deal/route.ts | GET, PATCH, DELETE | createRequestSupabaseContext, requireActiveVenueAccount |
| app/api/venue/finance/route.ts | GET | createRequestSupabaseContext, requireActiveVenueAccount |
| app/api/venue/finance/statement/route.ts | GET | createRequestSupabaseContext, requireActiveVenueAccount |
| app/api/venue/logo-image/route.ts | POST, DELETE | createRequestSupabaseContext, requireActiveVenueAccount, requireVenueAccess |
| app/api/venue/nfc-support/route.ts | GET, POST | createRequestSupabaseContext, requireVenueAccess |
| app/api/venue/nfc-tags/route.ts | GET, POST, PATCH | createRequestSupabaseContext, requireActiveVenueAccount |
| app/api/venue/profile/route.ts | GET, PATCH | createRequestSupabaseContext, requireActiveVenueAccount, requireVenueAccess |
| app/api/venue/publication/route.ts | POST | createRequestSupabaseContext, requireActiveVenueAccount, requireVenueAccess |
| app/api/venue/qr-code/route.ts | POST, DELETE | See delegated service / public or retired route |
| app/api/venue/referral-fee/route.ts | GET, POST | createRequestSupabaseContext |
| app/api/venue/signup-requests/confirmation/route.ts | POST | enforcePublicRequestRateLimit |
| app/api/venue/signup-requests/route.ts | GET, POST | createRequestSupabaseContext, requireActiveVenueAccount, enforcePublicRequestRateLimit |
| app/api/venue/team/invitations/route.ts | GET, POST | createRequestSupabaseContext, requireActiveVenueAccount |
| app/api/venue/team/route.ts | GET, POST, PATCH, DELETE | createRequestSupabaseContext |
| app/api/venue/tv/videos/route.ts | GET | createRequestSupabaseContext, requireActiveVenueAccount |
