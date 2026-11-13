/** Accept the table number from the form or the full label from an existing client. */
export function numberedTableLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(?:table +)?0*([1-9][0-9]{0,53})$/i.exec(value.trim());
  return match ? `Table ${match[1]}` : null;
}
