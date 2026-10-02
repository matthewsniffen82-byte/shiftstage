export const DEMO_MARKER = 'mydancr-echo-grid-v1';
export const ECHO_ID = '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af';
export const DEMO_GRIDS = Object.freeze([
  { key: 'echo', venueId: ECHO_ID, name: 'Echo House', target: 100, marker: DEMO_MARKER },
  { key: 'afterglow', venueId: 'fa4c3d2a-5de9-4ae5-80ba-35528c555521', name: 'Afterglow Social', target: 80, marker: 'mydancr-afterglow-grid-v1' },
  { key: 'aurora', venueId: '79162674-294a-4c38-be6e-16eec3c42d99', name: 'Aurora Room', target: 75, marker: 'mydancr-aurora-grid-v1' },
  { key: 'blue-ember', venueId: 'c2a9f8d6-a543-4ac0-9cc6-df8431440e2b', name: 'Blue Ember', target: 85, marker: 'mydancr-blue-ember-grid-v1' },
].map(Object.freeze));
export const SOURCE_SLUGS = Object.freeze([
  ...Array.from({ length: 10 }, (_, i) => `layout-review-${String(i + 1).padStart(2, '0')}`),
  'lvdegen11', 'lala', 'stacy', 'ty',
]);
export const DEMO_NAMES = Object.freeze(('Aria Aurora Autumn Ava Bailey Bianca Blair Brooke Camille Carmen Cassidy Celeste Chanel Chloe Cleo Coco Coral Dakota Dallas Dani Darcy Delilah Demi Destiny Diamond Eden Elena Elise Ember Emery Esme Eva Faye Felicity Fiona Frankie Freya Gia Giselle Goldie Grace Hailey Harlow Harper Hazel Heidi Holly Hope Indigo Isla Jade Jasmine Jewel Josie Juliet Kendra Kiana Kira Lana Layla Leah Lexi Lilith Lola London Lucia Lux Lyra Macy Maeve Maya Mia Mila Monroe Morgan Naomi Natalia Nia Noelle Nyla Opal Paige Paris Pearl Phoenix Piper Poppy Raven Reese Remi Rhea Riley River Rose Ruby Sage Scarlett Selena Serena Sierra Skye Sloan Stella Summer Talia Tara Tessa Valentina Vera Victoria Violet Willow Zara Zoe').split(' '));

export function gridPhoto(profile) {
  const photos = (profile.dancer_photos || []).filter(p => p.review_status === 'approved');
  return photos.sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned))
    || Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))
    || Number(a.sort_order || 0) - Number(b.sort_order || 0)
    || a.id.localeCompare(b.id))[0];
}

// Preserve the existing responsive manifest and every delivery size verbatim.
export function photoStoragePaths(master) {
  if (!master || master.includes('..') || master.startsWith('/') || master.includes('\\')) throw new Error('Invalid photo path');
  const match = master.match(/\.r(0|[1-9]\d*(?:-[1-9]\d*)*)\.m[1-9]\d*x[1-9]\d*(?:\.f\d{1,3}x\d{1,3})?\.[a-z0-9]+$/i);
  return [master, ...(match && match[1] !== '0' ? match[1].split('-').map(width => `${master}.w${width}.webp`) : [])];
}

export const sqlText = value => "'" + String(value).replaceAll("'", "''") + "'";

export function demoRosterSql(grid) {
  if (grid.key === 'echo') return `select id from public.internal_roster_members('${grid.venueId}')`;
  return `select distinct d.id from public.dancer_profiles d join public.shifts s on s.dancer_id=d.id
    where s.venue_id='${grid.venueId}' and d.status='approved' and d.verification_status='approved'
      and d.is_public and d.disabled_at is null and s.status='posted' and s.checked_in_at is not null
      and s.checked_out_at is null and s.location_status='club_confirmed'
      and s.location_verification_expires_at>now() and s.location_verification_expires_at<'infinity'`;
}

