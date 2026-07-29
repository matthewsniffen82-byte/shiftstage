import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to purge legacy identity data.",
  );
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const bucket = admin.storage.from("verification-documents");
const legacyPaths = [];

await collectLegacyVerificationPaths("");

for (let offset = 0; ; offset += 1000) {
  const { data: reviews, error: reviewReadError } = await admin
    .from("approval_reviews")
    .select("id")
    .like("review_type", "verification_document:%")
    .range(offset, offset + 999);
  if (reviewReadError) throw reviewReadError;
  if (!reviews?.length) break;

  const ids = reviews.map((review) => review.id);
  const { error: reviewDeleteError } = await admin.from("approval_reviews").delete().in("id", ids);
  if (reviewDeleteError) throw reviewDeleteError;
  if (reviews.length < 1000) break;
  offset -= 1000;
}

for (let index = 0; index < legacyPaths.length; index += 100) {
  const { error } = await bucket.remove(legacyPaths.slice(index, index + 100));
  if (error) throw error;
}

console.info(
  JSON.stringify({
    event: "privacy.legacy_identity_purge_completed",
    deletedObjectCount: legacyPaths.length,
  }),
);

async function collectLegacyVerificationPaths(prefix) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;

    for (const item of data || []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) {
        if (path.split("/").includes("verification")) legacyPaths.push(path);
      } else {
        await collectLegacyVerificationPaths(path);
      }
    }

    if (!data || data.length < 1000) break;
  }
}
