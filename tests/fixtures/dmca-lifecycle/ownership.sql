-- Private ownership records invalidate restoration after later independent decisions.
create table public.dmca_enforcement_states (
  target_type text not null check(target_type in('account','dancer_profile','tv_video')),
  target_id uuid not null,
  uploader_id uuid not null references public.app_users(id) on delete cascade,
  previous_state jsonb not null check(jsonb_typeof(previous_state)='object'),
  applied_state jsonb not null check(jsonb_typeof(applied_state)='object'),
  restore_allowed boolean not null default true,
  enforced_at timestamptz not null default now(),
  invalidated_at timestamptz,
  primary key(target_type,target_id),
  check(isfinite(enforced_at) and (invalidated_at is null or isfinite(invalidated_at)))
);
create index dmca_enforcement_states_uploader_idx on public.dmca_enforcement_states(uploader_id);
alter table public.dmca_enforcement_states enable row level security;
revoke all on table public.dmca_enforcement_states from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.dmca_enforcement_states to service_role;

create function public.invalidate_dmca_enforcement_state()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
  v_type text;
  v_id uuid;
begin
  if tg_level<>'ROW' or tg_when<>'AFTER' or tg_op not in('UPDATE','DELETE') then
    raise exception 'INVALID_DMCA_STATE_TRIGGER' using errcode='42501';
  end if;
  if tg_relid='public.app_users'::regclass then v_type:='account';
  elsif tg_relid='public.dancer_profiles'::regclass then v_type:='dancer_profile';
  elsif tg_relid='public.mydancr_tv_videos'::regclass then v_type:='tv_video';
  else raise exception 'INVALID_DMCA_STATE_SOURCE' using errcode='42501';
  end if;
  v_id:=old.id;
  if tg_op='DELETE' then
    delete from public.dmca_enforcement_states where target_type=v_type and target_id=v_id;
  else
    -- UPDATE OF attachments deliberately include a same-value decision. An
    -- unrelated caption, display-name or metadata edit does not claim status.
    update public.dmca_enforcement_states set restore_allowed=false,invalidated_at=pg_catalog.clock_timestamp()
      where target_type=v_type and target_id=v_id;
  end if;
  return null;
end;
$function$;
revoke all on function public.invalidate_dmca_enforcement_state() from public,anon,authenticated,service_role;

create trigger invalidate_dmca_account_enforcement
after update of role,account_state,dmca_suspended_at or delete on public.app_users
for each row execute function public.invalidate_dmca_enforcement_state();
create trigger invalidate_dmca_profile_enforcement
after update of user_id,status,disabled_at,admin_disabled_at,dmca_suspended_at,is_public,verification_status,photo_review_status,
approved_at,venue_approved_at,venue_approved_by_user_id,venue_approved_venue_id
or delete on public.dancer_profiles
for each row execute function public.invalidate_dmca_enforcement_state();
create trigger invalidate_dmca_video_enforcement
after update of submitted_by,dancer_id,status,published_at,review_notes,reviewed_by,reviewed_at,moderation_decision,distribution_scope
or delete on public.mydancr_tv_videos
for each row execute function public.invalidate_dmca_enforcement_state();
