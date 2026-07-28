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
