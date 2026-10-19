// Prepares a login-disabled demo owner and an unpublished club. Publishing the
// reviewed roster is a separate guarded SQL transaction; no emails are sent.
// Brand/address source: https://spearmintrhinolv.com/
// Logo: /wp-content/uploads/2025/03/SRLV_Logo_2D_Gold_TransparentBackground_2-1-e1742180493616.png
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

const marker = 'mydancr-spearmint-rhino-las-vegas-demo-v1';
const slug = 'spearmint-rhino-las-vegas-demo';
if (!process.argv.includes(`--confirm=${marker}`)) throw new Error('Pass the exact demo marker to prepare this club.');
const logoFile = process.argv.find(arg => arg.startsWith('--logo='))?.slice(7);
if (!logoFile) throw new Error('Provide the downloaded official Las Vegas PNG with --logo=');
const logo = await readFile(logoFile);
if (logo.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || logo.length > 2_000_000) throw new Error('Expected the official PNG logo.');
nextEnv.loadEnvConfig(process.cwd());
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'hfmzwadzabmgxkjzmqun.supabase.co') throw new Error('Unexpected project.');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const check = async query => { const result = await query; if (result.error) throw result.error; return result.data; };
const email = `${slug}@synthetic.mydancr.invalid`;
let owner;
for (let page = 1; ; page++) {
  const data = await check(admin.auth.admin.listUsers({ page, perPage: 1000 }));
  owner = data.users.find(user => user.email === email);
  if (owner || data.users.length < 1000) break;
}
if (!owner) {
  const data = await check(admin.auth.admin.createUser({ email, password: randomBytes(40).toString('base64url'), email_confirm: true, ban_duration: '876000h',
    app_metadata: { mydancr_provisioned_role: 'venue', dataset_marker: marker },
    user_metadata: { display_name: 'Spearmint Rhino Las Vegas demo', city: 'Las Vegas', dataset_marker: marker } }));
  owner = data.user;
}
if (owner.app_metadata?.dataset_marker !== marker || !(Date.parse(owner.banned_until) > Date.now())) throw new Error('Unexpected owner; refusing to reuse.');
// Auth can write app_metadata after its INSERT trigger has provisioned the
// default customer. Promote only this exact banned, server-marked fixture.
let account = await check(admin.from('app_users').select('role,account_state').eq('id', owner.id).single());
if (account.role === 'customer' && account.account_state === 'active') {
  account = await check(admin.from('app_users').update({ role: 'venue' }).eq('id', owner.id).eq('role', 'customer').select('role,account_state').single());
}
if (account.role !== 'venue' || account.account_state !== 'active') throw new Error('Demo owner must be an active venue account with sign-in disabled.');
let venue = await check(admin.from('venues').select('id,owner_user_id,is_active').eq('slug', slug).maybeSingle());
if (venue && venue.owner_user_id !== owner.id) throw new Error('Slug already belongs to another club.');
if (!venue) venue = await check(admin.from('venues').insert({ name: 'Spearmint Rhino Las Vegas', slug, city: 'Las Vegas', state: 'NV',
  address: '3340 S Highland Dr, Las Vegas, NV 89109', phone: '702-796-3600', website: 'https://spearmintrhinolv.com/',
  timezone: 'America/Los_Angeles', owner_user_id: owner.id, is_active: false, page_review_status: 'admin_draft',
  page_review_notes: 'MyDancr demonstration with synthetic dancers. Official Las Vegas logo and address; no redeemable admission offer.' }).select('id,owner_user_id,is_active').single());
if (venue.is_active) throw new Error('Club already published; inspect the roster instead of preparing again.');
const storagePath = `${owner.id}/${venue.id}/spearmint-rhino-las-vegas.png`;
await check(admin.storage.from('venue-logo-images').upload(storagePath, logo, { contentType: 'image/png', upsert: true, cacheControl: '3600' }));
await check(admin.storage.from('venue-logo-images').info(storagePath));
await check(admin.from('venues').update({ logo_storage_path: storagePath, logo_updated_at: new Date().toISOString() }).eq('id', venue.id).eq('is_active', false));
await check(admin.from('venue_guest_colors').upsert({ venue_id: venue.id, internal_accent: '#b8860b', embed_accent: '#b8860b' }));
console.log(JSON.stringify({ venueId: venue.id, slug, prepared: true, published: false, logo: true, internalAccent: '#b8860b', embedAccent: '#b8860b' }));
