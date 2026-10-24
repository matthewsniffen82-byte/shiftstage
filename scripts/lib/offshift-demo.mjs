import { sqlText } from './echo-demo-grid.mjs';

export const OFFSHIFT_MARKER = 'mydancr-offshift-demo-20261024';
export const OFFSHIFT_NAMES = Object.freeze(['Aria', 'Aurora', 'Autumn', 'Ava', 'Bailey', 'Bianca', 'Blair', 'Brooke', 'Camille']);
export const offshiftSlug = index => `offshift-demo-${String(index + 1).padStart(2, '0')}`;

export function offshiftPublicationSql(plan) {
  if (plan.marker !== OFFSHIFT_MARKER || plan.profiles?.length !== 9) throw new Error('Expected exactly nine marked demo profiles');
  const ids = new Set();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const [index, profile] of plan.profiles.entries()) {
    if (profile.slug !== offshiftSlug(index) || profile.name !== OFFSHIFT_NAMES[index] || profile.photos?.length !== 3) throw new Error('Unexpected demo identity or photo count');
    for (const id of [profile.user_id, profile.dancer_id, ...profile.photos.map(photo => photo.id)]) {
      if (!uuid.test(id) || ids.has(id)) throw new Error('Invalid or duplicate prepared ID');
      ids.add(id);
    }
    for (const photo of profile.photos) {
      if (!uuid.test(photo.source_id) || !photo.source_path || !photo.storage_path.startsWith(`${profile.user_id}/${profile.dancer_id}/${OFFSHIFT_MARKER}/`)
        || photo.storage_path.includes('..') || photo.storage_path.includes('\\')) throw new Error('Unexpected photo provenance');
    }
  }
  return `-- Operator-run data only. Adds nine login-disabled off-shift demos; no check-ins or club affiliations.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $publish$
declare
  plan jsonb := ${sqlText(JSON.stringify(plan.profiles))}::jsonb;
  p jsonb; photo jsonb; photo_order integer; existing_shifts text;
begin
  perform pg_advisory_xact_lock(hashtext('${OFFSHIFT_MARKER}'));
  if not exists(select 1 from public.dancer_age_verification_settings where singleton and enabled=false)
    then raise exception 'Demo setup is unavailable while age enforcement is active'; end if;
  select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'')) into existing_shifts from public.shifts s;
  for p in select value from jsonb_array_elements(plan) loop
    if not exists(select 1 from public.dancer_profiles d join public.app_users a on a.id=d.user_id join auth.users u on u.id=d.user_id
      where d.id=(p->>'dancer_id')::uuid and d.user_id=(p->>'user_id')::uuid and d.disabled_at is null
        and d.status in ('draft','approved') and a.role='dancer' and a.account_state='active'
        and u.email=p->>'slug'||'@synthetic.mydancr.invalid' and u.banned_until>now()
        and u.raw_app_meta_data->>'dataset_marker'='${OFFSHIFT_MARKER}')
      then raise exception 'Refusing to publish an unmarked or login-enabled account'; end if;
    if exists(select 1 from public.shifts where dancer_id=(p->>'dancer_id')::uuid)
      or exists(select 1 from public.venue_dancer_affiliations where dancer_id=(p->>'dancer_id')::uuid)
      or exists(select 1 from public.mydancr_tv_videos where dancer_id=(p->>'dancer_id')::uuid)
      then raise exception 'Off-shift demo already has unrelated activity'; end if;
    if exists(select 1 from public.dancer_photos current_photo where dancer_id=(p->>'dancer_id')::uuid
      and not exists(select 1 from jsonb_array_elements(p->'photos') item
        where current_photo.id=(item->>'id')::uuid and current_photo.storage_path=item->>'storage_path'))
      then raise exception 'Unexpected existing demo media'; end if;
    photo_order:=0;
    for photo in select value from jsonb_array_elements(p->'photos') loop
      if not exists(select 1 from public.dancer_photos source join public.dancer_profiles d on d.id=source.dancer_id
        where source.id=(photo->>'source_id')::uuid and source.storage_path=photo->>'source_path'
          and source.review_status='approved' and d.slug='lvdegen11' and d.is_public and d.status='approved' and d.disabled_at is null)
        then raise exception 'Approved demo source changed'; end if;
      insert into public.dancer_photos(id,dancer_id,storage_path,is_primary,sort_order,review_status,alt_text)
        values((photo->>'id')::uuid,(p->>'dancer_id')::uuid,photo->>'storage_path',photo_order=0,photo_order,'approved',
          (p->>'name')||' · fictional demo profile') on conflict(id) do nothing;
      photo_order:=photo_order+1;
    end loop;
    update public.dancer_profiles set slug=p->>'slug',stage_name=p->>'name',real_name='Fictional demo',city='Las Vegas',
      status='approved',verification_status='approved',photo_review_status='approved',is_public=true,
      approved_at=coalesce(approved_at,now()),avatar_storage_path=p->'photos'->0->>'storage_path',updated_at=now()
      where id=(p->>'dancer_id')::uuid;
    insert into public.dancer_channel_preferences(dancer_id,visibility)
      values((p->>'dancer_id')::uuid,'external') on conflict(dancer_id) do nothing;
  end loop;
  if (select count(*) from public.dancer_profiles d join auth.users u on u.id=d.user_id
    where u.raw_app_meta_data->>'dataset_marker'='${OFFSHIFT_MARKER}' and d.is_public
      and d.status='approved' and d.verification_status='approved' and d.disabled_at is null)<>9
    then raise exception 'Expected nine public off-shift profiles'; end if;
  if existing_shifts is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id)::text,'')) from public.shifts s)
    then raise exception 'Existing shifts changed'; end if;
end $publish$;
commit;
`;
}
