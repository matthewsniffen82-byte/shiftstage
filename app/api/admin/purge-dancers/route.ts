import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import Stripe from "stripe";

import { createAdminSupabaseClient } from "@/src/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PURGE_ACTION = "dancr:delete-all-dancer-accounts:v1";
const BUCKETS = [
  "dancer-photos",
  "verification-documents",
  "dancr-image-moderation-temp",
  "dancr-image-moderation-review",
] as const;

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    authorizePurge(String(form.get("token") || ""));
    const mode = String(form.get("mode") || "audit");
    if (!["audit", "execute"].includes(mode)) {
      return NextResponse.json({ ok: false, error: "Invalid mode." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const audit = await auditDancers(admin);
    if (mode === "audit") return NextResponse.json({ ok: true, audit: publicAudit(audit) });
    if (audit.protectedRoleConflicts) {
      return NextResponse.json(
        { ok: false, error: "Protected non-dancer role conflict detected.", audit: publicAudit(audit) },
        { status: 409 },
      );
    }

    await cancelStripeSubscriptions(audit.activeStripeSubscriptionIds);
    await deleteStorage(admin, audit.storagePaths);
    for (const userId of audit.targetAuthUserIds) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    }

    if (audit.targetUserIds.length) {
      const { error: profileError } = await admin
        .from("dancer_profiles")
        .delete()
        .in("user_id", audit.targetUserIds);
      if (profileError) throw profileError;
      const { error: accountError } = await admin
        .from("app_users")
        .delete()
        .in("id", audit.targetUserIds)
        .eq("role", "dancer");
      if (accountError) throw accountError;
    }

    const verification = await verifyPurge(admin, audit);
    return NextResponse.json({ ok: true, deleted: publicAudit(audit), verification });
  } catch (error) {
    console.error("DANCER_ACCOUNT_PURGE_FAILED", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Dancer purge failed." },
      { status: 500 },
    );
  }
}

function authorizePurge(token: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("Production service role is unavailable.");
  const expected = createHmac("sha256", serviceRoleKey).update(PURGE_ACTION).digest();
  const received = Buffer.from(token, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Unauthorized dancer purge request.");
  }
}

async function auditDancers(admin: AdminClient) {
  const [
    { data: appUsers, error: appUsersError },
    { data: profiles, error: profilesError },
    { data: subscriptions, error: subscriptionsError },
  ] = await Promise.all([
    admin.from("app_users").select("id, role").range(0, 9999),
    admin.from("dancer_profiles").select("id, user_id").range(0, 9999),
    admin
      .from("subscriptions")
      .select("dancer_id, stripe_subscription_id, status")
      .range(0, 9999),
  ]);
  for (const error of [appUsersError, profilesError, subscriptionsError]) {
    if (error) throw error;
  }

  const authUsers = await listAuthUsers(admin);
  const roles = new Map(
    (appUsers || []).map((row: any) => [row.id, String(row.role || "").toLowerCase()]),
  );
  const profileUserIds = new Set<string>(
    (profiles || []).map((row: any) => row.user_id).filter(Boolean),
  );
  const profileIds = new Set<string>(
    (profiles || []).map((row: any) => row.id).filter(Boolean),
  );
  const databaseDancerIds = new Set<string>(
    (appUsers || [])
      .filter((row: any) => String(row.role || "").toLowerCase() === "dancer")
      .map((row: any) => row.id),
  );
  const metadataDancerIds = new Set<string>(
    authUsers
      .filter((user: any) => authRole(user) === "dancer")
      .map((user: any) => user.id),
  );
  const candidates = new Set<string>([
    ...databaseDancerIds,
    ...profileUserIds,
    ...metadataDancerIds,
  ]);
  const conflicts = [...candidates].filter((id) => {
    const role = roles.get(id);
    return role && role !== "dancer";
  });
  const targetUserIds = [...candidates].filter((id) => !conflicts.includes(id));
  const targetSet = new Set(targetUserIds);
  const targetAuthUserIds = authUsers
    .filter((user: any) => targetSet.has(user.id))
    .map((user: any) => user.id);
  const targetSubscriptions = (subscriptions || []).filter((row: any) =>
    profileIds.has(row.dancer_id),
  );
  const activeStripeSubscriptionIds = targetSubscriptions
    .filter(
      (row: any) =>
        row.stripe_subscription_id &&
        !["canceled", "cancelled", "incomplete_expired"].includes(
          String(row.status || "").toLowerCase(),
        ),
    )
    .map((row: any) => String(row.stripe_subscription_id));
  const storagePaths = new Map<string, string[]>();
  for (const bucket of BUCKETS) {
    const paths: string[] = [];
    for (const userId of targetUserIds) {
      paths.push(...(await listFiles(admin, bucket, userId)));
    }
    storagePaths.set(bucket, [...new Set(paths)]);
  }

  return {
    dancerProfiles: profiles?.length || 0,
    dancerDatabaseAccounts: databaseDancerIds.size,
    dancerAuthenticationAccounts: targetAuthUserIds.length,
    orphanDancerAuthenticationAccounts: [...metadataDancerIds].filter(
      (id) => !roles.has(id) && !profileUserIds.has(id),
    ).length,
    protectedRoleConflicts: conflicts.length,
    stripeSubscriptionRows: targetSubscriptions.length,
    activeStripeSubscriptions: activeStripeSubscriptionIds.length,
    totalDeletionTargets: targetUserIds.length,
    protectedDatabaseAccounts: (appUsers || []).length - databaseDancerIds.size,
    protectedAuthenticationAccounts: authUsers.length - targetAuthUserIds.length,
    targetUserIds,
    targetAuthUserIds,
    activeStripeSubscriptionIds,
    storagePaths,
  };
}

