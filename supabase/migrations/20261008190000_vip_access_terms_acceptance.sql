begin;

-- Snapshot the exact feature terms, notice and affirmative text shown at activation.
create table public.vip_access_terms_versions (
 version text primary key,
 terms_href text not null,
 title text not null,
 document_text text not null,
 notice_text text not null,
 consent_text text not null,
 privacy_href text not null
);
insert into public.vip_access_terms_versions values (
 '2026-10-08', '/terms/vip-table/2026-10-08', 'VIP & Table Access Terms',
 'These terms cover MyDancr’s private VIP access and club table rosters. You must be at least 18 and meet the club’s admission requirements. A link, account or roster listing does not verify age or guarantee admission.

Requests go to club staff and are subject to dancer availability and voluntary agreement. Sending a request does not confirm a booking. ‘Seen’ means staff acknowledged the request, not that a dancer agreed. A VIP confirmation comes from the club and remains subject to availability and the dancer’s agreement. Contact club staff about arrangements, prices or changes.

MyDancr provides communication tools; it does not operate the club, employ or book dancers, collect payment for dancer services, or guarantee admission, attendance or any service. Rosters and notifications may be delayed or inaccurate. Contact club staff directly for urgent matters.

Use links and accounts only as authorized by the club. Do not redistribute private links or roster content, scrape profiles, impersonate others, harass anyone or request unlawful services. The club or MyDancr may revoke access for misuse. All interactions must be lawful and consensual.

Club staff can see table requests, their table label and status. Other people using the same table link can see and cancel that table’s open requests. VIP requests and the name you provide are available to the club’s owners and managers. Do not include sensitive personal information in request notes.

The Privacy Policy explains MyDancr’s handling of personal information. VIP activation records the account, invitation, club, accepted terms version and server time. Opening a table roster or its terms box is not recorded as checkbox acceptance. Access and requests do not subscribe you to marketing or opt you into a club customer list; those choices are separate.

Nothing in these terms limits rights or responsibilities that applicable law does not allow to be limited. For questions, contact support@mydancr.com.',
 'Your club’s owners and managers can see your name and VIP requests. Requests are subject to dancer availability and agreement; sending one does not confirm a booking. MyDancr records your acceptance, including the terms version and time. This does not sign you up for marketing.', 'I’m 18 or older and agree to the VIP & Table Access Terms.', '/privacy'
);
create table public.vip_access_acceptances (
 invitation_id uuid not null references public.venue_vip_invitations(id) on delete cascade,
 version text not null references public.vip_access_terms_versions(version),
 user_id uuid not null references auth.users(id) on delete cascade,
 venue_id uuid not null references public.venues(id) on delete cascade,
 accepted_at timestamptz not null default clock_timestamp(),
 acceptance_source text not null default 'vip_activation_checkbox' check (acceptance_source='vip_activation_checkbox'),
 primary key (invitation_id, version)
);
create index vip_access_acceptances_user on public.vip_access_acceptances(user_id);
alter table public.vip_access_terms_versions enable row level security;
alter table public.vip_access_acceptances enable row level security;
revoke all on public.vip_access_terms_versions, public.vip_access_acceptances from public, anon, authenticated, service_role;
grant select on public.vip_access_terms_versions, public.vip_access_acceptances to service_role;

-- Membership and evidence commit together; retries preserve the original receipt.
-- Keep the existing service-only helper available during the rolling deployment.
-- The public activation API exclusively uses this consent-enforcing RPC.
create function public.vip_accept_invitation_with_terms(p_actor uuid,p_digest text,p_name text,p_version text,p_accepted boolean) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_venue uuid; v_invitation uuid;
begin
 if p_accepted is distinct from true or p_version is distinct from '2026-10-08' then
   raise exception 'VIP_TERMS_REQUIRED' using errcode='22023';
 end if;
 v_venue := public.vip_accept_invitation(p_actor,p_digest,p_name);
 select id into strict v_invitation from public.venue_vip_invitations
 where token_digest=p_digest and accepted_by=p_actor and venue_id=v_venue;
 insert into public.vip_access_acceptances(invitation_id,version,user_id,venue_id)
 values(v_invitation,p_version,p_actor,v_venue)
 on conflict(invitation_id,version) do nothing;
 return v_venue;
end;
$$;
revoke all on function public.vip_accept_invitation_with_terms(uuid,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.vip_accept_invitation_with_terms(uuid,text,text,text,boolean) to service_role;
notify pgrst,'reload schema';
commit;
