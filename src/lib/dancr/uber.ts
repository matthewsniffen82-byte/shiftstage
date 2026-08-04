export const UBER_UNIVERSAL_LINK = "https://m.uber.com/looking";

export type UberDestination = {
  name: string;
  formattedAddress: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type PublicVenueDestination = {
  name?: string | null;
  formattedAddress?: string | null;
  address?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  zipCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export function buildUberRideUrl(destination: UberDestination): string {
  const name = cleanText(destination?.name);
  const formattedAddress = cleanText(destination?.formattedAddress);
  if (!name || !formattedAddress) return UBER_UNIVERSAL_LINK;

  const url = new URL(UBER_UNIVERSAL_LINK);
  url.searchParams.set("action", "setPickup");
  url.searchParams.set("pickup", "my_location");
  url.searchParams.set("dropoff[nickname]", name);
  url.searchParams.set("dropoff[formatted_address]", formattedAddress);
  const dropoff: Record<string, string | number> = {
    addressLine1: name,
    addressLine2: formattedAddress,
  };

  if (
    isValidLatitude(destination.latitude) &&
    isValidLongitude(destination.longitude)
  ) {
    dropoff.latitude = destination.latitude;
    dropoff.longitude = destination.longitude;
    url.searchParams.set("dropoff[latitude]", String(destination.latitude));
    url.searchParams.set("dropoff[longitude]", String(destination.longitude));
  }

  url.searchParams.set("drop[0]", JSON.stringify(dropoff));

  return url.toString();
}

export function publicVenueUberDestination(
  venue: PublicVenueDestination,
): UberDestination | null {
  const name = cleanText(venue?.name);
  const formattedAddress = formatPublicVenueAddress(venue);
  if (!name || !formattedAddress) return null;

  return {
    name,
    formattedAddress,
    latitude: venue.latitude,
    longitude: venue.longitude,
  };
}

export function formatPublicVenueAddress(
  venue: PublicVenueDestination,
): string {
  const explicit = cleanText(venue?.formattedAddress);
  if (explicit) return explicit;

  const street = cleanText(venue?.address) || cleanText(venue?.streetAddress);
  if (!street) return "";

  const city = cleanText(venue?.city);
  const state = cleanText(venue?.state);
  const postalCode = cleanText(venue?.postalCode) || cleanText(venue?.zipCode);
  const normalizedStreet = street.toLocaleLowerCase("en-US");
  const alreadyIncludesLocality = Boolean(
    (city && normalizedStreet.includes(city.toLocaleLowerCase("en-US"))) ||
      (state && normalizedStreet.includes(` ${state.toLocaleLowerCase("en-US")} `)) ||
      (postalCode && normalizedStreet.includes(postalCode.toLocaleLowerCase("en-US"))),
  );

  if (alreadyIncludesLocality) return street;

  const region = [state, postalCode].filter(Boolean).join(" ");
  return [street, city, region].filter(Boolean).join(", ");
}

export function isValidUberDestination(
  destination: UberDestination | null | undefined,
): destination is UberDestination {
  return Boolean(
    cleanText(destination?.name) && cleanText(destination?.formattedAddress),
  );
}

function isValidLatitude(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
