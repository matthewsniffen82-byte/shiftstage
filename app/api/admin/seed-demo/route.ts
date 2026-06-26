import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";
import { getServerEnv } from "@/src/lib/env";

const DEMO_PASSWORD = "DancrDemo123!";

const venues = [
  {
    name: "Velvet Room",
    slug: "velvet-room",
    city: "Las Vegas",
    state: "NV",
    address: "287 Arts District Ave, Las Vegas, NV",
    phone: "(555) 287-1096",
    website: "https://velvet-room-las-vegas.example.com",
  },
  {
    name: "Neon Hall",
    slug: "neon-hall",
    city: "Las Vegas",
    state: "NV",
    address: "253 The Strip Ave, Las Vegas, NV",
    phone: "(555) 253-1507",
    website: "https://neon-hall-las-vegas.example.com",
  },
  {
    name: "Afterglow",
    slug: "afterglow",
    city: "Las Vegas",
    state: "NV",
    address: "620 Fremont St, Las Vegas, NV",
    phone: "(555) 620-4411",
    website: "https://afterglow-las-vegas.example.com",
  },
  {
    name: "Prism Lounge",
    slug: "prism-lounge",
    city: "Las Vegas",
    state: "NV",
    address: "410 Paradise Rd, Las Vegas, NV",
    phone: "(555) 410-2288",
    website: "https://prism-lounge-las-vegas.example.com",
  },
];

const photos = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1200&q=84",
  "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=1200&q=84",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=1200&q=84",
  "https://images.unsplash.com/photo-1496440737103-cd596325d314?auto=format&fit=crop&w=1200&q=84",
];

const dancerSeeds = [
  {
    email: "approved@dancr.demo",
    realName: "Aria Alvarez",
    stageName: "Aria Vale",
    slug: "aria-vale",
    status: "approved",
    venueSlug: "afterglow",
    rank: 2,
    previousRank: 6,
    highestRank: 1,
    bestRankThisWeek: 2,
    followers: 74,
  },
  {
    email: "tess@dancr.demo",
    realName: "Tess Martin",
    stageName: "Tess Flame",
    slug: "tess-flame",
    status: "approved",
    venueSlug: "velvet-room",
    rank: 5,
    previousRank: 8,
    highestRank: 3,
    bestRankThisWeek: 5,
    followers: 58,
  },
  {
    email: "maya@dancr.demo",
    realName: "Maya Lewis",
    stageName: "Maya Lux",
    slug: "maya-lux",
    status: "approved",
    venueSlug: "velvet-room",
    rank: 1,
    previousRank: 4,
    highestRank: 1,
    bestRankThisWeek: 1,
    followers: 96,
  },
  {
    email: "nova@dancr.demo",
    realName: "Nova Reed",
    stageName: "Nova Rae",
    slug: "nova-rae",
    status: "approved",
    venueSlug: "neon-hall",
    rank: 7,
    previousRank: 10,
    highestRank: 5,
    bestRankThisWeek: 7,
    followers: 46,
  },
  {
    email: "pending@dancr.demo",
    realName: "Pending Demo",
    stageName: "Pending Star",
    slug: "pending-star",
    status: "pending_review",
    venueSlug: "prism-lounge",
    rank: null,
    previousRank: null,
    highestRank: null,
    bestRankThisWeek: null,
    followers: 0,
  },
  {
    email: "new@dancr.demo",
    realName: "New Demo",
    stageName: "New Dancer",
    slug: "new-dancer",
    status: "draft",
    venueSlug: "prism-lounge",
    rank: null,
    previousRank: null,
    highestRank: null,
    bestRankThisWeek: null,
    followers: 0,
  },
];

