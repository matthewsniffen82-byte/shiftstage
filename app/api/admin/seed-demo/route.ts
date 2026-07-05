import { NextResponse } from "next/server";
import { apiError } from "@/src/lib/api";
import { requireAdmin } from "@/src/lib/dancr/admin";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { createRequestSupabaseContext } from "@/src/lib/supabase/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SeedDancer = {
  realName: string;
  stageName: string;
  slug: string;
  bio: string;
  venueSlug: string;
  trendRank?: number;
  photoSet: number;
};

type SeedVenue = {
  name: string;
  slug: string;
  address: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
};

type SeedVenueRow = {
  id: string;
  slug: string;
  name: string;
};

const city = "Las Vegas";
const timezone = "America/Los_Angeles";
const seedEmailDomain = "mydancr.local";

const seedVenues: SeedVenue[] = [
  {
    name: "Velvet Room",
    slug: "velvet-room",
    address: "Las Vegas, NV",
    latitude: 36.114647,
    longitude: -115.172813,
  },
  {
    name: "Prism Lounge",
    slug: "prism-lounge",
    address: "Las Vegas, NV",
    latitude: 36.126766,
    longitude: -115.165779,
  },
  {
    name: "Neon Hall",
    slug: "neon-hall",
    address: "Las Vegas, NV",
    latitude: 36.109953,
    longitude: -115.170716,
  },
  {
    name: "Crazy Horse 3",
    slug: "crazy-horse-3",
    address: "3525 W Russell Rd, Las Vegas, NV",
    latitude: 36.085613,
    longitude: -115.188904,
  },
  {
    name: "Sapphire Las Vegas",
    slug: "sapphire-las-vegas",
    address: "3025 Sammy Davis Jr Dr, Las Vegas, NV",
    latitude: 36.135133,
    longitude: -115.172011,
  },
  {
    name: "Spearmint Rhino Las Vegas",
    slug: "spearmint-rhino",
    address: "3340 S Highland Dr, Las Vegas, NV",
    latitude: 36.128224,
    longitude: -115.177495,
  },
  {
    name: "Chicas Bonitas",
    slug: "chicas-bonitas",
    address: "3300 S Highland Dr, Las Vegas, NV",
    latitude: 36.129628,
    longitude: -115.17739,
  },
  {
    name: "Little Darlings Las Vegas",
    slug: "little-darlings",
    address: "1514 Western Ave, Las Vegas, NV",
    latitude: 36.152239,
    longitude: -115.160781,
  },
  {
    name: "Hustler Club Las Vegas",
    slug: "hustler-club-las-vegas",
    address: "6007 Dean Martin Dr, Las Vegas, NV",
    latitude: 36.080751,
    longitude: -115.182498,
  },
];

const photoSets = [
  [
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1200&q=80",
  ],
  [
    "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?auto=format&fit=crop&w=1200&q=80",
  ],
  [
    "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1512316609839-ce289d3eba0a?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=1200&q=80",
  ],
  [
    "https://images.unsplash.com/photo-1524250502761-1ac6f2e30d43?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1496440737103-cd596325d314?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1548142813-c348350df52b?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1200&q=80",
  ],
];

