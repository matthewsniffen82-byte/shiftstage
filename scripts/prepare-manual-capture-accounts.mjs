// User-requested training records for actual manual screenshots. No invitations.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

const marker = 'mydancr-manual-captures-20261030';
if (!process.argv.includes(`--confirm=${marker}`)) throw Error('Exact training marker required.');
nextEnv.loadEnvConfig(process.cwd());
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'hfmzwadzabmgxkjzmqun.supabase.co') throw Error('Unexpected project.');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const check = async promise => { const { data, error } = await promise; if (error) throw error; return data; };
const venue = await check(admin.from('venues').select('id,name,owner_user_id,is_active').eq('slug', 'spearmint-rhino').single());
const owner = await check(admin.from('app_users').select('email,role').eq('id', venue.owner_user_id).single());
if (venue.id !== '103e9b1b-77b5-43d2-9eb8-88aa11ed906d' || owner.email !== 'democlub@mydancr.com' || owner.role !== 'venue' || !venue.is_active) throw Error('Demo account assignment changed.');
const users = [];
for (let page = 1; ; page++) {
  const data = await check(admin.auth.admin.listUsers({ page, perPage: 1000 }));
  users.push(...data.users); if (data.users.length < 1000) break;
}
const dir = 'tmp/manual-live-captures';
mkdirSync(dir, { recursive: true });
const credentialFile = `${dir}/training-login.json`;
let login = existsSync(credentialFile) ? JSON.parse(readFileSync(credentialFile, 'utf8')) : null;
if (process.argv.includes('--retire-login')) {
  const user = users.find(u => u.email === 'manual-venue-20261030@synthetic.mydancr.invalid');
  if (!user || user.app_metadata?.dataset_marker !== marker || user.app_metadata?.mydancr_provisioned_role !== 'venue') {
    throw Error('Training owner identity not verified.');
  }
  const retired = await check(admin.auth.admin.updateUserById(user.id, { ban_duration: '876000h' }));
  if (!retired.user.banned_until || new Date(retired.user.banned_until) <= new Date()) throw Error('Training login was not retired.');
  if (existsSync(credentialFile)) unlinkSync(credentialFile);
  console.log(JSON.stringify({ marker, retiredLoginId: user.id, trainingRecordsPreserved: true }));
  process.exit(0);
}
const prepared = [];
for (const [role, name] of [['customer', 'Alex Training'], ['venue', 'Manual Training Club']]) {
  const email = `manual-${role}-20261030@synthetic.mydancr.invalid`;
  let user = users.find(u => u.email === email);
  if (user && user.app_metadata?.dataset_marker !== marker) throw Error('Fixture identity collision.');
  if (!user) {
    const password = randomBytes(32).toString('base64url') + '!aA1';
    if (role === 'venue') { login = { email, password }; writeFileSync(credentialFile, JSON.stringify(login)); }
    user = (await check(admin.auth.admin.createUser({ email, password, email_confirm: true,
      ...(role === 'customer' ? { ban_duration: '876000h' } : {}),
      app_metadata: { dataset_marker: marker, mydancr_provisioned_role: role },
      user_metadata: { role, display_name: name, city: 'Las Vegas' } }))).user;
  }
  if (role === 'venue' && login?.email !== email) throw Error('Training login unavailable; do not reset credentials automatically.');
  const account = await check(admin.from('app_users').select('role,account_state').eq('id', user.id).single());
  if (account.account_state !== 'active') throw Error('Training account is not active.');
  if (account.role !== role) {
    if (account.role !== 'customer') throw Error('Unexpected role.');
    await check(admin.from('app_users').update({ role }).eq('id', user.id).eq('role', 'customer'));
  }
  prepared.push({ role, id: user.id, email });
}
writeFileSync(`${dir}/accounts.json`, JSON.stringify({ marker, venueId: venue.id, prepared }, null, 2));
console.log(JSON.stringify({ marker, prepared, invitationsSent: 0 }));