export async function GET(request: Request) {
  const seedKey = getServerEnv("DANCR_ADMIN_SEED_KEY");
  const url = new URL(request.url);
  const providedKey = url.searchParams.get("key") || request.headers.get("x-dancr-seed-key");

  if (!providedKey || providedKey !== seedKey) {
    return NextResponse.json({ ok: false, error: "Seed key required." }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient() as any;
    const venueMap = await seedVenues(admin);
    const customer = await seedUser(admin, {
      email: "customer@dancr.demo",
      role: "customer",
      displayName: "Alex",
      metadata: { role: "customer", display_name: "Alex" },
    });

    await upsert(admin, "customer_profiles", {
      user_id: customer.id,
      city: "Las Vegas",
      notification_settings: {
        followedDancersOnly: true,
        followedVenuesOnly: true,
        anyDancerInCity: false,
        workingTonight: true,
        newShifts: true,
        venueSchedules: true,
        clubChanges: true,
        cancelledShifts: true,
      },
    });

    const dancers = [];
    for (const seed of dancerSeeds) {
      const user = await seedUser(admin, {
        email: seed.email,
        role: "dancer",
        displayName: seed.stageName,
        metadata: {
          role: "dancer",
          display_name: seed.stageName,
          real_name: seed.realName,
          stage_name: seed.stageName,
          city: "Las Vegas",
        },
      });

      const { data, error } = await admin
        .from("dancer_profiles")
        .upsert(
          {
            user_id: user.id,
            real_name: seed.realName,
            stage_name: seed.stageName,
            slug: seed.slug,
            city: "Las Vegas",
            bio: `${seed.stageName} posts verified Dancr schedules in Las Vegas.`,
            status: seed.status,
            verification_status: seed.status === "approved" ? "approved" : "pending",
            photo_review_status: seed.status === "approved" ? "approved" : "pending",
            approved_at: seed.status === "approved" ? new Date().toISOString() : null,
          },
          { onConflict: "user_id" },
        )
        .select("id, user_id, stage_name, slug")
        .single();

      if (error) throw error;
      dancers.push({ ...seed, id: data.id, userId: user.id, venueId: venueMap.get(seed.venueSlug)?.id });
    }

    await clearDemoRows(admin, dancers.map((d) => d.id), [customer.id, ...dancers.map((d) => d.userId)]);

    const approvedDancers = dancers.filter((d) => d.status === "approved");
    const shiftsByDancer = await seedDancerAssets(admin, approvedDancers, venueMap);
    await seedCustomerActivity(admin, customer.id, approvedDancers, venueMap, shiftsByDancer);
    await seedAnalytics(admin, approvedDancers, venueMap, shiftsByDancer);

    return NextResponse.json({
      ok: true,
      message: "Dancr demo data seeded.",
      password: DEMO_PASSWORD,
      accounts: [
        { type: "Approved dancer", email: "approved@dancr.demo" },
        { type: "Pending dancer", email: "pending@dancr.demo" },
        { type: "Brand-new dancer", email: "new@dancr.demo" },
        { type: "Customer", email: "customer@dancr.demo" },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo seed failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function seedUser(
  admin: any,
  input: {
    email: string;
    role: "customer" | "dancer" | "admin";
    displayName: string;
    metadata: Record<string, string>;
  },
) {
  const existing = await findAuthUser(admin, input.email);
  const user =
    existing ||
    (
      await admin.auth.admin.createUser({
        email: input.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: input.metadata,
      })
    ).data.user;

  if (!user) throw new Error(`Could not create ${input.email}.`);

  await admin.auth.admin.updateUserById(user.id, {
    password: DEMO_PASSWORD,
    user_metadata: input.metadata,
  });

  await upsert(admin, "app_users", {
    id: user.id,
    role: input.role,
    display_name: input.displayName,
    email: input.email,
    account_state: "active",
  });

  return user;
}

async function findAuthUser(admin: any, email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((user: any) => user.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function seedVenues(admin: any) {
  const venueRows = venues.map((venue) => ({
    ...venue,
    timezone: "America/Los_Angeles",
    opens_at: "20:00",
    closes_at: "04:00",
    is_active: true,
  }));

  const { data, error } = await admin.from("venues").upsert(venueRows, { onConflict: "slug" }).select("id, slug, name");
  if (error) throw error;
  return new Map(data.map((venue: any) => [venue.slug, venue]));
}

async function clearDemoRows(admin: any, dancerIds: string[], userIds: string[]) {
  if (dancerIds.length === 0) return;

  const { data: shifts } = await admin.from("shifts").select("id").in("dancer_id", dancerIds);
  const shiftIds = (shifts || []).map((shift: any) => shift.id);

  if (shiftIds.length > 0) {
    await admin.from("going_signals").delete().in("shift_id", shiftIds);
    await admin.from("schedule_views").delete().in("shift_id", shiftIds);
    await admin.from("shifts").delete().in("id", shiftIds);
  }

  await Promise.all([
    admin.from("follows").delete().in("dancer_id", dancerIds),
    admin.from("favorites").delete().in("dancer_id", dancerIds),
    admin.from("profile_views").delete().in("dancer_id", dancerIds),
    admin.from("direction_requests").delete().in("dancer_id", dancerIds),
    admin.from("social_clicks").delete().in("dancer_id", dancerIds),
    admin.from("ranking_events").delete().in("dancer_id", dancerIds),
    admin.from("trending_scores").delete().in("dancer_id", dancerIds),
    admin.from("dancer_photos").delete().in("dancer_id", dancerIds),
    admin.from("social_links").delete().in("dancer_id", dancerIds),
    admin.from("notifications").delete().in("recipient_id", userIds),
  ]);
}

async function seedDancerAssets(admin: any, dancers: any[], venueMap: Map<string, any>) {
  const shiftsByDancer = new Map<string, string>();

  for (const [index, dancer] of dancers.entries()) {
    const photoRows = photos.map((photo, photoIndex) => ({
      dancer_id: dancer.id,
      storage_path: photos[(index + photoIndex) % photos.length],
      alt_text: `${dancer.stageName} profile photo ${photoIndex + 1}`,
      sort_order: photoIndex,
      is_primary: photoIndex === 0,
      review_status: "approved",
    }));
    await insert(admin, "dancer_photos", photoRows);

    await insert(
      admin,
      "social_links",
      ["instagram", "tiktok", "snapchat", "x", "onlyfans"].map((platform) => ({
        dancer_id: dancer.id,
        platform,
        handle: `${dancer.slug.replaceAll("-", "")}`,
        url: socialUrl(platform, dancer.slug),
        is_active: true,
      })),
    );

    const venue = venueMap.get(dancer.venueSlug);
    const startOffsetHours = index === 0 ? 2 : 3 + index;
    const startsAt = hoursFromNow(startOffsetHours);
    const endsAt = hoursFromNow(startOffsetHours + 4);
    const { data, error } = await admin
      .from("shifts")
      .insert({
        dancer_id: dancer.id,
        venue_id: venue.id,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: "America/Los_Angeles",
        status: "posted",
        broadcast_sent_at: new Date().toISOString(),
        broadcast_recipients: 183 + index * 21,
      })
      .select("id")
      .single();

    if (error) throw error;
    shiftsByDancer.set(dancer.id, data.id);

    await upsert(admin, "trending_scores", {
      dancer_id: dancer.id,
      city: "Las Vegas",
      score: 940 - index * 71,
      rank: dancer.rank,
      previous_rank: dancer.previousRank,
      highest_rank: dancer.highestRank,
      best_rank_this_week: dancer.bestRankThisWeek,
      trend: dancer.previousRank && dancer.rank && dancer.previousRank > dancer.rank ? "rising" : "stable",
    });
  }

  return shiftsByDancer;
}

async function seedCustomerActivity(
  admin: any,
  customerId: string,
  dancers: any[],
  venueMap: Map<string, any>,
  shiftsByDancer: Map<string, string>,
) {
  await insert(
    admin,
    "follows",
    dancers.map((dancer) => ({
      customer_id: customerId,
      dancer_id: dancer.id,
      notifications_enabled: true,
    })),
  );

  await insert(
    admin,
    "venue_follows",
    Array.from(venueMap.values()).slice(0, 2).map((venue: any) => ({
      customer_id: customerId,
      venue_id: venue.id,
      notifications_enabled: true,
    })),
  );

  await insert(
    admin,
    "favorites",
    dancers.slice(0, 3).map((dancer) => ({
      customer_id: customerId,
      dancer_id: dancer.id,
    })),
  );

  await insert(
    admin,
    "going_signals",
    dancers.slice(0, 2).map((dancer) => ({
      customer_id: customerId,
      shift_id: shiftsByDancer.get(dancer.id),
    })),
  );
}

async function seedAnalytics(admin: any, dancers: any[], venueMap: Map<string, any>, shiftsByDancer: Map<string, string>) {
  for (const [index, dancer] of dancers.entries()) {
    const venue = venueMap.get(dancer.venueSlug);
    await insert(admin, "profile_views", makeRows(90 + index * 14, (i) => ({
      dancer_id: dancer.id,
      viewed_at: daysAgo(i % 30),
      source: i % 3 === 0 ? "share" : "browse",
      session_id: `demo-profile-${dancer.slug}-${i}`,
    })));

    await insert(admin, "schedule_views", makeRows(34 + index * 8, (i) => ({
      dancer_id: dancer.id,
      shift_id: shiftsByDancer.get(dancer.id),
      viewed_at: daysAgo(i % 21),
      session_id: `demo-schedule-${dancer.slug}-${i}`,
    })));

    await insert(admin, "direction_requests", makeRows(16 + index * 5, (i) => ({
      dancer_id: dancer.id,
      venue_id: venue.id,
      requested_at: daysAgo(i % 24),
      session_id: `demo-directions-${dancer.slug}-${i}`,
    })));

    await insert(admin, "social_clicks", makeRows(24 + index * 6, (i) => ({
      dancer_id: dancer.id,
      platform: ["instagram", "tiktok", "snapchat", "onlyfans", "x"][i % 5],
      clicked_at: daysAgo(i % 30),
      session_id: `demo-social-${dancer.slug}-${i}`,
    })));

    await insert(admin, "notifications", [
      {
        recipient_id: dancer.userId,
        notification_type: "ranking_milestone",
        channel: "in_app",
        title: dancer.rank === 1 ? "You reached #1 Trending" : "You entered the Top 10",
        body:
          dancer.rank === 1
            ? "You are now the #1 Trending dancer in Las Vegas."
            : `You are now #${dancer.rank} Trending in Las Vegas.`,
        payload: { rank: dancer.rank, city: "Las Vegas" },
        sent_at: new Date().toISOString(),
      },
      {
        recipient_id: dancer.userId,
        notification_type: "weekly_summary",
        channel: "in_app",
        title: "Your week on Dancr",
        body: `You gained visibility from ${90 + index * 14} profile views and ${16 + index * 5} direction requests.`,
        payload: { profileViews: 90 + index * 14, directionRequests: 16 + index * 5 },
        sent_at: new Date().toISOString(),
      },
    ]);
  }
}

async function upsert(admin: any, table: string, row: Record<string, unknown>) {
  const { error } = await admin.from(table).upsert(row);
  if (error) throw error;
}

async function insert(admin: any, table: string, rows: Record<string, unknown>[]) {
  const filteredRows = rows.filter(Boolean);
  if (filteredRows.length === 0) return;
  const { error } = await admin.from(table).insert(filteredRows);
  if (error) throw error;
}

function makeRows(count: number, makeRow: (index: number) => Record<string, unknown>) {
  return Array.from({ length: count }, (_, index) => makeRow(index));
}

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function socialUrl(platform: string, slug: string) {
  const handle = slug.replaceAll("-", "");
  if (platform === "instagram") return `https://instagram.com/${handle}`;
  if (platform === "tiktok") return `https://tiktok.com/@${handle}`;
  if (platform === "snapchat") return `https://snapchat.com/add/${handle}`;
  if (platform === "onlyfans") return `https://onlyfans.com/${handle}`;
  return `https://x.com/${handle}`;
}