function publicAudit(audit: Awaited<ReturnType<typeof auditDancers>>) {
  return {
    dancerProfiles: audit.dancerProfiles,
    dancerDatabaseAccounts: audit.dancerDatabaseAccounts,
    dancerAuthenticationAccounts: audit.dancerAuthenticationAccounts,
    orphanDancerAuthenticationAccounts: audit.orphanDancerAuthenticationAccounts,
    protectedRoleConflicts: audit.protectedRoleConflicts,
    stripeSubscriptionRows: audit.stripeSubscriptionRows,
    activeStripeSubscriptions: audit.activeStripeSubscriptions,
    storageObjects: Object.fromEntries(
      BUCKETS.map((bucket) => [bucket, audit.storagePaths.get(bucket)?.length || 0]),
    ),
    totalDeletionTargets: audit.totalDeletionTargets,
    protectedDatabaseAccounts: audit.protectedDatabaseAccounts,
    protectedAuthenticationAccounts: audit.protectedAuthenticationAccounts,
  };
}

function authRole(user: any) {
  return String(
    user.user_metadata?.role ||
      user.app_metadata?.role ||
      user.user_metadata?.account_type ||
      "",
  ).toLowerCase();
}

async function cancelStripeSubscriptions(subscriptionIds: string[]) {
  if (!subscriptionIds.length) return;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Active dancer billing exists but Stripe is unavailable.");
  const stripe = new Stripe(key);
  for (const subscriptionId of subscriptionIds) {
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (error) {
      if (!String((error as any)?.message || "").toLowerCase().includes("no such subscription")) {
        throw error;
      }
    }
  }
}

async function deleteStorage(admin: AdminClient, pathsByBucket: Map<string, string[]>) {
  for (const bucket of BUCKETS) {
    const paths = pathsByBucket.get(bucket) || [];
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await admin.storage
        .from(bucket)
        .remove(paths.slice(index, index + 100));
      if (error) throw error;
    }
  }
}

async function listAuthUsers(admin: AdminClient) {
  const users: any[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < 1000) return users;
  }
}

async function listFiles(
  admin: AdminClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      const path = `${prefix}/${row.name}`;
      if (row.id) paths.push(path);
      else paths.push(...(await listFiles(admin, bucket, path)));
    }
    if (rows.length < 1000) return paths;
  }
}

async function verifyPurge(
  admin: AdminClient,
  audit: Awaited<ReturnType<typeof auditDancers>>,
) {
  const [
    { count: profiles, error: profilesError },
    { count: dancerAccounts, error: dancersError },
    { count: protectedAccounts, error: protectedError },
  ] = await Promise.all([
    admin.from("dancer_profiles").select("id", { count: "exact", head: true }),
    admin
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .eq("role", "dancer"),
    admin
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .neq("role", "dancer"),
  ]);
  for (const error of [profilesError, dancersError, protectedError]) {
    if (error) throw error;
  }

  const authUsers = await listAuthUsers(admin);
  const targetSet = new Set(audit.targetUserIds);
  const targetAuthAccounts = authUsers.filter((user: any) => targetSet.has(user.id)).length;
  const metadataDancerAccounts = authUsers.filter(
    (user: any) => authRole(user) === "dancer",
  ).length;
  const storageObjects: Record<string, number> = {};
  for (const bucket of BUCKETS) {
    let count = 0;
    for (const userId of audit.targetUserIds) {
      count += (await listFiles(admin, bucket, userId)).length;
    }
    storageObjects[bucket] = count;
  }

  const result = {
    dancerProfiles: profiles || 0,
    dancerDatabaseAccounts: dancerAccounts || 0,
    dancerAuthenticationAccounts: targetAuthAccounts,
    metadataDancerAuthenticationAccounts: metadataDancerAccounts,
    protectedDatabaseAccountsBefore: audit.protectedDatabaseAccounts,
    protectedDatabaseAccountsAfter: protectedAccounts || 0,
    protectedAuthenticationAccountsBefore: audit.protectedAuthenticationAccounts,
    protectedAuthenticationAccountsAfter: authUsers.length,
    remainingStorageObjects: storageObjects,
  };
  if (
    result.dancerProfiles ||
    result.dancerDatabaseAccounts ||
    result.dancerAuthenticationAccounts ||
    result.metadataDancerAuthenticationAccounts ||
    Object.values(storageObjects).some(Boolean) ||
    result.protectedDatabaseAccountsAfter !== audit.protectedDatabaseAccounts ||
    result.protectedAuthenticationAccountsAfter !== audit.protectedAuthenticationAccounts
  ) {
    throw new Error(`Purge verification failed: ${JSON.stringify(result)}`);
  }
  return result;
}
