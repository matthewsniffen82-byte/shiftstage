import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const pickupId = n => `96000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export async function pickupFixture(migrations = ['20260914190000_club_pickup_domain.sql']) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table public.app_users(id uuid primary key,role text not null,account_state text not null default 'active',display_name text);
    create table public.venues(id uuid primary key,owner_user_id uuid references app_users(id),name text,slug text,
      is_active boolean default true,page_review_status text default 'published',published_at timestamptz default now());
    create table public.venue_team_members(venue_id uuid references venues(id),user_id uuid references app_users(id),role text,status text);
    create table public.qr_redemptions(id uuid primary key,customer_id uuid references app_users(id),venue_id uuid references venues(id),
      status text,redeemed_at timestamptz,nfc_tag_id uuid,confirmed_at timestamptz,club_deal_id uuid,suspicious boolean default false,voided_at timestamptz);
    create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid references app_users(id),
      notification_type text,channel text,title text,body text,payload jsonb,read_at timestamptz,sent_at timestamptz,created_at timestamptz default now());
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`);
  for (const file of migrations) await db.exec(readFileSync(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8'));
  for (const [n,role] of [[1,'customer'],[2,'customer'],[3,'venue'],[4,'venue'],[5,'venue'],[6,'dancer'],[7,'admin'],[8,'venue']]) {
    await db.query('insert into app_users(id,role,display_name) values($1,$2,$3)',[pickupId(n),role,`Synthetic ${role}`]);
  }
  await db.query("insert into venues(id,owner_user_id,name,slug) values($1,$2,'Test Club','test-club'),($3,$4,'Other Club','other-club')",
    [pickupId(10),pickupId(3),pickupId(11),pickupId(4)]);
  await db.query("insert into venue_team_members values($1,$2,'manager','active'),($1,$3,'staff','active')",[pickupId(10),pickupId(5),pickupId(8)]);
  const asUser = async (n, role = 'authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n ? pickupId(n) : '']);
    await db.exec(`set role ${role}`);
  };
  return {db,asUser};
}
