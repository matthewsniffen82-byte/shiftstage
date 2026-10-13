// Prepare login-disabled fictional guests for seed-echo-dashboard.sql. Never sends invitations.
import { randomBytes } from 'node:crypto';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

const marker = 'mydancr-echo-dashboard-v1';
const args = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
if (args.get('target') !== 'production' || !['inspect', 'prepare'].includes(args.get('mode'))) {
  throw new Error('Use --target=production --mode=inspect|prepare');
}
if (args.get('mode') === 'prepare' && args.get('confirm') !== marker) throw new Error(`Use --confirm=${marker}`);
nextEnv.loadEnvConfig(process.env.DANCR_ENV_DIR || process.cwd());
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname !== 'hfmzwadzabmgxkjzmqun.supabase.co') throw new Error('Unexpected project');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const { data: venue, error } = await admin.from('venues').select('name,is_active').eq('id', '260a8cc4-e7d9-46b8-8ef3-a041fd4fe2af').single();
if (error) throw error;
if (venue.name !== 'Echo House' || !venue.is_active) throw new Error('Expected active Echo House');
const users = [];
for (let page = 1; ; page++) {
  const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (result.error) throw result.error;
  users.push(...result.data.users);
  if (result.data.users.length < 1000) break;
}
let prepared = 0;
for (let index = 1; index <= 12; index++) {
  const suffix = String(index).padStart(2, '0');
  const email = `echo-experience-guest-${suffix}@synthetic.mydancr.invalid`;
  let user = users.find(value => value.email === email);
  if (user && (user.user_metadata?.dataset_marker !== marker || user.user_metadata?.role !== 'customer'
    || !(new Date(user.banned_until).getTime() > Date.now()))) throw new Error('Unexpected or login-enabled fixture account');
  if (!user && args.get('mode') === 'prepare') {
    const result = await admin.auth.admin.createUser({ email, password: randomBytes(32).toString('base64url'),
      email_confirm: true, ban_duration: '876000h',
      user_metadata: { role: 'customer', display_name: `Sample guest ${suffix}`, city: 'Las Vegas', dataset_marker: marker } });
    if (result.error) throw result.error;
    user = result.data.user;
  }
  if (user) prepared++;
}
console.log(JSON.stringify({ venue: venue.name, mode: args.get('mode'), preparedGuests: prepared, invitationsSent: 0 }));
