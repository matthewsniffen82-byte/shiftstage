// Explicit operator task. Never run automatically during deployment.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { photoStoragePaths } from './lib/echo-demo-grid.mjs';
import { OFFSHIFT_MARKER, OFFSHIFT_NAMES, offshiftSlug, offshiftPublicationSql } from './lib/offshift-demo.mjs';

nextEnv.loadEnvConfig(process.cwd());
const args = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
if (!['inspect', 'prepare'].includes(args.get('mode')) || args.get('target') !== 'production') throw new Error('Choose --mode=inspect or --mode=prepare and --target=production');
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'hfmzwadzabmgxkjzmqun.supabase.co') throw new Error('Unexpected Supabase project');
if (args.get('mode') === 'prepare' && (args.get('confirm') !== OFFSHIFT_MARKER || !args.get('out'))) throw new Error('Preparation needs the exact --confirm marker and an --out directory');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const check = async query => { const { data, error } = await query; if (error) throw error; return data; };
const sources = await check(admin.from('dancer_profiles').select('id,slug,dancer_photos(id,storage_path,review_status,is_primary,sort_order)')
  .eq('slug', 'lvdegen11').eq('status', 'approved').eq('verification_status', 'approved').eq('is_public', true).is('disabled_at', null).single());
const photos = sources.dancer_photos.filter(p => p.review_status === 'approved').sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
if (photos.length < 3) throw new Error('Three existing approved demo photos are required');
const settings = await check(admin.from('dancer_age_verification_settings').select('enabled').eq('singleton', true).single());
if (settings.enabled) throw new Error('Demo setup is unavailable while age enforcement is active');
const existing = await check(admin.from('dancer_profiles').select('id,user_id,slug,status,is_public').like('slug', 'offshift-demo-%'));
console.log(JSON.stringify({ mode: args.get('mode'), target: 9, existing: existing.length, approvedSourcePhotos: photos.length }));
if (args.get('mode') === 'inspect') process.exit(0);
const out = path.resolve(args.get('out'));
await mkdir(out, { recursive: true });
const prior = JSON.parse(await readFile(path.join(out, 'prepared.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return 'null'; throw error; }));
if (prior && prior.marker !== OFFSHIFT_MARKER) throw new Error('Unexpected saved preparation');
const users = [];
for (let page = 1; ; page++) {
  const data = await check(admin.auth.admin.listUsers({ page, perPage: 1000 })); users.push(...data.users);
  if (data.users.length < 1000) break;
}
const plan = { marker: OFFSHIFT_MARKER, profiles: [] };
for (const [index, name] of OFFSHIFT_NAMES.entries()) {
  const slug = offshiftSlug(index), email = `${slug}@synthetic.mydancr.invalid`;
  let user = users.find(item => item.email === email);
  if (!user) user = (await check(admin.auth.admin.createUser({ email, password: randomBytes(40).toString('base64url'), email_confirm: true, ban_duration: '876000h',
    app_metadata: { dataset_marker: OFFSHIFT_MARKER }, user_metadata: { role: 'dancer', city: 'Las Vegas', stage_name: name, display_name: name, dataset_marker: OFFSHIFT_MARKER } }))).user;
  if (user?.app_metadata?.dataset_marker !== OFFSHIFT_MARKER || !(Date.parse(user.banned_until) > Date.now())) throw new Error('Unexpected or login-enabled demo account');
  const profile = await check(admin.from('dancer_profiles').select('id,user_id,slug,status,is_public').eq('user_id', user.id).single());
  if (profile.is_public) throw new Error('This batch is already published; use inspect');
  const saved = prior?.profiles.find(item => item.user_id === user.id);
  const prepared = { user_id: user.id, dancer_id: profile.id, slug, name, photos: [] };
  for (let order = 0; order < 3; order++) {
    const source = photos[(index + order) % photos.length];
    const storage_path = `${user.id}/${profile.id}/${OFFSHIFT_MARKER}/${source.storage_path.split('/').pop()}`;
    for (const sourcePath of photoStoragePaths(source.storage_path)) {
      const destination = storage_path + sourcePath.slice(source.storage_path.length);
      const copied = await admin.storage.from('dancer-photos').copy(sourcePath, destination);
      if (copied.error && !/already exists|duplicate/i.test(copied.error.message)) throw copied.error;
      await check(admin.storage.from('dancer-photos').info(destination));
    }
    prepared.photos.push({ id: saved?.photos.find(item => item.source_id === source.id)?.id || randomUUID(), source_id: source.id, source_path: source.storage_path, storage_path });
  }
  plan.profiles.push(prepared);
  await writeFile(path.join(out, 'prepared.json'), JSON.stringify(plan, null, 2));
  console.log(`Prepared ${index + 1}/9 unpublished off-shift demos`);
}
await writeFile(path.join(out, 'publish.sql'), offshiftPublicationSql(plan));
console.log(JSON.stringify({ prepared: plan.profiles.length, publicWrites: false, output: out }));
