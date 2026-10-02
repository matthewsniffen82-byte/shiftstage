// Only prepares unpublished, login-disabled fixtures. Review/rehearse the output SQL before publishing.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { DEMO_MARKER, ECHO_ID, SOURCE_SLUGS, DEMO_NAMES, gridPhoto, photoStoragePaths, publishSql } from './lib/echo-demo-grid.mjs';

nextEnv.loadEnvConfig(process.env.DANCR_ENV_DIR || process.cwd());
const args = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
if (!['inspect','prepare'].includes(args.get('mode'))) throw new Error('Use --mode=inspect or --mode=prepare');
if (args.get('target') !== 'production') throw new Error('Specify --target=production');
if (args.get('mode') === 'prepare' && args.get('confirm') !== DEMO_MARKER) throw new Error(`Use --confirm=${DEMO_MARKER} for preparation`);
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'hfmzwadzabmgxkjzmqun.supabase.co') throw new Error('Unexpected Supabase project; inspect the environment first');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const check = async query => { const result = await query; if (result.error) throw result.error; return result.data; };
const [sources, roster, settings, venue] = await Promise.all([
  check(admin.from('dancer_profiles').select('id,slug,stage_name,dancer_photos(id,storage_path,review_status,is_primary,is_pinned,sort_order)').in('slug', SOURCE_SLUGS).eq('is_public', true).eq('status','approved').eq('verification_status','approved').is('disabled_at',null)),
  check(admin.rpc('internal_roster_members', { p_venue_id: ECHO_ID })),
  check(admin.from('dancer_age_verification_settings').select('enabled').eq('singleton',true).single()),
  check(admin.from('venues').select('id,name,is_active').eq('id',ECHO_ID).single()),
]);
if (settings.enabled || venue.name !== 'Echo House' || !venue.is_active) throw new Error('Expected active Echo House in existing demo mode');
if (sources.length !== SOURCE_SLUGS.length || sources.some(p => !gridPhoto(p))) throw new Error('Every existing grid source must have an approved photo');
sources.sort((a,b) => SOURCE_SLUGS.indexOf(a.slug) - SOURCE_SLUGS.indexOf(b.slug));
const existing = await check(admin.from('dancer_profiles').select('id,user_id,slug,status,is_public').like('slug','echo-grid-%'));
const baseIds = roster.filter(p => !existing.some(e => e.id === p.id)).map(p => p.id);
const additions = 100 - baseIds.length;
if (additions < 1 || additions > DEMO_NAMES.length) throw new Error('Unexpected baseline roster size');
console.log(JSON.stringify({ mode: args.get('mode'), baselineRoster: baseIds.length, additions, sourcePhotos: sources.length, existingAddedProfiles: existing.length }));
if (args.get('mode') === 'inspect') process.exit(0);
if (!args.get('out')) throw new Error('An --out directory is required for the reviewable publication plan');
const out = path.resolve(args.get('out'));
await mkdir(out, { recursive: true });
const users = [];
for (let page = 1; ; page++) {
  const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (result.error) throw result.error;
  users.push(...result.data.users);
  if (result.data.users.length < 1000) break;
}
const plan = { marker: DEMO_MARKER, venueId: ECHO_ID, target: 100, baseIds, profiles: [] };
for (let index = 0; index < additions; index++) {
  const slug = `echo-grid-${String(index + 1).padStart(3,'0')}`, email = `${slug}@synthetic.mydancr.invalid`;
  const source = sources[index % sources.length], photo = gridPhoto(source);
  let user = users.find(u => u.email === email);
  if (user && (user.user_metadata?.dataset_marker !== DEMO_MARKER || user.user_metadata?.source_photo_id !== photo.id || user.user_metadata?.source_storage_path !== photo.storage_path)) throw new Error(`Refusing to reuse unexpected ${slug}`);
  if (!user) {
    const result = await admin.auth.admin.createUser({ email, password: randomBytes(32).toString('base64url'), email_confirm: true, ban_duration: '876000h',
      user_metadata: { role: 'dancer', city: 'Las Vegas', stage_name: DEMO_NAMES[index], display_name: DEMO_NAMES[index], dataset_marker: DEMO_MARKER, source_photo_id: photo.id, source_storage_path: photo.storage_path } });
    if (result.error) throw result.error;
    user = result.data.user;
  }
  if (!user || !(new Date(user.banned_until).getTime() > Date.now())) throw new Error('Demo sign-in must be disabled');
  const profile = await check(admin.from('dancer_profiles').select('id,user_id,slug,status,is_public').eq('user_id',user.id).single());
  if (profile.is_public) throw new Error(`${slug} is already public; use inspect instead of republishing`);
  const storagePath = `${user.id}/${profile.id}/${DEMO_MARKER}/${photo.storage_path.split('/').pop()}`;
  // Copy only this approved front-facing image and its existing responsive sizes.
  for (const sourcePath of photoStoragePaths(photo.storage_path)) {
    const destination = storagePath + sourcePath.slice(photo.storage_path.length);
    const copied = await admin.storage.from('dancer-photos').copy(sourcePath, destination);
    if (copied.error && !/already exists|duplicate/i.test(copied.error.message)) throw copied.error;
    const receipt = await admin.storage.from('dancer-photos').info(destination);
    if (receipt.error || !receipt.data) throw receipt.error || new Error('Missing copied photo');
  }
  plan.profiles.push({ user_id: user.id, dancer_id: profile.id, slug, name: DEMO_NAMES[index], storage_path: storagePath, photo_id: randomUUID(), shift_id: randomUUID(), source_photo_id: photo.id });
  await writeFile(path.join(out,'prepared.json'), JSON.stringify(plan,null,2));
  if ((index + 1) % 10 === 0 || index + 1 === additions) console.log(`Prepared ${index + 1}/${additions} unpublished demo profiles`);
}
await writeFile(path.join(out,'publish.sql'), publishSql(plan));
console.log(JSON.stringify({ prepared: plan.profiles.length, publicWrites: false, output: out }));