const seedDancers: SeedDancer[] = [
  { realName: "Tessa Morgan", stageName: "Tess Flame", slug: "tess-flame", venueSlug: "velvet-room", trendRank: 3, photoSet: 0, bio: "High-energy Vegas performer with a polished stage presence and a loyal late-night following." },
  { realName: "Gianna Ellis", stageName: "Gia Night", slug: "gia-night", venueSlug: "prism-lounge", trendRank: 1, photoSet: 1, bio: "A smooth, social host with a confident Vegas look and premium lounge energy." },
  { realName: "Maya Lowell", stageName: "Maya Lux", slug: "maya-lux", venueSlug: "velvet-room", trendRank: 4, photoSet: 2, bio: "Friendly, stylish, and known for making first-time visitors feel welcome." },
  { realName: "Mina Voss", stageName: "Mina Voss", slug: "mina-voss", venueSlug: "neon-hall", trendRank: 8, photoSet: 0, bio: "Classic nightlife energy with sharp style and steady regulars." },
  { realName: "Kira Solano", stageName: "Kira Sol", slug: "kira-sol", venueSlug: "crazy-horse-3", trendRank: 2, photoSet: 2, bio: "Confident performer with a big-room presence and a strong social following." },
  { realName: "Lena Hart", stageName: "Lena Hart", slug: "lena-hart", venueSlug: "sapphire-las-vegas", trendRank: 5, photoSet: 1, bio: "Warm, elegant, and easy to talk to, with a bright Vegas-first style." },
  { realName: "Riley Vale", stageName: "Riley Vale", slug: "riley-vale", venueSlug: "spearmint-rhino", trendRank: 6, photoSet: 3, bio: "Playful, polished, and popular with visitors planning a full night out." },
  { realName: "Aria Quinn", stageName: "Aria Quinn", slug: "aria-quinn", venueSlug: "chicas-bonitas", trendRank: 7, photoSet: 0, bio: "A personable performer with bold style and high-repeat guest interest." },
  { realName: "Nova Lane", stageName: "Nova Lane", slug: "nova-lane", venueSlug: "little-darlings", trendRank: 9, photoSet: 1, bio: "Modern, upbeat, and great for guests looking for a fun first stop." },
  { realName: "Sienna Rose", stageName: "Sienna Rose", slug: "sienna-rose", venueSlug: "hustler-club-las-vegas", trendRank: 10, photoSet: 2, bio: "Relaxed and charismatic, with a steady crowd around her nights." },
  { realName: "Jade Monroe", stageName: "Jade Monroe", slug: "jade-monroe", venueSlug: "velvet-room", photoSet: 3, bio: "Stylish Vegas regular with a calm, premium-room presence." },
  { realName: "Nia Sterling", stageName: "Nia Sterling", slug: "nia-sterling", venueSlug: "prism-lounge", photoSet: 0, bio: "A bright conversationalist with high-end lounge energy." },
  { realName: "Skye Marlow", stageName: "Skye Marlow", slug: "skye-marlow", venueSlug: "neon-hall", photoSet: 1, bio: "Social, warm, and easygoing with a polished nightlife look." },
  { realName: "Elle Vega", stageName: "Elle Vega", slug: "elle-vega", venueSlug: "crazy-horse-3", photoSet: 2, bio: "Confident host energy with a strong sense of style." },
  { realName: "Brielle Knox", stageName: "Brielle Knox", slug: "brielle-knox", venueSlug: "sapphire-las-vegas", photoSet: 3, bio: "A polished performer with a friendly crowd-first vibe." },
  { realName: "Lola Star", stageName: "Lola Star", slug: "lola-star", venueSlug: "spearmint-rhino", photoSet: 0, bio: "Fun, direct, and known for keeping the room lively." },
  { realName: "Ava Saint", stageName: "Ava Saint", slug: "ava-saint", venueSlug: "chicas-bonitas", photoSet: 1, bio: "Elegant and approachable with classic Vegas nightlife presence." },
  { realName: "Zara Bell", stageName: "Zara Bell", slug: "zara-bell", venueSlug: "little-darlings", photoSet: 2, bio: "A modern profile with relaxed energy and easy conversation." },
  { realName: "Cleo Ray", stageName: "Cleo Ray", slug: "cleo-ray", venueSlug: "hustler-club-las-vegas", photoSet: 3, bio: "Bold and social with a polished late-night style." },
  { realName: "Ivy Fox", stageName: "Ivy Fox", slug: "ivy-fox", venueSlug: "velvet-room", photoSet: 0, bio: "Friendly, stylish, and easy to find on busy nights." },
  { realName: "Raven Cole", stageName: "Raven Cole", slug: "raven-cole", venueSlug: "prism-lounge", photoSet: 1, bio: "Cool, confident, and a strong fit for lounge-focused guests." },
  { realName: "Mila Cruz", stageName: "Mila Cruz", slug: "mila-cruz", venueSlug: "neon-hall", photoSet: 2, bio: "Upbeat performer with a warm guest-first approach." },
  { realName: "Ruby West", stageName: "Ruby West", slug: "ruby-west", venueSlug: "crazy-horse-3", photoSet: 3, bio: "A lively Vegas profile with a bold look and fun energy." },
  { realName: "Selene Rae", stageName: "Selene Rae", slug: "selene-rae", venueSlug: "sapphire-las-vegas", photoSet: 0, bio: "Smooth, classy, and built for a premium club night." },
  { realName: "Talia Moon", stageName: "Talia Moon", slug: "talia-moon", venueSlug: "spearmint-rhino", photoSet: 1, bio: "A polished, approachable performer with strong late-night appeal." },
];

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Use POST as an authenticated admin to repopulate the Las Vegas demo dancers.",
    creates: {
      approvedDancers: 25,
      workingNowShifts: 15,
      upcomingShifts: 10,
      trendingRanks: 10,
    },
  });
}

