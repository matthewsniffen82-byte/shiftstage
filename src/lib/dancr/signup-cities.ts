import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export type DancerSignupCity = {
  value: string;
  label: string;
};

export type DancerDiscoveryCity = DancerSignupCity & {
  dancerCount?: number;
  venueCount: number;
};

export class DancerSignupCityInputError extends Error {
  readonly code = "INVALID_DANCER_CITY";
}

export async function getDancerSignupCities(client: DancrClient): Promise<DancerSignupCity[]> {
  const data = await getActiveVenueCityRows(client);
  return dancerSignupCitiesFromVenueRows(data);
}

export async function getDancerDiscoveryCities(client: DancrClient): Promise<DancerDiscoveryCity[]> {
  const venueRows = await getActiveVenueCityRows(client);
  const cities = dancerSignupCitiesFromVenueRows(venueRows).map((city) => ({
    ...city,
    venueCount: venueRows.filter((row) => cityKey(row.city) === cityKey(city.value)).length,
  }));

  const { data: dancerRows, error: dancerError } = await client
    .from("dancer_profiles")
    .select("city")
    .eq("status", "approved")
    .eq("verification_status", "approved")
    .eq("is_public", true)
    .is("disabled_at", null);

  if (dancerError) {
    console.warn("DANCER_DISCOVERY_CITY_STATS_LOAD_FAILED", {
      message: dancerError.message || "Unknown database error",
    });
    return cities;
  }

  const dancerCounts = new Map<string, number>();
  for (const row of dancerRows || []) {
    const key = cityKey(row.city);
    if (!key) continue;
    dancerCounts.set(key, (dancerCounts.get(key) || 0) + 1);
  }

  return cities.map((city) => ({
    ...city,
    dancerCount: dancerCounts.get(cityKey(city.value)) || 0,
  }));
}

async function getActiveVenueCityRows(client: DancrClient): Promise<Array<{ city: unknown; state: unknown }>> {
  const { data, error } = await client
    .from("venues")
    .select("city, state")
    .eq("is_active", true)
    .order("city", { ascending: true })
    .order("state", { ascending: true });

  if (error) throw error;
  return data || [];
}

function dancerSignupCitiesFromVenueRows(rows: Array<{ city: unknown; state: unknown }>) {
  const cities = new Map<string, DancerSignupCity>();
  for (const row of rows) {
    const value = normalizeCity(row.city);
    if (!value) continue;

    const key = cityKey(value);
    if (cities.has(key)) continue;

    const state = normalizeState(row.state);
    cities.set(key, {
      value,
      label: state ? `${value}, ${state}` : value,
    });
  }

  return [...cities.values()].sort((left, right) => left.label.localeCompare(right.label, "en-US"));
}

export async function requireDancerSignupCity(client: DancrClient, requestedCity: unknown) {
  const requested = normalizeCity(requestedCity);
  if (!requested) throw new DancerSignupCityInputError("Select an available city.");

  const cities = await getDancerSignupCities(client);
  const match = cities.find((city) => city.value.toLocaleLowerCase("en-US") === requested.toLocaleLowerCase("en-US"));
  if (!match) throw new DancerSignupCityInputError("That city is not currently available for dancer profiles.");

  return match.value;
}

function normalizeCity(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/gu, " ").slice(0, 100);
}

function normalizeState(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/gu, " ").slice(0, 100);
}

function cityKey(value: unknown) {
  return normalizeCity(value).toLocaleLowerCase("en-US");
}
