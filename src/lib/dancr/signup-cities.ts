import type { SupabaseClient } from "@supabase/supabase-js";

type DancrClient = SupabaseClient;

export type DancerSignupCity = {
  value: string;
  label: string;
};

export class DancerSignupCityInputError extends Error {
  readonly code = "INVALID_DANCER_CITY";
}

export async function getDancerSignupCities(client: DancrClient): Promise<DancerSignupCity[]> {
  const { data, error } = await client
    .from("venues")
    .select("city, state")
    .eq("is_active", true)
    .order("city", { ascending: true })
    .order("state", { ascending: true });

  if (error) throw error;

  const cities = new Map<string, DancerSignupCity>();
  for (const row of data || []) {
    const value = normalizeCity(row.city);
    if (!value) continue;

    const key = value.toLocaleLowerCase("en-US");
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