export async function POST(request: Request) {
  try {
    const { client, user } = await createRequestSupabaseContext(request);
    await requireAdmin(client, user.id);

    const admin = createAdminSupabaseClient();
    const authUsers = await listAllAuthUsers(admin);
    const venueBySlug = await ensureVenues(admin);
    const seedUsers = await ensureSeedUsers(admin, authUsers);

    await admin.from("app_users").upsert(
      seedUsers.map((seedUser) => ({
        id: seedUser.userId,
        role: "dancer",
        display_name: seedUser.dancer.stageName,
        email: seedUser.email,
        account_state: "active",
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    );

    const { data: profiles, error: profileError } = await admin
      .from("dancer_profiles")
      .upsert(
        seedUsers.map((seedUser) => ({
          user_id: seedUser.userId,
          real_name: seedUser.dancer.realName,
          stage_name: seedUser.dancer.stageName,
          slug: seedUser.dancer.slug,
          city,
          bio: seedUser.dancer.bio,
          status: "approved",
          verification_status: "approved",
          photo_review_status: "approved",
          approved_at: new Date().toISOString(),
          disabled_at: null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "user_id" },
      )
      .select("id, user_id, slug, stage_name");

    if (profileError) throw profileError;
    if (!profiles?.length) throw new Error("No seed profiles were created.");

    const profileIds = profiles.map((profile: { id: string }) => profile.id);
    await clearSeedProfileData(admin, profileIds);
    await insertSeedPhotos(admin, profiles);
    await insertSeedSocialLinks(admin, profiles);
    await insertSeedShifts(admin, profiles, venueBySlug);
    await insertSeedTrendingScores(admin, profiles);

    return NextResponse.json({
      ok: true,
      city,
      seeded: {
        approvedDancers: profiles.length,
        workingNowShifts: 15,
        upcomingShifts: 10,
        trendingRanks: 10,
      },
    });
  } catch (error) {
    return apiError(error, "Unable to repopulate Vegas demo profiles.");
  }
}

async function ensureVenues(admin: any) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("venues")
    .upsert(
      seedVenues.map((venue) => ({
        name: venue.name,
        slug: venue.slug,
        city: venue.city || city,
        state: venue.state || "NV",
        address: venue.address,
        timezone,
        opens_at: "20:00",
        closes_at: "04:00",
        is_active: true,
        latitude: venue.latitude,
        longitude: venue.longitude,
        updated_at: now,
      })),
      { onConflict: "slug" },
    )
    .select("id, slug, name");

  if (error) throw error;

  return new Map<string, SeedVenueRow>((data || []).map((venue: SeedVenueRow) => [venue.slug, venue]));
}

async function listAllAuthUsers(admin: any) {
  const users: Array<{ id: string; email?: string }> = [];

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;

    users.push(...(data?.users || []));
    if (!data?.users?.length || users.length >= (data?.total || 0)) break;
  }

  return users;
}

async function ensureSeedUsers(admin: any, authUsers: Array<{ id: string; email?: string }>) {
  const usersByEmail = new Map(authUsers.map((user) => [user.email?.toLowerCase(), user]));
  const seedUsers: Array<{ userId: string; email: string; dancer: SeedDancer }> = [];

  for (const dancer of seedDancers) {
    const email = `seed+dancer-${dancer.slug}@${seedEmailDomain}`;
    const existingUser = usersByEmail.get(email);

    if (existingUser?.id) {
      seedUsers.push({ userId: existingUser.id, email, dancer });
      continue;
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: crypto.randomUUID(),
      user_metadata: {
        role: "dancer",
        seed: true,
        stage_name: dancer.stageName,
      },
    });

    if (error) throw error;
    if (!data?.user?.id) throw new Error(`Unable to create seed user for ${dancer.stageName}.`);

    seedUsers.push({ userId: data.user.id, email, dancer });
  }

  return seedUsers;
}

async function clearSeedProfileData(admin: any, profileIds: string[]) {
  await Promise.all([
    admin.from("dancer_photos").delete().in("dancer_id", profileIds),
    admin.from("social_links").delete().in("dancer_id", profileIds),
    admin.from("shifts").delete().in("dancer_id", profileIds),
    admin.from("trending_scores").delete().in("dancer_id", profileIds),
    admin.from("ranking_events").delete().in("dancer_id", profileIds),
  ]);
}

async function insertSeedPhotos(admin: any, profiles: Array<{ id: string; slug: string; stage_name: string }>) {
  const rows = profiles.flatMap((profile) => {
    const dancer = seedDancers.find((seedDancer) => seedDancer.slug === profile.slug);
    const photos = photoSets[dancer?.photoSet || 0] || photoSets[0];

    return photos.map((photo, index) => ({
      dancer_id: profile.id,
      storage_path: photo,
      alt_text: `${profile.stage_name} profile photo ${index + 1}`,
      sort_order: index,
      is_primary: index === 0,
      review_status: "approved",
    }));
  });

  const { error } = await admin.from("dancer_photos").insert(rows);
  if (error) throw error;
}

async function insertSeedSocialLinks(admin: any, profiles: Array<{ id: string; slug: string }>) {
  const rows = profiles.flatMap((profile) => [
    {
      dancer_id: profile.id,
      platform: "instagram",
      handle: profile.slug.replaceAll("-", "."),
      url: `https://instagram.com/${profile.slug.replaceAll("-", ".")}`,
      is_active: true,
    },
    {
      dancer_id: profile.id,
      platform: "tiktok",
      handle: profile.slug.replaceAll("-", ""),
      url: `https://tiktok.com/@${profile.slug.replaceAll("-", "")}`,
      is_active: true,
    },
  ]);

  const { error } = await admin.from("social_links").insert(rows);
  if (error) throw error;
}

async function insertSeedShifts(
  admin: any,
  profiles: Array<{ id: string; slug: string }>,
  venueBySlug: Map<string, SeedVenueRow>,
) {
  const now = new Date();
  const activeStartsAt = new Date(now.getTime() - 90 * 60 * 1000).toISOString();
  const activeEndsAt = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const checkedInAt = new Date(now.getTime() - 55 * 60 * 1000).toISOString();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(20, 0, 0, 0);

  const rows = profiles.map((profile, index) => {
    const dancer = seedDancers.find((seedDancer) => seedDancer.slug === profile.slug);
    const venue = venueBySlug.get(dancer?.venueSlug || "velvet-room") || Array.from(venueBySlug.values())[0];
    const isWorkingNow = index < 15;
    const startsAt = isWorkingNow
      ? activeStartsAt
      : new Date(tomorrow.getTime() + (index - 15) * 30 * 60 * 1000).toISOString();
    const endsAt = isWorkingNow
      ? activeEndsAt
      : new Date(tomorrow.getTime() + (index - 15) * 30 * 60 * 1000 + 5 * 60 * 60 * 1000).toISOString();

    return {
      dancer_id: profile.id,
      venue_id: venue.id,
      starts_at: startsAt,
      ends_at: endsAt,
      timezone,
      status: "posted",
      location_status: isWorkingNow ? "location_confirmed" : "self_reported",
      checked_in_at: isWorkingNow ? checkedInAt : null,
      checked_out_at: null,
      checkin_latitude: isWorkingNow ? seedVenues.find((seedVenue) => seedVenue.slug === venue.slug)?.latitude : null,
      checkin_longitude: isWorkingNow ? seedVenues.find((seedVenue) => seedVenue.slug === venue.slug)?.longitude : null,
      checkin_distance_feet: isWorkingNow ? 72 + index : null,
      working_status: isWorkingNow ? "checked_in" : "self_reported",
      commission_tracking_started_at: isWorkingNow ? checkedInAt : null,
      commission_tracking_stopped_at: null,
    };
  });

  const { error } = await admin.from("shifts").insert(rows);
  if (error) throw error;
}

async function insertSeedTrendingScores(admin: any, profiles: Array<{ id: string; slug: string }>) {
  const profileBySlug = new Map(profiles.map((profile) => [profile.slug, profile]));
  const rows = seedDancers
    .filter((dancer) => dancer.trendRank)
    .map((dancer) => {
      const profile = profileBySlug.get(dancer.slug);
      if (!profile || !dancer.trendRank) return null;

      return {
        dancer_id: profile.id,
        city,
        score: 1200 - dancer.trendRank * 37,
        rank: dancer.trendRank,
        previous_rank: dancer.trendRank + 2,
        highest_rank: dancer.trendRank,
        best_rank_this_week: dancer.trendRank,
        trend: dancer.trendRank <= 3 ? "rising" : "stable",
        calculated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  const { error } = await admin.from("trending_scores").insert(rows);
  if (error) throw error;
}
