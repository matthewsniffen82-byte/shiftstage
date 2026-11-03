// Prepare the 20 requested, login-disabled Spearmint Rhino samples. Publication
// is a separate guarded transaction in publish-club-card-demo.sql.
import { randomBytes } from 'node:crypto';
import nextEnv from '@next/env';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { createProfilePhoto, PROFILE_DEFINITIONS } from './layout-review-profile-sheet.mjs';

const operation = 'mydancr-club-card-demo-20261103';
const sampleMarker = 'mydancr-rhino-restored-20261028';
const venueId = '103e9b1b-77b5-43d2-9eb8-88aa11ed906d';
if (!process.argv.includes(`--confirm=${operation}`)) throw new Error(`Pass --confirm=${operation}`);
nextEnv.loadEnvConfig(process.cwd());
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'hfmzwadzabmgxkjzmqun.supabase.co') throw new Error('Unexpected project');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const check = async query => { const result = await query; if (result.error) throw result.error; return result.data; };
const venue = await check(admin.from('venues').select('slug,is_active').eq('id', venueId).single());
if (venue.slug !== 'spearmint-rhino' || !venue.is_active) throw new Error('Expected the active Spearmint Rhino');
const existing = await check(admin.from('dancer_profiles').select('id,user_id,slug,is_public'));
const users = [];
for (let page = 1; ; page++) {
  const { users: batch } = await check(admin.auth.admin.listUsers({ page, perPage: 1000 }));
  users.push(...batch);
  if (batch.length < 1000) break;
}
// Resume only this operation's unpublished accounts. Never recycle a real user.
for (const profile of existing) {
  const user = users.find(row => row.id === profile.user_id);
  if (profile.is_public || user?.app_metadata?.demo_operation !== operation) throw new Error('The empty baseline changed; inspect before proceeding');
}
const names = ['Luna','Ivy','Kai','Sienna','Nova','Bella','Jada','Nikki','Vanessa','Aria',
  'Maya','Jade','Raven','Skye','Ruby','Zara','Hazel','Sage','Amber','Willow'];
for (let index = 0; index < 20; index++) {
  const slug = `echo-grid-${String(index + 1).padStart(3, '0')}`;
  const email = `${slug}@synthetic.mydancr.invalid`;
  const name = `Demo ${names[index]}`;
  let user = users.find(row => row.email === email);
  if (user && user.app_metadata?.demo_operation !== operation) throw new Error(`Unexpected owner for ${slug}`);
  if (!user) {
    ({ user } = await check(admin.auth.admin.createUser({ email, email_confirm: true,
      password: randomBytes(40).toString('base64url'), ban_duration: '876000h',
      app_metadata: { dataset_marker: sampleMarker, demo_operation: operation, demo_venue_id: venueId },
      user_metadata: { role: 'dancer', stage_name: name, display_name: name, city: 'Las Vegas' } })));
  }
  if (!user || !(Date.parse(user.banned_until) > Date.now())) throw new Error('Demo login must be disabled');
  const profile = await check(admin.from('dancer_profiles').select('id,status,is_public').eq('user_id', user.id).single());
  if (profile.status !== 'draft' || profile.is_public) throw new Error(`${slug} is already published`);
  await check(admin.auth.admin.updateUserById(user.id, { app_metadata: {
    ...user.app_metadata, dataset_marker: sampleMarker, demo_operation: operation,
    demo_venue_id: venueId, demo_profile_id: profile.id,
  } }));
  await check(admin.from('dancer_profiles').update({ slug, stage_name: name, real_name: name, city: 'Las Vegas' }).eq('id', profile.id).eq('status', 'draft'));
  const definition = PROFILE_DEFINITIONS[index % PROFILE_DEFINITIONS.length];
  const primary = definition.primaryPhotoIndex || 0;
  const photoIndex = (primary + Math.floor(index / PROFILE_DEFINITIONS.length)) % definition.tiles.length;
  const photo = await createProfilePhoto(definition, photoIndex);
  const avatar = await sharp(photo).resize(256, 256, { fit: 'cover', position: 'north' }).jpeg({ quality: 88 }).toBuffer();
  const storagePath = `${user.id}/${profile.id}/${operation}/main.jpg`;
  for (const [path, buffer] of [[storagePath, photo], [`${storagePath}.avatar.jpg`, avatar]]) {
    await check(admin.storage.from('dancer-photos').upload(path, buffer, { contentType: 'image/jpeg', cacheControl: '3600', upsert: true }));
    await check(admin.storage.from('dancer-photos').info(path));
  }
  console.log(`Prepared ${index + 1}/20 demo dancers`);
}
console.log(JSON.stringify({ prepared: 20, venue: 'Spearmint Rhino', published: false, signInDisabled: true }));
