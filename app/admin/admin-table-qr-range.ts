export type TableQrRange = { start: number; end: number; count: number };

export function readTableQrRange(startValue: string, endValue: string): { range: TableQrRange | null; error: string } {
  if (!startValue && !endValue) return { range: null, error: "" };
  if (!startValue || !endValue) return { range: null, error: "Enter the first and last table numbers." };
  const start = Number(startValue), end = Number(endValue);
  if (![startValue, endValue].every(value => /^\d+$/.test(value))
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < 1) {
    return { range: null, error: "Use positive whole numbers for both tables." };
  }
  if (end < start) return { range: null, error: "The last table number must be at least the first." };
  return { range: { start, end, count: end - start + 1 }, error: "" };
}

export function existingTableNumbers(range: TableQrRange, links: { label: string; active: boolean }[]) {
  const numbers = new Set<number>();
  for (const link of links) {
    if (!link.active) continue;
    const match = /^table ([1-9]\d*)$/i.exec(link.label.trim());
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number >= range.start && number <= range.end) numbers.add(number);
  }
  return numbers;
}