export function publishSql(plan) {
  const grid = DEMO_GRIDS.find(g => g.venueId === plan.venueId);
  if (!grid || plan.target !== grid.target || plan.baseIds.length + plan.profiles.length !== grid.target) throw new Error('Unexpected venue or demo roster total');
  if (plan.profiles.length < 1 || plan.profiles.length > grid.target || new Set(plan.profiles.map(p => p.dancer_id)).size !== plan.profiles.length
    || new Set(plan.baseIds).size !== plan.baseIds.length || plan.profiles.some(p => plan.baseIds.includes(p.dancer_id))) throw new Error('Invalid demo plan');
  const marker = grid.marker, venueId = grid.venueId;
  const roster = demoRosterSql(grid);
  return `-- Reviewed, repeat-safe publication of prepared login-disabled demo accounts.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtext('${marker}'));
create temp table echo_demo_plan on commit drop as
select * from jsonb_to_recordset(${sqlText(JSON.stringify(plan.profiles))}::jsonb)
as p(user_id uuid,dancer_id uuid,slug text,name text,storage_path text,photo_id uuid,shift_id uuid,source_photo_id uuid);
create temp table echo_demo_base on commit drop as select jsonb_array_elements_text(${sqlText(JSON.stringify(plan.baseIds))}::jsonb)::uuid id;
do $$ begin
  if not exists(select 1 from public.dancer_age_verification_settings where singleton and enabled=false) then raise exception 'Real age enforcement is active'; end if;
  if not exists(select 1 from public.venues v left join public.app_users a on a.id=v.owner_user_id where v.id='${venueId}' and v.name=${sqlText(grid.name)} and v.is_active
    and ((v.owner_user_id is null and '${grid.key}'<>'echo') or (a.role='venue' and a.account_state='active'))) then raise exception 'Expected active demo venue'; end if;
  if exists(select id from (${roster}) current_roster where id not in(select dancer_id from echo_demo_plan) except select id from echo_demo_base)
    or exists(select id from echo_demo_base except ${roster}) then raise exception 'Original roster changed; inspect again'; end if;
  if (select count(*) from echo_demo_plan p join public.dancer_profiles d on d.id=p.dancer_id and d.user_id=p.user_id join auth.users u on u.id=p.user_id join public.app_users a on a.id=p.user_id
      where u.email=p.slug||'@synthetic.mydancr.invalid' and u.raw_user_meta_data->>'dataset_marker'='${marker}' and u.banned_until>now()
      and p.slug ~ '^${grid.key}-grid-(0[0-9][1-9]|0[1-9]0|100)$' and a.role='dancer' and a.account_state='active' and d.disabled_at is null
      and p.storage_path like p.user_id::text||'/'||p.dancer_id::text||'/${marker}/%') <> ${plan.profiles.length} then raise exception 'Unsafe demo account or photo path'; end if;
  if exists(select 1 from echo_demo_plan p left join public.dancer_photos s on s.id=p.source_photo_id and s.review_status='approved' where s.id is null) then raise exception 'Source photo approval changed'; end if;
  if exists(select 1 from public.dancer_photos p join echo_demo_plan d on d.dancer_id=p.dancer_id where p.id<>d.photo_id or p.storage_path<>d.storage_path)
    or exists(select 1 from public.mydancr_tv_videos v join echo_demo_plan d on d.dancer_id=v.dancer_id) then raise exception 'Unexpected media on demo account'; end if;
  if exists(select 1 from public.venue_dancer_affiliations a join echo_demo_plan p on p.dancer_id=a.dancer_id where a.venue_id<>'${venueId}' or a.status<>'active' or a.revoked_at is not null or a.reentry_blocked) then raise exception 'Refusing to change an existing affiliation'; end if;
end $$;
update public.dancer_profiles d set slug=p.slug,stage_name=p.name,real_name=p.name,city='Las Vegas',status='approved',verification_status='approved',photo_review_status='approved',is_public=true,approved_at=coalesce(d.approved_at,now()),venue_approved_at=coalesce(d.venue_approved_at,now()),avatar_storage_path=p.storage_path,updated_at=now()
from echo_demo_plan p where d.id=p.dancer_id;
insert into public.dancer_photos(id,dancer_id,storage_path,is_primary,sort_order,review_status,alt_text)
select photo_id,dancer_id,storage_path,true,0,'approved',name||' · fictional demo profile' from echo_demo_plan on conflict(id) do nothing;
insert into public.dancer_internal_main_photos(dancer_id,photo_id) select dancer_id,photo_id from echo_demo_plan on conflict(dancer_id) do nothing;
insert into public.venue_dancer_affiliations(venue_id,dancer_id) select '${venueId}',dancer_id from echo_demo_plan on conflict(venue_id,dancer_id) do nothing;
insert into public.dancer_channel_preferences(dancer_id,visibility) select dancer_id,'both' from echo_demo_plan on conflict(dancer_id) do nothing;
insert into public.shifts(id,dancer_id,venue_id,venue_affiliation_id,starts_at,ends_at,timezone,status,shift_date,shift_source,checked_in_at,location_status,last_location_verified_at,location_verification_expires_at,working_status,shift_summary)
select p.shift_id,p.dancer_id,'${venueId}',a.id,now(),'2099-12-31 23:59:59+00','America/Los_Angeles','posted',(now() at time zone 'America/Los_Angeles')::date,'demo_locked',now(),'club_confirmed',now(),'2099-12-31 23:59:59+00','club_confirmed',jsonb_build_object('demoLocked',true,'internalDemoRoster',true,'managedBy','${marker}')
from echo_demo_plan p join public.venue_dancer_affiliations a on a.dancer_id=p.dancer_id and a.venue_id='${venueId}' on conflict(id) do nothing;
insert into public.dancer_shift_channels(shift_id,dancer_id,venue_id,visibility) select shift_id,dancer_id,'${venueId}','both' from echo_demo_plan on conflict(shift_id) do nothing;
do $$ begin
  if (select count(*) from (${roster}) current_roster)<>${grid.target} then raise exception 'Unexpected demo roster total; rolling back'; end if;
  if exists(select 1 from public.venues where id='${venueId}' and owner_user_id is not null)
    and (select count(*) from public.venue_roster_members('${venueId}') where internal_visible and external_visible and working_until>now())<>${grid.target} then raise exception 'Staff roster does not match'; end if;
  if (select count(*) from public.dancer_photos p join echo_demo_plan d on d.dancer_id=p.dancer_id)<>${plan.profiles.length} then raise exception 'Expected one photo per added profile'; end if;
end $$;
select ${sqlText(grid.name)} as venue, count(*) as demo_profiles from (${roster}) current_roster;
commit;
`;
}
