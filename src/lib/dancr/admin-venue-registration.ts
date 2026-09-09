import type { SupabaseClient } from "@supabase/supabase-js";

// Keep the approval response complete enough to populate the admin editor immediately.
export function mapApprovedVenue(row: Record<string, any> | null) {
  if (!row?.id) return null;
  return {
    id: String(row.id),
    slug: String(row.slug || ""),
    name: String(row.name || ""),
    city: String(row.city || ""),
    state: row.state ? String(row.state) : null,
    address: row.address ? String(row.address) : null,
    phone: row.phone ? String(row.phone) : null,
    website: row.website ? String(row.website) : null,
    timezone: row.timezone ? String(row.timezone) : null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    opens_at: row.opens_at ?? null,
    closes_at: row.closes_at ?? null,
    page_review_status: row.page_review_status ?? "admin_draft",
    isActive: row.is_active !== false,
  };
}

// Private registration details belong only in the authenticated admin response.
export async function getAdminVenueRegistrations(client: SupabaseClient, venueIds: string[]) {
  const registrations = new Map<string, Record<string, unknown>>();
  const ids = [...new Set(venueIds.filter(Boolean))];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await client.from("venue_signup_requests")
      .select("id, matched_venue_id, venue_name, street_address, city, state, postal_code, website, contact_name, contact_title, contact_email, contact_phone, login_email, message, submitted_at")
      .eq("status", "approved")
      .in("matched_venue_id", ids.slice(offset, offset + 200))
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    for (const row of data || []) {
      const venueId = String(row.matched_venue_id);
      if (registrations.has(venueId)) continue;
      registrations.set(venueId, {
        id: row.id, venueName: row.venue_name, streetAddress: row.street_address,
        city: row.city, state: row.state, postalCode: row.postal_code, website: row.website,
        contactName: row.contact_name, contactTitle: row.contact_title,
        contactEmail: row.contact_email, contactPhone: row.contact_phone,
        loginEmail: row.login_email, message: row.message, submittedAt: row.submitted_at,
      });
    }
  }
  return registrations;
}
