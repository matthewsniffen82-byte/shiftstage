set local lock_timeout = '5s';

insert into public.vip_access_terms_versions
  (version, terms_href, title, document_text, notice_text, consent_text, privacy_href)
select '2026-11-11', '/terms/vip-table/2026-11-11', title,
  replace(replace(replace(document_text,
    'Last updated: October 30, 2026', 'Last updated: November 11, 2026'),
    'Before submitting, changing, or canceling a table request,', 'Before sending a table request,'),
    'You can accept without creating an account.',
    'To cancel an open request, confirm the cancellation for the named dancer. You can accept without creating an account.'),
  notice_text, consent_text, privacy_href
from public.vip_access_terms_versions where version = '2026-10-30';

-- Keep accepting receipts from the previous deployment during rollout. The API
-- validates the versions actually displayed. Existing VIPs retain their access.
do $migration$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('public.record_request_terms_acceptance(uuid,text,text,text,text,text,boolean)',
     $old$p_access_version is distinct from '2026-10-30'$old$,
     $new$(p_access_version is null or p_access_version not in ('2026-10-30','2026-11-11') or (p_action = 'cancel' and p_access_version = '2026-11-11'))$new$),
    ('public.vip_accept_invitation_with_user_terms(uuid,text,text,text,boolean,text,boolean)',
     $old$p_version is distinct from '2026-10-30'$old$,
     $new$(p_version is null or p_version not in ('2026-10-30','2026-11-11'))$new$),
    ('public.accept_current_account_terms(uuid,text,text,boolean)',
     $old$p_access_version<>'2026-10-30'$old$,
     $new$p_access_version not in ('2026-10-30','2026-11-11')$new$),
    ('public.account_terms_access(uuid,boolean)',
     $old$access_terms_version='2026-10-30'$old$,
     $new$access_terms_version in ('2026-10-30','2026-11-11')$new$),
    ('public.account_terms_access(uuid,boolean)',
     $old$from public.vip_access_acceptances where user_id=p_user and version='2026-10-30'$old$,
     $new$from public.vip_access_acceptances where user_id=p_user and version in ('2026-10-30','2026-11-11')$new$)
  ) as changes(signature, original, revised)
  loop
    definition := pg_get_functiondef(change.signature::regprocedure);
    if strpos(definition, change.original) = 0 then
      raise exception 'Missing access terms check in %', change.signature;
    end if;
    execute replace(definition, change.original, change.revised);
  end loop;
end $migration$;
