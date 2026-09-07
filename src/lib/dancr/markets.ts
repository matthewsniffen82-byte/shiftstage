export const MYDANCR_AVAILABLE_CITIES = [
  "Las Vegas",
  "Miami",
  "Atlanta",
  "New York",
] as const;

export function resolveMyDancrCity(value: string | null | undefined) {
  const requestedCity = String(value || "").trim();
  return (
    MYDANCR_AVAILABLE_CITIES.find(
      (city) => city.toLocaleLowerCase() === requestedCity.toLocaleLowerCase(),
    ) || MYDANCR_AVAILABLE_CITIES[0]
  );
}

export const MYDANCR_ALL_CITIES = "All cities";

export function isAllMyDancrCities(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase() === MYDANCR_ALL_CITIES.toLowerCase();
}

export function resolveMyDancrDiscoveryCity(value: string | null | undefined) {
  return isAllMyDancrCities(value) ? MYDANCR_ALL_CITIES : resolveMyDancrCity(value);
}
