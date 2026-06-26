export type TonightWindow = {
  startsAt: string;
  endsAt: string;
  activeAfter: string;
  timeZone: string;
};

export function getTonightWindow(timeZone = "America/Los_Angeles", now = new Date()): TonightWindow {
  const local = getLocalDateParts(now, timeZone);
  const startsAt = zonedDateTimeToUtc(local.year, local.month, local.day, 0, 1, timeZone);
  const tomorrow = addDays(local.year, local.month, local.day, 1);
  const endsAt = zonedDateTimeToUtc(tomorrow.year, tomorrow.month, tomorrow.day, 0, 1, timeZone);

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    activeAfter: now.toISOString(),
    timeZone,
  };
}

export function isValidShiftRange(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start;
}

function getLocalDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
  };
}

function addDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone);

  return new Date(utcGuess.getTime() - offset);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const localAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );

  return localAsUtc - date.getTime();
}
